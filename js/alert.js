import {
  collection, query, orderBy, where, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti } from './prodotto-finito.js';
import { getProdotti }        from './magazzino.js';
import { openModal, closeModal } from './nav.js';

const GIORNI       = 60;
const SOGLIA_ROSSO   = 4;   // settimane
const SOGLIA_ARANCIO = 8;   // settimane
const PESO_ROCCA_KG  = 0.200;

let db;
let alertManuali  = [];
let movimentiCache = [];

export function initAlert(firestoreDb) {
  db = firestoreDb;

  caricaMovimenti();
  caricaAlertManuali();

  document.getElementById('add-alert-btn').addEventListener('click', () => {
    popolaSelectProdotti();
    openModal('modal-alert');
  });
  document.getElementById('form-alert').addEventListener('submit', salvaAlertManuale);
  document.getElementById('tab-alert-auto')?.addEventListener('click', gestisciClickAuto);
  document.getElementById('tab-alert-manuali')?.addEventListener('click', gestisciClickManuali);
}

// ─── Caricamento dati ────────────────────────────────────────────
function caricaMovimenti() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GIORNI);
  const q = query(
    collection(db, "movimenti_pf"),
    where("timestamp", ">=", Timestamp.fromDate(cutoff))
  );
  onSnapshot(q, snap => {
    movimentiCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTutto();
  }, err => console.error("Errore movimenti alert:", err));
}

function caricaAlertManuali() {
  const q = query(collection(db, "alert_manuali"), orderBy("createdAt", "desc"));
  onSnapshot(q, snap => {
    alertManuali = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTutto();
  }, err => console.error("Errore alert manuali:", err));
}

// ─── Calcoli ────────────────────────────────────────────────────
function calcolaRotazioni() {
  const totali = {};
  movimentiCache.filter(m => m.tipo === 'prelievo').forEach(m => {
    if (!m.idProdotto) return;
    totali[m.idProdotto] = (totali[m.idProdotto] ?? 0) + (m.quantita ?? 0);
  });
  const rotazioni = {};
  Object.keys(totali).forEach(id => {
    rotazioni[id] = totali[id] / (GIORNI / 7);
  });
  return rotazioni;
}

function calcolaProducibilita(pf, prodottiMP) {
  const componenti = pf.coloriComponenti ?? [];
  if (componenti.length === 0) return null;
  let minKgPF = Infinity;
  for (const comp of componenti) {
    const mp  = prodottiMP.find(p => p.id === comp.idProdotto);
    if (!mp?.kgPerCartone) return null;
    const kgD = (mp.quantitaDisponibile ?? 0) * mp.kgPerCartone;
    const pct = (comp.percentuale ?? 0) / 100;
    if (pct <= 0) return null;
    minKgPF = Math.min(minKgPF, kgD / pct);
  }
  return isFinite(minKgPF) ? Math.floor(minKgPF / PESO_ROCCA_KG) : 0;
}

function trovaConflitti(pf, tuttiPF, rotazioni) {
  const mieMP = new Set(
    (pf.coloriComponenti ?? []).map(c => c.idProdotto).filter(Boolean)
  );
  if (mieMP.size === 0) return [];
  const rotMia = rotazioni[pf.id] ?? 0;
  const conflitti = [];
  tuttiPF.forEach(altro => {
    if (altro.id === pf.id || altro.eliminato) return;
    const rotAltro = rotazioni[altro.id] ?? 0;
    if (rotAltro <= rotMia) return;
    const condivise = (altro.coloriComponenti ?? []).filter(c => mieMP.has(c.idProdotto));
    if (condivise.length > 0) {
      conflitti.push({
        nome:     `${altro.nome ?? ''} ${altro.colore ?? ''}`.trim(),
        rotazione: rotAltro,
        rapporto:  rotMia > 0 ? rotAltro / rotMia : null
      });
    }
  });
  return conflitti.sort((a, b) => b.rotazione - a.rotazione);
}

function generaAlertAutomatici(prodottiFiniti, prodottiMP, rotazioni) {
  const alerts = [];
  prodottiFiniti.forEach(pf => {
    if (pf.eliminato) return;
    const rotazione = rotazioni[pf.id] ?? 0;
    if (rotazione === 0) return;

    const stock          = pf.quantitaRocche ?? 0;
    const producibilita  = calcolaProducibilita(pf, prodottiMP);
    const conflitti      = trovaConflitti(pf, prodottiFiniti, rotazioni);

    const settimaneStock = stock / rotazione;
    const settimaneProd  = producibilita !== null ? producibilita / rotazione : null;
    const settimaneTotali = settimaneStock + (settimaneProd ?? 0);
    const haConflittiCritici = conflitti.some(c => c.rapporto && c.rapporto >= 2);

    let livello;
    if (settimaneTotali < SOGLIA_ROSSO || (haConflittiCritici && settimaneStock < SOGLIA_ROSSO)) {
      livello = 'rosso';
    } else if (settimaneTotali < SOGLIA_ARANCIO || conflitti.length > 0) {
      livello = 'arancio';
    } else {
      return; // verde — nessun problema, non mostrare
    }

    alerts.push({ pf, livello, rotazione, stock, producibilita,
      settimaneStock, settimaneProd, settimaneTotali, conflitti });
  });

  return alerts.sort((a, b) => {
    if (a.livello !== b.livello) return a.livello === 'rosso' ? -1 : 1;
    return a.settimaneTotali - b.settimaneTotali;
  });
}

// ─── Render ──────────────────────────────────────────────────────
function renderTutto() {
  const pf  = getProdottiFiniti();
  const mp  = getProdotti();
  const rot = calcolaRotazioni();
  const automatici = generaAlertAutomatici(pf, mp, rot);

  renderAutomatici(automatici);
  renderManuali();
  aggiornaBadge(automatici);
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(1) : '—'; }

function renderAutomatici(alerts) {
  const container = document.getElementById('tab-alert-auto');
  if (!container) return;

  if (alerts.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun alert automatico. Stock e producibilità nella norma.</p>';
    return;
  }

  const nRossi   = alerts.filter(a => a.livello === 'rosso').length;
  const nArancio = alerts.filter(a => a.livello === 'arancio').length;

  container.innerHTML = `
    <div class="alert-counter-bar">
      <span class="alert-counter rosso">🔴 ${nRossi} critico${nRossi !== 1 ? 'i' : ''}</span>
      <span class="alert-counter arancio">🟠 ${nArancio} attenzion${nArancio !== 1 ? 'e' : 'e'}</span>
    </div>
    <div class="alert-rows"></div>
  `;

  const rowsEl = container.querySelector('.alert-rows');

  alerts.forEach(a => {
    const { pf, livello, rotazione, stock, producibilita,
      settimaneStock, settimaneProd, settimaneTotali, conflitti } = a;

    const conflittoIco = conflitti.length > 0
      ? `<i class="fas fa-triangle-exclamation alert-row-warn" title="Conflitto materia prima"></i>` : '';

    const settCol = settimaneTotali < SOGLIA_ROSSO ? 'sett-rosso'
      : settimaneTotali < SOGLIA_ARANCIO ? 'sett-arancio' : '';

    const row = document.createElement('div');
    row.className = `alert-row ${livello}`;
    row.innerHTML = `
      <div class="alert-row-summary">
        <span class="alert-row-bullet ${livello}"></span>
        <div class="alert-row-nome">
          <span class="alert-row-prodotto">${pf.nome ?? '—'}</span>
          <span class="alert-row-colore">${pf.colore ?? '—'}</span>
        </div>
        <span class="alert-row-sett ${settCol}">${fmt(settimaneTotali)} sett.</span>
        ${conflittoIco}
        <i class="fas fa-chevron-right alert-row-chevron"></i>
      </div>
      <div class="alert-row-detail hidden">
        <div class="alert-detail-grid">
          <div class="alert-detail-item">
            <span class="alert-detail-label">Rotazione</span>
            <span class="alert-detail-val">${fmt(rotazione)} rocche/sett</span>
          </div>
          <div class="alert-detail-item">
            <span class="alert-detail-label">Stock</span>
            <span class="alert-detail-val">${stock} rocche (${fmt(settimaneStock)} sett.)</span>
          </div>
          <div class="alert-detail-item">
            <span class="alert-detail-label">Producibile</span>
            <span class="alert-detail-val">${producibilita !== null ? `${producibilita} rocche (${fmt(settimaneProd)} sett.)` : 'N/D — kgPerCartone mancante'}</span>
          </div>
          <div class="alert-detail-item">
            <span class="alert-detail-label">Fornitore</span>
            <span class="alert-detail-val">${pf.fornitore ?? '—'}</span>
          </div>
        </div>
        ${conflitti.length > 0 ? `
          <div class="alert-conflitti">
            <i class="fas fa-triangle-exclamation"></i>
            Stessa MP usata da:
            ${conflitti.map(c => `<strong>${c.nome}</strong>${c.rapporto ? ` (${c.rapporto.toFixed(1)}×)` : ''}`).join(', ')}
          </div>` : ''}
      </div>
    `;

    row.querySelector('.alert-row-summary').addEventListener('click', () => {
      const detail  = row.querySelector('.alert-row-detail');
      const chevron = row.querySelector('.alert-row-chevron');
      const open    = row.classList.toggle('open');
      detail.classList.toggle('hidden', !open);
      chevron.style.transform = open ? 'rotate(90deg)' : '';
    });

    rowsEl.appendChild(row);
  });
}

function renderManuali() {
  const container = document.getElementById('tab-alert-manuali');
  if (!container) return;

  if (alertManuali.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun alert manuale.</p>';
    return;
  }

  const livelloLabel = { critical: '🔴 Critico', warning: '🟠 Attenzione', info: '🔵 Info' };
  const livelloClass = { critical: 'rosso', warning: 'arancio', info: 'info' };

  container.innerHTML = '';
  alertManuali.forEach(a => {
    const data = a.createdAt?.toDate().toLocaleDateString('it-IT') ?? '—';
    const card = document.createElement('div');
    card.className = `alert-card ${livelloClass[a.livello] ?? 'arancio'}`;
    card.innerHTML = `
      <div class="alert-card-header">
        <div>
          <div class="alert-card-nome">${a.nomeProdotto ?? '—'}</div>
          <div class="alert-card-forn">${data}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="alert-badge-${livelloClass[a.livello] ?? 'arancio'}">${livelloLabel[a.livello] ?? ''}</span>
          <button class="pf-row-menu elimina-alert-btn" data-id="${a.id}" title="Elimina">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="alert-motivo">${a.motivo ?? ''}</div>
    `;
    container.appendChild(card);
  });
}

function aggiornaBadge(automatici) {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  const count = automatici.filter(a => a.livello === 'rosso').length
    + alertManuali.filter(a => a.livello === 'critical').length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

// ─── Click delegato manuali ─────────────────────────────────────
function gestisciClickAuto() { /* read-only */ }

function gestisciClickManuali(e) {
  const btn = e.target.closest('.elimina-alert-btn');
  if (!btn) return;
  if (!confirm('Eliminare questo alert?')) return;
  deleteDoc(doc(db, "alert_manuali", btn.dataset.id))
    .catch(err => console.error("Errore eliminazione alert:", err));
}

// ─── Alert manuale ───────────────────────────────────────────────
function popolaSelectProdotti() {
  const sel  = document.getElementById('a-prodotto');
  const list = getProdottiFiniti().filter(p => !p.eliminato);
  list.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'it', { sensitivity: 'base' })
    || (a.colore ?? '').localeCompare(b.colore ?? '', 'it', { sensitivity: 'base' }));
  sel.innerHTML = list.map(p =>
    `<option value="${p.id}" data-nome="${p.nome ?? ''} — ${p.colore ?? ''}">${p.nome ?? '—'} — ${p.colore ?? '—'}</option>`
  ).join('');
}

async function salvaAlertManuale(e) {
  e.preventDefault();
  const sel    = document.getElementById('a-prodotto');
  const opt    = sel.selectedOptions[0];
  const motivo = document.getElementById('a-motivo').value.trim();
  const livello = document.getElementById('a-livello').value;
  const btn    = e.target.querySelector('[type="submit"]');

  btn.disabled = true;
  try {
    await addDoc(collection(db, "alert_manuali"), {
      idProdotto:   sel.value,
      nomeProdotto: opt?.dataset.nome ?? sel.value,
      motivo,
      livello,
      createdAt:    serverTimestamp()
    });
    closeModal('modal-alert');
    e.target.reset();
  } catch (err) {
    console.error("Errore salvataggio alert manuale:", err);
    alert(`Errore: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}
