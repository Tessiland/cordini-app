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

  container.innerHTML = '';
  alerts.forEach(a => {
    const { pf, livello, rotazione, stock, producibilita,
      settimaneStock, settimaneProd, settimaneTotali, conflitti } = a;

    const badgeClass = livello === 'rosso' ? 'alert-badge-rosso' : 'alert-badge-arancio';
    const badgeTesto = livello === 'rosso' ? '🔴 Critico' : '🟠 Attenzione';

    const prodHtml = producibilita !== null
      ? `<div class="alert-metrica">
           <span class="alert-metrica-label">Producibile</span>
           <span class="alert-metrica-val">${producibilita} rocche</span>
           <span class="alert-metrica-sett">${fmt(settimaneProd)} sett.</span>
         </div>`
      : `<div class="alert-metrica alert-metrica-nd">
           <span class="alert-metrica-label">Producibile</span>
           <span class="alert-metrica-val nd">N/D</span>
           <span class="alert-metrica-hint">kgPerCartone mancante</span>
         </div>`;

    const conflittiHtml = conflitti.length > 0 ? `
      <div class="alert-conflitti">
        <i class="fas fa-triangle-exclamation"></i>
        <span>Stessa MP usata da prodotti a rotazione più alta:</span>
        <ul>
          ${conflitti.map(c => `
            <li>${c.nome}
              ${c.rapporto ? `<span class="conflitto-rapporto">${c.rapporto.toFixed(1)}×</span>` : ''}
            </li>`).join('')}
        </ul>
      </div>` : '';

    const card = document.createElement('div');
    card.className = `alert-card ${livello}`;
    card.innerHTML = `
      <div class="alert-card-header">
        <div>
          <div class="alert-card-nome">${pf.nome ?? '—'} — ${pf.colore ?? '—'}</div>
          <div class="alert-card-forn">${pf.fornitore ?? ''}</div>
        </div>
        <span class="${badgeClass}">${badgeTesto}</span>
      </div>
      <div class="alert-metriche">
        <div class="alert-metrica">
          <span class="alert-metrica-label">Rotazione media</span>
          <span class="alert-metrica-val">${fmt(rotazione)} rocche/sett</span>
          <span class="alert-metrica-hint">ultimi ${GIORNI} giorni</span>
        </div>
        <div class="alert-metrica">
          <span class="alert-metrica-label">Stock attuale</span>
          <span class="alert-metrica-val">${stock} rocche</span>
          <span class="alert-metrica-sett">${fmt(settimaneStock)} sett.</span>
        </div>
        ${prodHtml}
        <div class="alert-metrica alert-metrica-totale ${livello}">
          <span class="alert-metrica-label">Copertura totale</span>
          <span class="alert-metrica-val">${fmt(settimaneTotali)} settimane</span>
        </div>
      </div>
      ${conflittiHtml}
    `;
    container.appendChild(card);
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
