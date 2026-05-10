import {
  collection, query, orderBy, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, closeModal } from './nav.js';
import { getProdotti } from './magazzino.js';

let db;
let operatoreCorrente = 'Operatori';
let tuttiProdottiFiniti = [];

export function setOperatorePF(email) {
  operatoreCorrente = email || 'Operatori';
}

export function getProdottiFiniti() {
  return tuttiProdottiFiniti;
}

export function initProdottoFinito(firestoreDb) {
  db = firestoreDb;
  carica();
  document.getElementById('search-pf').addEventListener('input', render);
  document.getElementById('list-prodotto-finito').addEventListener('click', gestisciClick);
  document.getElementById('form-prodotto-finito').addEventListener('submit', salva);
  document.getElementById('add-pf-btn').addEventListener('click', apriAggiungi);

  // Quando cambia fornitore, aggiorna il select dei prodotti
  document.getElementById('pf-fornitore').addEventListener('change', aggiornaProdottiSelect);
}

// ─── Caricamento real-time ───────────────────────────────────────
function carica() {
  const q = query(collection(db, "prodotti_finiti"), orderBy("nome"));
  onSnapshot(q, snap => {
    tuttiProdottiFiniti = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const f = (a.fornitore ?? '').localeCompare(b.fornitore ?? '');
        return f !== 0 ? f : (a.nome ?? '').localeCompare(b.nome ?? '');
      });
    render();
  }, err => console.error("Errore caricamento prodotti finiti:", err));
}

// ─── Render ──────────────────────────────────────────────────────
function render() {
  const testo = document.getElementById('search-pf').value.toLowerCase();
  const filtrati = tuttiProdottiFiniti.filter(p =>
    p.nome?.toLowerCase().includes(testo) ||
    p.fornitore?.toLowerCase().includes(testo) ||
    p.partita?.toLowerCase().includes(testo)
  );

  const container = document.getElementById('list-prodotto-finito');
  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto finito registrato.</p>';
    return;
  }

  container.innerHTML = '';
  filtrati.forEach(p => container.appendChild(creaCard(p)));
}

function creaCard(p) {
  const rocche = p.quantitaRocche ?? 0;
  const soglia = p.sogliaAvviso  ?? 0;

  let statusClass = 'status-ok';
  let valueClass  = 'ok';
  if (rocche <= soglia && rocche > 0) { statusClass = 'status-warning'; valueClass = 'warning'; }
  if (rocche === 0)                   { statusClass = 'status-low';     valueClass = 'danger'; }

  const card = document.createElement('div');
  card.className = `product-card ${statusClass}`;
  card.dataset.id = p.id;

  card.innerHTML = `
    <div class="product-card-top">
      <div>
        <div class="product-card-title">${p.nome}</div>
        <div class="product-card-code">${p.partita ? `Partita: ${p.partita}` : '—'}</div>
      </div>
      <div class="product-card-controls">
        <button class="btn-icon action-btn-edit edit-pf-btn" data-id="${p.id}" title="Modifica">
          <i class="fas fa-pen"></i>
        </button>
        <button class="btn-icon action-btn-del delete-pf-btn" data-id="${p.id}" data-nome="${p.nome}" title="Elimina">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    <div class="product-card-supplier">
      <i class="fas fa-building" style="margin-right:4px;opacity:.5"></i>${p.fornitore}
    </div>
    <div class="product-card-stats">
      <div class="stat-box" style="grid-column: span 2">
        <div class="stat-value ${valueClass}">${rocche}</div>
        <div class="stat-label">Rocche disponibili</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${soglia}</div>
        <div class="stat-label">Soglia</div>
      </div>
    </div>
    <div class="product-card-qty">
      <button class="qty-btn minus" data-id="${p.id}">−</button>
      <button class="qty-btn plus"  data-id="${p.id}">+</button>
    </div>
  `;

  return card;
}

// ─── Click delegato ──────────────────────────────────────────────
function gestisciClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains('edit-pf-btn')) {
    apriModifica(id);
  } else if (btn.classList.contains('delete-pf-btn')) {
    elimina(id, btn.dataset.nome);
  } else if (btn.classList.contains('plus') || btn.classList.contains('minus')) {
    btn.disabled = true;
    const azione = btn.classList.contains('plus') ? 'increment' : 'decrement';
    aggiornaQuantita(id, azione).finally(() => { btn.disabled = false; });
  }
}

// ─── Quantità ────────────────────────────────────────────────────
async function aggiornaQuantita(idProdotto, azione) {
  const prodotto = tuttiProdottiFiniti.find(p => p.id === idProdotto);
  if (!prodotto) return;
  const ref = doc(db, "prodotti_finiti", idProdotto);
  try {
    await runTransaction(db, async t => {
      const snap = await t.get(ref);
      if (!snap.exists()) throw "Prodotto non trovato";
      let nuova = (snap.data().quantitaRocche ?? 0) + (azione === 'increment' ? 1 : -1);
      if (nuova < 0) nuova = 0;
      t.update(ref, { quantitaRocche: nuova });
      t.set(doc(collection(db, "movimenti_pf")), {
        idProdotto,
        nomeProdotto: `${prodotto.fornitore} — ${prodotto.nome}`,
        tipo:         azione === 'increment' ? 'carico' : 'prelievo',
        quantita:     1,
        quantitaDopo: nuova,
        operatore:    operatoreCorrente,
        timestamp:    serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Errore aggiornamento rocche:", err);
  }
}

// ─── Popola select prodotti per fornitore ────────────────────────
function aggiornaProdottiSelect(fornitoreSelezionato) {
  const fornitore = typeof fornitoreSelezionato === 'string'
    ? fornitoreSelezionato
    : document.getElementById('pf-fornitore').value;

  const prodottiFornitore = getProdotti()
    .filter(p => p.idFornitore === fornitore)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const nomeSelect = document.getElementById('pf-nome');
  if (prodottiFornitore.length === 0) {
    nomeSelect.innerHTML = '<option value="">— Nessun prodotto per questo fornitore —</option>';
  } else {
    nomeSelect.innerHTML = prodottiFornitore
      .map(p => `<option value="${p.nome}">${p.nome}${p.codice ? ` (${p.codice})` : ''}</option>`)
      .join('');
  }
}

// ─── Modal ───────────────────────────────────────────────────────
function apriAggiungi() {
  const form = document.getElementById('form-prodotto-finito');
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.id   = '';
  document.getElementById('modal-pf-title').textContent = 'Aggiungi Prodotto Finito';
  document.getElementById('pf-error').textContent = '';
  // reset select prodotti
  document.getElementById('pf-nome').innerHTML = '<option value="">— Seleziona prima un fornitore —</option>';
  openModal('modal-prodotto-finito');
}

function apriModifica(id) {
  const p = tuttiProdottiFiniti.find(p => p.id === id);
  if (!p) return;
  const form = document.getElementById('form-prodotto-finito');
  form.dataset.mode = 'edit';
  form.dataset.id   = id;
  document.getElementById('modal-pf-title').textContent = 'Modifica Prodotto Finito';
  document.getElementById('pf-fornitore').value = p.fornitore ?? '';
  // popola prodotti per il fornitore e poi seleziona il valore
  aggiornaProdottiSelect(p.fornitore ?? '');
  document.getElementById('pf-nome').value   = p.nome    ?? '';
  document.getElementById('pf-partita').value = p.partita ?? '';
  document.getElementById('pf-rocche').value = p.quantitaRocche ?? 0;
  document.getElementById('pf-soglia').value = p.sogliaAvviso  ?? 0;
  document.getElementById('pf-error').textContent = '';
  openModal('modal-prodotto-finito');
}

async function salva(e) {
  e.preventDefault();
  const form    = e.target;
  const errEl   = document.getElementById('pf-error');
  const saveBtn = form.querySelector('[type="submit"]');

  errEl.textContent = '';
  saveBtn.disabled  = true;

  const dati = {
    fornitore:     document.getElementById('pf-fornitore').value,
    nome:          document.getElementById('pf-nome').value.trim(),
    partita:       document.getElementById('pf-partita').value.trim(),
    quantitaRocche: Number(document.getElementById('pf-rocche').value),
    sogliaAvviso:  Number(document.getElementById('pf-soglia').value)
  };

  try {
    if (form.dataset.mode === 'edit') {
      await updateDoc(doc(db, "prodotti_finiti", form.dataset.id), dati);
    } else {
      await addDoc(collection(db, "prodotti_finiti"), dati);
    }
    closeModal('modal-prodotto-finito');
  } catch (err) {
    console.error("Errore salvataggio prodotto finito:", err);
    errEl.textContent = 'Errore nel salvataggio. Controlla la connessione.';
  } finally {
    saveBtn.disabled = false;
  }
}

async function elimina(id, nome) {
  if (!confirm(`Eliminare "${nome}"?`)) return;
  try {
    await deleteDoc(doc(db, "prodotti_finiti", id));
  } catch (err) {
    console.error("Errore eliminazione:", err);
  }
}

export { apriAggiungi as apriModalAggiuntaPF };
