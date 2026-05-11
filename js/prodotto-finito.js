import {
  collection, query, orderBy, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, closeModal } from './nav.js';
import { aggiuntaTipologia } from './tipologie.js';
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
  document.getElementById('add-pf-btn').addEventListener('click', apriAggiungi);
  document.getElementById('form-prodotto-finito').addEventListener('submit', salva);
  document.getElementById('add-tipologia-btn').addEventListener('click', aggiuntaTipologia);
  document.getElementById('pf-fornitore').addEventListener('change', aggiornaColoriDaFornitore);
}

// stato apertura accordion annidato
const statiAperti = { fornitori: new Set(), tipologie: new Set() };

// ─── Caricamento real-time ───────────────────────────────────────
function carica() {
  const q = query(collection(db, "prodotti_finiti"), orderBy("nome"));
  onSnapshot(q, snap => {
    tuttiProdottiFiniti = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => console.error("Errore caricamento prodotti finiti:", err));
}

// ─── Render accordion annidato ───────────────────────────────────
function render() {
  const testo = document.getElementById('search-pf').value.toLowerCase();

  const filtrati = tuttiProdottiFiniti.filter(p =>
    !testo ||
    p.fornitore?.toLowerCase().includes(testo) ||
    p.nome?.toLowerCase().includes(testo) ||
    p.colore?.toLowerCase().includes(testo) ||
    p.partita?.toLowerCase().includes(testo)
  );

  const container = document.getElementById('list-prodotto-finito');

  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto finito trovato.</p>';
    return;
  }

  // Raggruppa: fornitore → tipologia → colori
  const perFornitore = {};
  filtrati.forEach(p => {
    const f = p.fornitore ?? '—';
    const t = p.nome      ?? '—';
    if (!perFornitore[f]) perFornitore[f] = {};
    if (!perFornitore[f][t]) perFornitore[f][t] = [];
    perFornitore[f][t].push(p);
  });

  container.innerHTML = '';
  const hasTesto = testo.length > 0;

  Object.keys(perFornitore).sort().forEach(fornitore => {
    const tipologie = perFornitore[fornitore];
    const totale    = Object.values(tipologie).flat().length;
    const fornAperto = statiAperti.fornitori.has(fornitore) || hasTesto;

    const block = document.createElement('div');
    block.className = `pf-fornitore-block${fornAperto ? ' open' : ''}`;
    block.dataset.fornitore = fornitore;

    // Header fornitore
    const header = document.createElement('div');
    header.className = 'pf-fornitore-header';
    header.innerHTML = `
      <div>
        <div class="pf-fornitore-name">${fornitore}</div>
        <div class="pf-fornitore-count">${totale} prodott${totale === 1 ? 'o' : 'i'}</div>
      </div>
      <i class="fas fa-chevron-right pf-fornitore-chevron"></i>
    `;
    header.addEventListener('click', () => {
      const aperto = block.classList.toggle('open');
      aperto
        ? statiAperti.fornitori.add(fornitore)
        : statiAperti.fornitori.delete(fornitore);
    });
    block.appendChild(header);

    // Body fornitore
    const body = document.createElement('div');
    body.className = 'pf-fornitore-body';

    Object.keys(tipologie).sort().forEach(tipologia => {
      const chiaveTip  = `${fornitore}__${tipologia}`;
      const tipAperta  = statiAperti.tipologie.has(chiaveTip) || hasTesto;
      const colori     = tipologie[tipologia];

      const group = document.createElement('div');
      group.className = `pf-tipologia-group${tipAperta ? ' open' : ''}`;

      // Header tipologia (cliccabile)
      const tipHeader = document.createElement('div');
      tipHeader.className = 'pf-tipologia-header';
      tipHeader.innerHTML = `
        <div class="pf-tipologia-name">${tipologia}</div>
        <div class="pf-tipologia-info">
          <span class="pf-tipologia-count">${colori.length} color${colori.length === 1 ? 'e' : 'i'}</span>
          <i class="fas fa-chevron-right pf-tipologia-chevron"></i>
        </div>
      `;
      tipHeader.addEventListener('click', () => {
        const aperto = group.classList.toggle('open');
        aperto
          ? statiAperti.tipologie.add(chiaveTip)
          : statiAperti.tipologie.delete(chiaveTip);
      });
      group.appendChild(tipHeader);

      // Body tipologia — righe colori
      const tipBody = document.createElement('div');
      tipBody.className = 'pf-tipologia-body';
      colori
        .sort((a, b) => (a.colore ?? '').localeCompare(b.colore ?? ''))
        .forEach(p => tipBody.appendChild(creaRigaColore(p)));
      group.appendChild(tipBody);

      body.appendChild(group);
    });

    block.appendChild(body);
    container.appendChild(block);
  });
}

function creaRigaColore(p) {
  const rocche = p.quantitaRocche ?? 0;
  const soglia  = p.sogliaAvviso  ?? 0;

  let stockClass = 'ok';
  if (rocche <= soglia && rocche > 0) stockClass = 'warning';
  if (rocche === 0)                   stockClass = 'danger';

  const tipoBadge = p.tipoLavorazione === 'raccatura'
    ? `<span class="tag tag-warning" style="font-size:.6rem">RACCATURA</span>`
    : '';

  const row = document.createElement('div');
  row.className = 'pf-color-row';
  row.dataset.id = p.id;

  row.innerHTML = `
    <div class="pf-color-info">
      <div class="pf-color-name">${p.colore || p.nome || '—'} ${tipoBadge}</div>
      <div class="pf-color-sub">
        ${p.ubicazione ? `<span><i class="fas fa-location-dot"></i> ${p.ubicazione}</span>` : ''}
        ${p.partita    ? `<span>· ${p.partita}</span>` : ''}
        ${p.sku        ? `<span>· ${p.sku}</span>` : ''}
      </div>
    </div>
    <div>
      <div class="pf-color-stock ${stockClass}">${rocche}</div>
      <div class="pf-color-unit">rocche</div>
    </div>
    <div class="pf-color-actions">
      <button class="pf-qty-btn minus" data-id="${p.id}">−</button>
      <button class="pf-qty-btn plus"  data-id="${p.id}">+</button>
      <button class="pf-row-menu edit-pf-btn" data-id="${p.id}" title="Modifica">
        <i class="fas fa-pen"></i>
      </button>
      <button class="pf-row-menu delete-pf-btn" data-id="${p.id}" data-nome="${p.colore}" title="Elimina">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;

  return row;
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
  } else if (btn.classList.contains('pf-qty-btn')) {
    btn.disabled = true;
    const azione = btn.classList.contains('plus') ? 'increment' : 'decrement';
    aggiornaQuantita(id, azione).finally(() => { btn.disabled = false; });
  }
}

// ─── Quantità ────────────────────────────────────────────────────
async function aggiornaQuantita(idProdotto, azione) {
  const p = tuttiProdottiFiniti.find(p => p.id === idProdotto);
  if (!p) return;
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
        nomeProdotto: `${p.fornitore} — ${p.nome} — ${p.colore}`,
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

// ─── Colori da materia prima ──────────────────────────────────────
function aggiornaColoriDaFornitore(fornitoreSelezionato) {
  const fornitore = typeof fornitoreSelezionato === 'string'
    ? fornitoreSelezionato
    : document.getElementById('pf-fornitore').value;

  const sel = document.getElementById('pf-colore');

  if (!fornitore) {
    sel.innerHTML = '<option value="">— Seleziona prima un fornitore —</option>';
    return;
  }

  const prodotti = getProdotti()
    .filter(p => p.idFornitore === fornitore)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  if (prodotti.length === 0) {
    sel.innerHTML = '<option value="">— Nessun prodotto per questo fornitore —</option>';
  } else {
    sel.innerHTML = `<option value="">— Seleziona colore/prodotto —</option>` +
      prodotti.map(p => `<option value="${p.nome}">${p.nome}${p.codice ? ` (${p.codice})` : ''}</option>`).join('');
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
  aggiornaColoriDaFornitore('');
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
  document.getElementById('pf-tipologia').value = p.nome      ?? '';
  aggiornaColoriDaFornitore(p.fornitore ?? '');
  document.getElementById('pf-colore').value    = p.colore    ?? '';
  document.getElementById('pf-partita').value   = p.partita   ?? '';
  document.getElementById('pf-rocche').value    = p.quantitaRocche ?? 0;
  document.getElementById('pf-soglia').value    = p.sogliaAvviso  ?? 0;
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
    fornitore:      document.getElementById('pf-fornitore').value,
    nome:           document.getElementById('pf-tipologia').value,
    colore:         document.getElementById('pf-colore').value.trim(),
    partita:        document.getElementById('pf-partita').value.trim(),
    quantitaRocche: Number(document.getElementById('pf-rocche').value),
    sogliaAvviso:   Number(document.getElementById('pf-soglia').value)
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
