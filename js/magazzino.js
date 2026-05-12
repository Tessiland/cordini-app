import {
  collection, query, orderBy, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { aggiungiFornitoreSeDiverso } from './fornitori.js';
import { openModal, closeModal } from './nav.js';

let db;
let operatoreCorrente = 'Operatori';
let tuttiProdotti = [];

export function setOperatore(email) {
  operatoreCorrente = email || 'Operatori';
}

export function getProdotti() {
  return tuttiProdotti;
}

export { apriModalAggiungi };

export function initMagazzino(firestoreDb) {
  db = firestoreDb;

  caricaProdotti();

  // Ricerca e filtro
  document.getElementById('search-mp').addEventListener('input', renderProdotti);
  document.getElementById('filter-fornitore').addEventListener('change', renderProdotti);

  // Bottone aggiungi materia prima nel tab
  document.getElementById('add-mp-btn').addEventListener('click', apriModalAggiungi);

  // Nuovo fornitore nel form
  document.getElementById('add-fornitore-btn').addEventListener('click', async () => {
    const nome = prompt('Nome del nuovo fornitore:');
    if (nome) await aggiungiFornitoreSeDiverso(nome);
  });

  // Submit form prodotto
  document.getElementById('form-prodotto').addEventListener('submit', salvaProdotto);

  // Click delegato sulle card
  document.getElementById('list-materia-prima').addEventListener('click', gestisciClickCard);
}

// ─── Caricamento real-time ───────────────────────────────────────
function caricaProdotti() {
  const q = query(collection(db, "prodotti"), orderBy("nome"));
  onSnapshot(q, snap => {
    tuttiProdotti = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProdotti();
  });
}

// ─── Render ─────────────────────────────────────────────────────
function renderProdotti() {
  const testo     = document.getElementById('search-mp').value.toLowerCase();
  const fornitore = document.getElementById('filter-fornitore').value;

  const filtrati = tuttiProdotti
    .filter(p => fornitore === 'tutti' || p.idFornitore === fornitore)
    .filter(p =>
      (p.nome?.toLowerCase().includes(testo)) ||
      (p.codice?.toLowerCase().includes(testo))
    );

  const container = document.getElementById('list-materia-prima');

  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto trovato.</p>';
    return;
  }

  container.innerHTML = '';
  filtrati.forEach(p => container.appendChild(creaCardProdotto(p)));
}

function creaCardProdotto(p) {
  const disponibili = p.quantitaDisponibile ?? 0;
  const soglia      = p.sogliaAvviso ?? 0;
  const ordinato    = p.quantitaOrdinata ?? 0;

  let statusClass = 'status-ok';
  let valueClass  = 'ok';
  if (disponibili <= soglia && disponibili > 0)  { statusClass = 'status-warning'; valueClass = 'warning'; }
  if (disponibili === 0)                          { statusClass = 'status-low';     valueClass = 'danger'; }

  const card = document.createElement('div');
  card.className = `product-card ${statusClass}`;
  card.dataset.id = p.id;

  const tags = [];
  if (ordinato > 0) {
    tags.push(`<span class="tag tag-ordered"><i class="fas fa-truck"></i> Ordinato: ${ordinato}</span>`);
    const dataSpedFmt = p.dataSpedizione
      ? new Date(p.dataSpedizione + 'T00:00:00').toLocaleDateString('it-IT')
      : 'n.d.';
    tags.push(`<span class="tag tag-spedizione"><i class="fas fa-box"></i> Spedizione effettuata il: ${dataSpedFmt}</span>`);
  }
  if (p.notaConsegna)     tags.push(`<span class="tag tag-delivery"><i class="fas fa-calendar-check"></i> ${p.notaConsegna}</span>`);

  card.innerHTML = `
    <div class="product-card-top">
      <div>
        <div class="product-card-title">${p.nome}</div>
        <div class="product-card-code">${p.codice || '—'}</div>
      </div>
      <div class="product-card-controls">
        <button class="btn-icon action-btn-edit edit-btn" data-id="${p.id}" title="Modifica">
          <i class="fas fa-pen"></i>
        </button>
        <button class="btn-icon action-btn-del delete-btn" data-id="${p.id}" data-nome="${p.nome}" title="Elimina">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    <div class="product-card-supplier"><i class="fas fa-building" style="margin-right:4px;opacity:.5"></i>${p.idFornitore}</div>
    <div class="product-card-stats">
      <div class="stat-box">
        <div class="stat-value ${valueClass}">${disponibili}</div>
        <div class="stat-label">Cartoni</div>
      </div>
      <div class="stat-box">
        <div class="stat-value ${valueClass}">${p.kgPerCartone ? (disponibili * p.kgPerCartone).toLocaleString('it-IT') : '—'}</div>
        <div class="stat-label">Kg totali</div>
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
    ${tags.length ? `<div class="tag-row">${tags.join('')}</div>` : ''}
  `;

  return card;
}

// ─── Click delegato ──────────────────────────────────────────────
function gestisciClickCard(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  const id = btn.dataset.id;

  if (btn.classList.contains('edit-btn')) {
    apriModalModifica(id);
  } else if (btn.classList.contains('delete-btn')) {
    eliminaProdotto(id, btn.dataset.nome);
  } else if (btn.classList.contains('plus') || btn.classList.contains('minus')) {
    btn.disabled = true;
    const azione = btn.classList.contains('plus') ? 'increment' : 'decrement';
    aggiornaQuantita(id, azione).finally(() => { btn.disabled = false; });
  }
}

// ─── Quantità ────────────────────────────────────────────────────
async function aggiornaQuantita(idProdotto, azione) {
  const prodotto = tuttiProdotti.find(p => p.id === idProdotto);
  if (!prodotto) return;

  const ref = doc(db, "prodotti", idProdotto);
  try {
    await runTransaction(db, async t => {
      const snap = await t.get(ref);
      if (!snap.exists()) throw "Prodotto non trovato";
      let nuova = (snap.data().quantitaDisponibile ?? 0) + (azione === 'increment' ? 1 : -1);
      if (nuova < 0) nuova = 0;
      t.update(ref, { quantitaDisponibile: nuova });
      t.set(doc(collection(db, "movimenti")), {
        idProdotto,
        nomeProdotto: prodotto.nome,
        tipo:         azione === 'increment' ? 'carico' : 'prelievo',
        quantita:     1,
        quantitaDopo: nuova,
        operatore:    operatoreCorrente,
        timestamp:    serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Errore aggiornamento quantità:", err);
  }
}

// ─── Modal Aggiungi / Modifica ───────────────────────────────────
function apriModalAggiungi() {
  const form = document.getElementById('form-prodotto');
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.id   = '';
  document.getElementById('modal-prodotto-title').textContent = 'Aggiungi Prodotto';
  document.querySelector('input[name="p-unita"][value="BOX"]').checked = true;
  openModal('modal-prodotto');
}

function apriModalModifica(id) {
  const p = tuttiProdotti.find(p => p.id === id);
  if (!p) return;

  const form = document.getElementById('form-prodotto');
  form.dataset.mode = 'edit';
  form.dataset.id   = id;
  document.getElementById('modal-prodotto-title').textContent = 'Modifica Prodotto';

  document.getElementById('p-nome').value     = p.nome    ?? '';
  document.getElementById('p-codice').value   = p.codice  ?? '';
  document.getElementById('p-fornitore').value = p.idFornitore ?? '';
  document.getElementById('p-quantita').value = p.quantitaDisponibile ?? 0;
  document.getElementById('p-soglia').value   = p.sogliaAvviso ?? 0;
  document.getElementById('p-minimo').value      = p.minimoOrdinabile ?? 1;
  document.getElementById('p-kg-cartone').value  = p.kgPerCartone ?? '';

  const unitaInput = document.querySelector(`input[name="p-unita"][value="${p.unitaDiAcquisto ?? 'BOX'}"]`);
  if (unitaInput) unitaInput.checked = true;

  openModal('modal-prodotto');
}

async function salvaProdotto(e) {
  e.preventDefault();
  const form = e.target;
  const { mode, id } = form.dataset;

  const kgRaw = document.getElementById('p-kg-cartone').value;
  const dati = {
    nome:               document.getElementById('p-nome').value.trim(),
    codice:             document.getElementById('p-codice').value.trim(),
    idFornitore:        document.getElementById('p-fornitore').value,
    quantitaDisponibile: Number(document.getElementById('p-quantita').value),
    sogliaAvviso:       Number(document.getElementById('p-soglia').value),
    unitaDiAcquisto:    document.querySelector('input[name="p-unita"]:checked').value,
    minimoOrdinabile:   Number(document.getElementById('p-minimo').value),
    kgPerCartone:       kgRaw !== '' ? Number(kgRaw) : null
  };

  try {
    if (mode === 'edit') {
      dati.quantitaOrdinata = tuttiProdotti.find(p => p.id === id)?.quantitaOrdinata ?? 0;
      await updateDoc(doc(db, "prodotti", id), dati);
    } else {
      dati.quantitaOrdinata = 0;
      await addDoc(collection(db, "prodotti"), dati);
    }
    closeModal('modal-prodotto');
  } catch (err) {
    console.error("Errore salvataggio prodotto:", err);
  }
}

async function eliminaProdotto(id, nome) {
  if (!confirm(`Eliminare "${nome}"?`)) return;
  try {
    await deleteDoc(doc(db, "prodotti", id));
  } catch (err) {
    console.error("Errore eliminazione:", err);
  }
}
