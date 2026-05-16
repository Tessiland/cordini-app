import {
  collection, query, orderBy, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti } from './prodotto-finito.js';
import { getProdotti }        from './magazzino.js';
import { openModal, closeModal } from './nav.js';

const GIORNI         = 60;
const SOGLIA_ROSSO   = 4;   // settimane
const SOGLIA_ARANCIO = 8;   // settimane
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
    const pct  = (comp.percentuale ?? 0) / 100;
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

// ─── Alert automatici ────────────────────────────────────────────
// Logica:
// - Stock = 0                         → 🔴 Critico sempre
// - Stock > 0 + rotazione nota:
//     copertura < 4 sett.             → 🔴 Critico
//     copertura 4-8 sett.             → 🟠 Attenzione
//     conflitto MP critico            → promuove di un livello
//     copertura > 8 sett.             → non mostrato
// - Stock > 0 + nessuna rotazione     → non mostrato (scorte ok, domanda ignota)
function generaAlertAutomatici(prodottiFiniti, prodottiMP, rotazioni) {
  const alerts = [];

  prodottiFiniti.forEach(pf => {
    if (pf.eliminato) return;

    const stock         = pf.quantitaRocche ?? 0;
    const rotazione     = rotazioni[pf.id] ?? 0;
    const producibilita = calcolaProducibilita(pf, prodottiMP);
    const conflitti     = trovaConflitti(pf, prodottiFiniti, rotazioni);

    // Stock zero → critico sempre
    if (stock === 0) {
      alerts.push({
        tipo: 'auto', livello: 'rosso', pf,
        rotazione, stock, producibilita,
        settimaneStock: 0, settimaneProd: producibilita !== null ? Infinity : null,
        settimaneTotali: producibilita !== null && producibilita > 0
          ? producibilita / Math.max(rotazione, 0.01)
          : 0,
        conflitti, motivoZero: true
      });
      return;
    }

    // Stock > 0 ma rotazione ignota → non mostrare
    if (rotazione === 0) return;

    const settimaneStock  = stock / rotazione;
    const settimaneProd   = producibilita !== null ? producibilita / rotazione : null;
    const settimaneTotali = settimaneStock + (settimaneProd ?? 0);
    const haConflittiCritici = conflitti.some(c => c.rapporto && c.rapporto >= 2);

    let livello;
    if (settimaneTotali < SOGLIA_ROSSO || (haConflittiCritici && settimaneStock < SOGLIA_ROSSO)) {
      livello = 'rosso';
    } else if (settimaneTotali < SOGLIA_ARANCIO || conflitti.length > 0) {
      livello = 'arancio';
    } else {
      return; // verde, non mostrare
    }

    alerts.push({ tipo: 'auto', livello, pf, rotazione, stock, producibilita,
      settimaneStock, settimaneProd, settimaneTotali, conflitti, motivoZero: false });
  });

  return alerts;
}

// ─── Alert manuali — rivalutazione automatica ────────────────────
// Il livello viene calcolato dal sistema in base a:
// - Settimane di copertura attuale del prodotto
// - Settimane mancanti all'evento (se dataEvento presente)
// - Senza data: usa la copertura diretta come gli automatici
function valutaAlertManuale(a, rotazioni, prodottiFiniti, prodottiMP) {
  const pf = prodottiFiniti.find(p => p.id === a.idProdotto);
  if (!pf) return { livello: 'arancio', settimaneEvento: null, copertura: null };

  const stock         = pf.quantitaRocche ?? 0;
  const rotazione     = rotazioni[pf.id] ?? 0;
  const producibilita = calcolaProducibilita(pf, prodottiMP);

  // Settimane all'evento (se data specificata)
  let settimaneEvento = null;
  if (a.dataEvento) {
    const ms = new Date(a.dataEvento + 'T00:00:00') - new Date();
    settimaneEvento = Math.max(0, ms / (1000 * 60 * 60 * 24 * 7));
  }

  // Copertura totale (stock + producibile)
  let copertura = null;
  if (stock === 0) {
    copertura = 0;
  } else if (rotazione > 0) {
    const settimaneStock = stock / rotazione;
    const settimaneProd  = producibilita !== null ? producibilita / rotazione : 0;
    copertura = settimaneStock + settimaneProd;
  }

  let livello;
  if (stock === 0) {
    livello = 'rosso';
  } else if (settimaneEvento !== null && copertura !== null) {
    // Con data evento: confronta copertura vs scadenza
    const margine = copertura - settimaneEvento;
    if (margine < 0)           livello = 'rosso';   // finisce prima dell'evento
    else if (margine < SOGLIA_ROSSO) livello = 'arancio'; // poco margine
    else                       livello = 'verde';
  } else if (copertura !== null) {
    // Senza data: usa le stesse soglie degli automatici
    if (copertura < SOGLIA_ROSSO)   livello = 'rosso';
    else if (copertura < SOGLIA_ARANCIO) livello = 'arancio';
    else                            livello = 'verde';
  } else {
    livello = 'arancio'; // non abbiamo dati sufficienti
  }

  return { livello, settimaneEvento, copertura };
}

// ─── Ordinamento ─────────────────────────────────────────────────
function priorita(a) {
  if (a.livello === 'rosso')   return a.tipo === 'auto' ? 0 : 1;
  if (a.livello === 'arancio') return a.tipo === 'auto' ? 2 : 3;
  return 4;
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(1) : '—'; }

// ─── Render inbox unificata ───────────────────────────────────────
function renderInbox() {
  const pf         = getProdottiFiniti();
  const mp         = getProdotti();
  const rot        = calcolaRotazioni();
  const automatici = generaAlertAutomatici(pf, mp, rot);

  // Manuali con livello rivalutato dal sistema
  const manualiCalcolati = alertManuali.map(a => {
    const valutazione = valutaAlertManuale(a, rot, pf, mp);
    return { tipo: 'manuale', ...a, ...valutazione };
  }).filter(a => a.livello !== 'verde'); // nascondi i verdi

  const tutti = [...automatici, ...manualiCalcolati].sort((a, b) => {
    const pa = priorita(a), pb = priorita(b);
    if (pa !== pb) return pa - pb;
    if (a.tipo === 'auto' && b.tipo === 'auto') return a.settimaneTotali - b.settimaneTotali;
    return 0;
  });

  const nRossi   = tutti.filter(a => a.livello === 'rosso').length;
  const nArancio = tutti.filter(a => a.livello === 'arancio').length;
  const nManuali = manualiCalcolati.length;

  const cR = document.getElementById('alert-count-rosso');
  const cA = document.getElementById('alert-count-arancio');
  const cM = document.getElementById('alert-count-manuale');
  if (cR) cR.textContent = nRossi;
  if (cA) cA.textContent = nArancio;
  if (cM) cM.textContent = nManuali;

  aggiornaBadge(nRossi);

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
  filtrati.forEach(a => list.appendChild(
    a.tipo === 'auto' ? creaRigaAuto(a) : creaRigaManuale(a)
  ));
  inbox.appendChild(list);
}

// ─── Riga alert automatico ────────────────────────────────────────
function creaRigaAuto(a) {
  const { livello, pf, rotazione, stock, producibilita,
    settimaneStock, settimaneProd, settimaneTotali, conflitti, motivoZero } = a;

  const conflittoIco = conflitti.length > 0
    ? `<i class="fas fa-triangle-exclamation alert-row-warn" title="Conflitto MP"></i>` : '';
  const settCol  = livello === 'rosso' ? 'sett-rosso' : 'sett-arancio';
  const settTesto = motivoZero ? 'Stock 0' : `${fmt(settimaneTotali)} sett.`;

  const row = document.createElement('div');
  row.className = `alert-row ${livello}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-bullet ${livello}"></span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${pf.nome ?? '—'} — ${pf.colore ?? '—'}</span>
        <span class="alert-row-colore">${pf.fornitore ?? ''}</span>
      </div>
      <span class="alert-row-sett ${settCol}">${settTesto}</span>
      ${conflittoIco}
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Stock attuale</span>
          <span class="alert-detail-val">${stock} rocche${rotazione > 0 ? ` (${fmt(settimaneStock)} sett.)` : ''}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Rotazione</span>
          <span class="alert-detail-val">${rotazione > 0 ? `${fmt(rotazione)} rocche/sett · ultimi ${GIORNI}gg` : 'Nessun dato storico'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Producibile</span>
          <span class="alert-detail-val">${producibilita !== null
            ? `${producibilita} rocche${rotazione > 0 ? ` (${fmt(settimaneProd)} sett.)` : ''}`
            : 'N/D — kgPerCartone mancante'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Copertura totale</span>
          <span class="alert-detail-val" style="font-weight:700">${motivoZero ? '—' : `${fmt(settimaneTotali)} settimane`}</span>
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
  const { livello, settimaneEvento, copertura } = a;
  const etichettaLivello = livello === 'rosso' ? '🔴' : '🟠';
  const data = a.createdAt?.toDate().toLocaleDateString('it-IT') ?? '—';
  const eventoFmt = a.dataEvento
    ? new Date(a.dataEvento + 'T00:00:00').toLocaleDateString('it-IT') : null;

  let sottotitolo = '';
  if (settimaneEvento !== null) {
    sottotitolo = settimaneEvento < 1
      ? 'Evento imminente'
      : `Evento tra ${Math.round(settimaneEvento)} settimane`;
  }

  const row = document.createElement('div');
  row.className = `alert-row manuale ${livello}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-pin">📌</span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${a.nomeProdotto ?? '—'}</span>
        <span class="alert-row-colore">${sottotitolo || a.note || ''}</span>
      </div>
      <span class="alert-row-sett" style="font-size:.7rem;color:var(--text-muted);font-weight:400">${etichettaLivello}</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Note</span>
          <span class="alert-detail-val">${a.note || '—'}</span>
        </div>
        ${eventoFmt ? `
        <div class="alert-detail-item">
          <span class="alert-detail-label">Data evento</span>
          <span class="alert-detail-val">${eventoFmt}${settimaneEvento !== null ? ` (tra ${Math.round(settimaneEvento)} sett.)` : ''}</span>
        </div>` : ''}
        ${copertura !== null ? `
        <div class="alert-detail-item">
          <span class="alert-detail-label">Copertura attuale</span>
          <span class="alert-detail-val">${copertura === 0 ? 'Stock esaurito' : `${fmt(copertura)} settimane`}</span>
        </div>` : ''}
        <div class="alert-detail-item">
          <span class="alert-detail-label">Inserito il</span>
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
function aggiornaBadge(nRossi) {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  badge.textContent = nRossi;
  badge.classList.toggle('hidden', nRossi === 0);
}

// ─── Modal alert ─────────────────────────────────────────────────
function apriNuovoAlert() {
  const form = document.getElementById('form-alert');
  form.reset();
  form.dataset.mode = 'add';
  document.getElementById('a-id').value = '';
  document.getElementById('a-submit-btn').textContent = 'Crea Alert';
  document.querySelector('#modal-alert .modal-title').textContent = 'Nuovo Alert';
  popolaSelectProdotti();
  openModal('modal-alert');
}

function apriModificaAlert(a) {
  const form = document.getElementById('form-alert');
  form.dataset.mode = 'edit';
  document.getElementById('a-id').value         = a.id;
  document.getElementById('a-note').value        = a.note ?? '';
  document.getElementById('a-data-evento').value = a.dataEvento ?? '';
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
  const form   = document.getElementById('form-alert');
  const sel    = document.getElementById('a-prodotto');
  const opt    = sel.selectedOptions[0];
  const note   = document.getElementById('a-note').value.trim();
  const dataEv = document.getElementById('a-data-evento').value || null;
  const btn    = document.getElementById('a-submit-btn');
  const id     = document.getElementById('a-id').value;
  const isEdit = form.dataset.mode === 'edit';

  btn.disabled = true;
  try {
    const dati = {
      idProdotto:   sel.value,
      nomeProdotto: opt?.dataset.nome ?? sel.value,
      note,
      dataEvento:   dataEv
    };
    if (isEdit && id) {
      await updateDoc(doc(db, "alert_manuali", id), dati);
    } else {
      await addDoc(collection(db, "alert_manuali"), { ...dati, createdAt: serverTimestamp() });
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
