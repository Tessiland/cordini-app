import {
  collection, query, orderBy, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti } from './prodotto-finito.js';
import { getProdotti }        from './magazzino.js';
import { openModal, closeModal } from './nav.js';

const GIORNI       = 60;
const SOGLIA_ROSSO   = 4;
const SOGLIA_ARANCIO = 8;
const PESO_ROCCA_KG  = 0.200;

let db;
let alertManuali   = [];
let movimentiCache = [];
let filtroAttivo   = 'tutti';

export function initAlert(firestoreDb) {
  db = firestoreDb;
  caricaMovimenti();
  caricaAlertManuali();

  document.getElementById('add-alert-btn').addEventListener('click', apriNuovoAlert);
  document.getElementById('form-alert').addEventListener('submit', salvaAlert);

  document.querySelector('.alert-chip-bar')?.addEventListener('click', e => {
    const chip = e.target.closest('.alert-chip');
    if (!chip) return;
    document.querySelectorAll('.alert-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filtroAttivo = chip.dataset.filtro;
    renderInbox();
  });
}

// ─── Caricamento ─────────────────────────────────────────────────
function caricaMovimenti() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GIORNI);
  const q = query(
    collection(db, "movimenti_pf"),
    where("timestamp", ">=", Timestamp.fromDate(cutoff))
  );
  onSnapshot(q, snap => {
    movimentiCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInbox();
  }, err => console.error("Errore movimenti alert:", err));
}

function caricaAlertManuali() {
  const q = query(collection(db, "alert_manuali"), orderBy("createdAt", "desc"));
  onSnapshot(q, snap => {
    alertManuali = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInbox();
  }, err => console.error("Errore alert manuali:", err));
}

// ─── Calcoli ─────────────────────────────────────────────────────
function calcolaRotazioni() {
  const totali = {};
  movimentiCache.filter(m => m.tipo === 'prelievo').forEach(m => {
    if (!m.idProdotto) return;
    totali[m.idProdotto] = (totali[m.idProdotto] ?? 0) + (m.quantita ?? 0);
  });
  const rotazioni = {};
  Object.keys(totali).forEach(id => { rotazioni[id] = totali[id] / (GIORNI / 7); });
  return rotazioni;
}

function calcolaProducibilita(pf, prodottiMP) {
  const componenti = pf.coloriComponenti ?? [];
  if (componenti.length === 0) return null;
  let minKgPF = Infinity;
  for (const comp of componenti) {
    const mp = prodottiMP.find(p => p.id === comp.idProdotto);
    if (!mp?.kgPerCartone) return null;
    const kgD = (mp.quantitaDisponibile ?? 0) * mp.kgPerCartone;
    const pct = (comp.percentuale ?? 0) / 100;
    if (pct <= 0) return null;
    minKgPF = Math.min(minKgPF, kgD / pct);
  }
  return isFinite(minKgPF) ? Math.floor(minKgPF / PESO_ROCCA_KG) : 0;
}

function trovaConflitti(pf, tuttiPF, rotazioni) {
  const mieMP  = new Set((pf.coloriComponenti ?? []).map(c => c.idProdotto).filter(Boolean));
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
        nome:      `${altro.nome ?? ''} ${altro.colore ?? ''}`.trim(),
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
    const stock         = pf.quantitaRocche ?? 0;
    const producibilita = calcolaProducibilita(pf, prodottiMP);
    const conflitti     = trovaConflitti(pf, prodottiFiniti, rotazioni);
    const settimaneStock  = stock / rotazione;
    const settimaneProd   = producibilita !== null ? producibilita / rotazione : null;
    const settimaneTotali = settimaneStock + (settimaneProd ?? 0);
    const haConflittiCritici = conflitti.some(c => c.rapporto && c.rapporto >= 2);

    let livello;
    if (settimaneTotali < SOGLIA_ROSSO || (haConflittiCritici && settimaneStock < SOGLIA_ROSSO)) {
      livello = 'rosso';
    } else if (settimaneTotali < SOGLIA_ARANCIO || conflitti.length > 0) {
      livello = 'arancio';
    } else return;

    alerts.push({ tipo: 'auto', livello, pf, rotazione, stock, producibilita,
      settimaneStock, settimaneProd, settimaneTotali, conflitti });
  });
  return alerts;
}

// ─── Ordinamento e filtro ─────────────────────────────────────────
function priorita(a) {
  const lv = a.livello === 'critical' ? 'rosso' : a.livello === 'warning' ? 'arancio' : a.livello;
  if (lv === 'rosso')   return a.tipo === 'auto' ? 0 : 1;
  if (lv === 'arancio') return a.tipo === 'auto' ? 2 : 3;
  return 4;
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(1) : '—'; }

// ─── Render inbox unificata ───────────────────────────────────────
function renderInbox() {
  const pf         = getProdottiFiniti();
  const mp         = getProdotti();
  const rot        = calcolaRotazioni();
  const automatici = generaAlertAutomatici(pf, mp, rot);

  // Normalizza manuali
  const manualiNorm = alertManuali.map(a => ({
    tipo:   'manuale',
    livello: a.livello === 'critical' ? 'rosso' : a.livello === 'warning' ? 'arancio' : 'info',
    ...a
  }));

  const tutti = [...automatici, ...manualiNorm].sort((a, b) => {
    const pa = priorita(a), pb = priorita(b);
    if (pa !== pb) return pa - pb;
    if (a.tipo === 'auto' && b.tipo === 'auto') return a.settimaneTotali - b.settimaneTotali;
    return 0;
  });

  // Contatori
  const nRossi   = tutti.filter(a => a.livello === 'rosso').length;
  const nArancio = tutti.filter(a => a.livello === 'arancio').length;
  const nManuali = manualiNorm.length;

  const cR = document.getElementById('alert-count-rosso');
  const cA = document.getElementById('alert-count-arancio');
  const cM = document.getElementById('alert-count-manuale');
  if (cR) cR.textContent = nRossi;
  if (cA) cA.textContent = nArancio;
  if (cM) cM.textContent = nManuali;

  aggiornaBadge(nRossi, manualiNorm.filter(a => a.livello === 'critical').length);

  // Filtro attivo
  const filtrati = tutti.filter(a => {
    if (filtroAttivo === 'tutti')   return true;
    if (filtroAttivo === 'manuale') return a.tipo === 'manuale';
    return a.livello === filtroAttivo;
  });

  const inbox = document.getElementById('alert-inbox');
  if (!inbox) return;

  if (filtrati.length === 0) {
    inbox.innerHTML = '<p class="empty-state">Nessun alert. Tutto nella norma.</p>';
    return;
  }

  inbox.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'alert-rows';

  filtrati.forEach(a => {
    const row = a.tipo === 'auto' ? creaRigaAuto(a) : creaRigaManuale(a);
    list.appendChild(row);
  });

  inbox.appendChild(list);
}

// ─── Riga alert automatico ────────────────────────────────────────
function creaRigaAuto(a) {
  const { livello, pf, rotazione, stock, producibilita,
    settimaneStock, settimaneProd, settimaneTotali, conflitti } = a;

  const conflittoIco = conflitti.length > 0
    ? `<i class="fas fa-triangle-exclamation alert-row-warn" title="Conflitto MP"></i>` : '';
  const settCol = livello === 'rosso' ? 'sett-rosso' : 'sett-arancio';

  const row = document.createElement('div');
  row.className = `alert-row ${livello}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-bullet ${livello}"></span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${pf.nome ?? '—'} — ${pf.colore ?? '—'}</span>
        <span class="alert-row-colore">${pf.fornitore ?? ''}</span>
      </div>
      <span class="alert-row-sett ${settCol}">${fmt(settimaneTotali)} sett.</span>
      ${conflittoIco}
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Rotazione</span>
          <span class="alert-detail-val">${fmt(rotazione)} rocche/sett · ultimi ${GIORNI}gg</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Stock attuale</span>
          <span class="alert-detail-val">${stock} rocche (${fmt(settimaneStock)} sett.)</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Producibile</span>
          <span class="alert-detail-val">${producibilita !== null
            ? `${producibilita} rocche (${fmt(settimaneProd)} sett.)`
            : 'N/D — kgPerCartone mancante'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Copertura totale</span>
          <span class="alert-detail-val" style="font-weight:700">${fmt(settimaneTotali)} settimane</span>
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

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));
  return row;
}

// ─── Riga alert manuale ───────────────────────────────────────────
function creaRigaManuale(a) {
  const etichettaLivello = a.livello === 'rosso' ? '🔴' : a.livello === 'arancio' ? '🟠' : '🔵';
  const data = a.createdAt?.toDate().toLocaleDateString('it-IT') ?? '—';

  const row = document.createElement('div');
  row.className = `alert-row manuale ${a.livello}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-pin">📌</span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${a.nomeProdotto ?? '—'}</span>
        <span class="alert-row-colore">${a.motivo ?? ''}</span>
      </div>
      <span class="alert-row-sett" style="font-size:.7rem;color:var(--text-muted);font-weight:400">${etichettaLivello}</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid" style="grid-template-columns:1fr">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Motivo</span>
          <span class="alert-detail-val">${a.motivo ?? '—'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Creato il</span>
          <span class="alert-detail-val">${data}</span>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.5rem">
        <button class="btn-ghost btn-sm modifica-alert-btn" data-id="${a.id}">
          <i class="fas fa-pen"></i> Modifica
        </button>
        <button class="btn-ghost btn-sm btn-ghost-danger elimina-alert-btn" data-id="${a.id}">
          <i class="fas fa-trash"></i> Elimina
        </button>
      </div>
    </div>
  `;

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));

  row.querySelector('.modifica-alert-btn').addEventListener('click', e => {
    e.stopPropagation();
    apriModificaAlert(a);
  });

  row.querySelector('.elimina-alert-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`Eliminare l'alert su "${a.nomeProdotto}"?`)) {
      deleteDoc(doc(db, "alert_manuali", a.id)).catch(console.error);
    }
  });

  return row;
}

function toggleRiga(row) {
  const detail  = row.querySelector('.alert-row-detail');
  const chevron = row.querySelector('.alert-row-chevron');
  const open    = row.classList.toggle('open');
  detail.classList.toggle('hidden', !open);
  chevron.style.transform = open ? 'rotate(90deg)' : '';
}

// ─── Badge nav ────────────────────────────────────────────────────
function aggiornaBadge(nRossi, nCriticiManuali) {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  const count = nRossi + nCriticiManuali;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

// ─── Modal alert (crea e modifica) ───────────────────────────────
function apriNuovoAlert() {
  const form = document.getElementById('form-alert');
  form.reset();
  form.dataset.mode = 'add';
  document.getElementById('a-id').value = '';
  document.getElementById('a-submit-btn').textContent = 'Crea Alert';
  document.querySelector('#modal-alert .modal-title').textContent = 'Nuovo Alert Manuale';
  popolaSelectProdotti();
  openModal('modal-alert');
}

function apriModificaAlert(a) {
  const form = document.getElementById('form-alert');
  form.dataset.mode = 'edit';
  document.getElementById('a-id').value      = a.id;
  document.getElementById('a-motivo').value  = a.motivo ?? '';
  document.getElementById('a-livello').value = a.livello === 'rosso' ? 'critical'
    : a.livello === 'arancio' ? 'warning' : 'info';
  document.getElementById('a-submit-btn').textContent = 'Salva Modifiche';
  document.querySelector('#modal-alert .modal-title').textContent = 'Modifica Alert';
  popolaSelectProdotti(a.idProdotto);
  openModal('modal-alert');
}

function popolaSelectProdotti(idSelezionato) {
  const sel  = document.getElementById('a-prodotto');
  const list = getProdottiFiniti().filter(p => !p.eliminato);
  list.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'it', { sensitivity: 'base' })
    || (a.colore ?? '').localeCompare(b.colore ?? '', 'it', { sensitivity: 'base' }));
  sel.innerHTML = list.map(p =>
    `<option value="${p.id}" data-nome="${(p.nome ?? '')} — ${(p.colore ?? '')}"
      ${p.id === idSelezionato ? 'selected' : ''}>${p.nome ?? '—'} — ${p.colore ?? '—'}</option>`
  ).join('');
}

async function salvaAlert(e) {
  e.preventDefault();
  const form    = document.getElementById('form-alert');
  const sel     = document.getElementById('a-prodotto');
  const opt     = sel.selectedOptions[0];
  const motivo  = document.getElementById('a-motivo').value.trim();
  const livello = document.getElementById('a-livello').value;
  const btn     = document.getElementById('a-submit-btn');
  const id      = document.getElementById('a-id').value;
  const isEdit  = form.dataset.mode === 'edit';

  btn.disabled = true;
  try {
    if (isEdit && id) {
      await updateDoc(doc(db, "alert_manuali", id), {
        idProdotto:   sel.value,
        nomeProdotto: opt?.dataset.nome ?? sel.value,
        motivo,
        livello
      });
    } else {
      await addDoc(collection(db, "alert_manuali"), {
        idProdotto:   sel.value,
        nomeProdotto: opt?.dataset.nome ?? sel.value,
        motivo,
        livello,
        createdAt: serverTimestamp()
      });
    }
    closeModal('modal-alert');
    form.reset();
  } catch (err) {
    console.error("Errore salvataggio alert:", err);
    alert(`Errore: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}
