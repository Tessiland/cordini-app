import {
  collection, query, orderBy, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, closeModal } from './nav.js';
import { aggiornaDatalists } from './tipologie.js';
import { getProdotti } from './magazzino.js';
import { getFornitori } from './fornitori.js';
import { stampaEtichetta } from './etichette.js';

let db;
let operatoreCorrente = 'Operatori';
let tuttiProdottiFiniti = [];
let coloriComponentiForm = [];

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

  document.getElementById('add-colore-btn').addEventListener('click', () => {
    coloriComponentiForm.push({ idFornitore: '', idProdotto: '', nomeColore: '', percentuale: 0 });
    renderColoriComponentiForm();
  });

  document.getElementById('pf-fornitore').addEventListener('input', e => {
    impostaModalitaFornitore(e.target.value.trim() === 'STOCK');
  });
}

function impostaModalitaFornitore(isStock) {
  document.getElementById('pf-colore-stock-group').classList.toggle('hidden', !isStock);
  document.getElementById('pf-colori-section').classList.toggle('hidden', isStock);
}

// IBRIDI usa la stessa UI dei cordini normali (isStock = false)

// stato apertura accordion annidato
const statiAperti = { fornitori: new Set(), tipologie: new Set() };

function apriGruppo(fornitore, tipologia) {
  statiAperti.fornitori.add(fornitore);
  statiAperti.tipologie.add(`${fornitore}__${tipologia}`);
}

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

  const sortIT = (a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' });

  Object.keys(perFornitore).sort(sortIT).forEach(fornitore => {
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

    Object.keys(tipologie).sort(sortIT).forEach(tipologia => {
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
        .sort((a, b) => (a.colore ?? '').localeCompare(b.colore ?? '', 'it', { sensitivity: 'base' }))
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

  const tipoBadge = p.tipoLavorazione === 'roccatura'
    ? `<span class="tag tag-warning" style="font-size:.6rem">ROCCATURA</span>`
    : p.fornitore === 'IBRIDI'
      ? `<span class="tag tag-ibrido" style="font-size:.6rem">IBRIDO</span>`
      : '';

  const isStock = p.fornitore === 'STOCK';

  const nomeColoreDisplay = p.coloriComponenti?.length === 1
    ? p.coloriComponenti[0].nomeColore
    : (p.colore || p.nome || '—');

  const mixHtml = p.coloriComponenti?.length > 1
    ? `<span class="pf-mix">${p.coloriComponenti.map(c => `${c.percentuale}% ${c.nomeColore}`).join(' · ')}</span>`
    : (!isStock && !p.coloriComponenti?.length && p.colore)
      ? `<span class="pf-mix pf-mix-legacy">⚠ da rimappare</span>`
      : '';

  const row = document.createElement('div');
  row.className = 'pf-color-row';
  row.dataset.id = p.id;

  row.innerHTML = `
    <div class="pf-color-info">
      <div class="pf-color-name">${nomeColoreDisplay} ${tipoBadge}</div>
      ${mixHtml}
      <div class="pf-color-meta">
        ${p.ubicazione ? `<span class="pf-meta-chip pf-meta-location"><i class="fas fa-location-dot"></i> ${p.ubicazione}</span>` : ''}
        ${p.partita    ? `<span class="pf-meta-chip pf-meta-partita"><i class="fas fa-tag"></i> ${p.partita}</span>` : ''}
        ${p.sku        ? `<span class="pf-meta-chip pf-meta-sku"><i class="fas fa-barcode"></i> ${p.sku}</span>` : ''}
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
      <button class="pf-row-menu print-label-btn" data-id="${p.id}" title="Stampa etichetta">
        <i class="fas fa-tag"></i>
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
  } else if (btn.classList.contains('print-label-btn')) {
    const p = tuttiProdottiFiniti.find(p => p.id === id);
    if (p) stampaEtichetta(p);
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

// ─── Modal ───────────────────────────────────────────────────────
function apriAggiungi() {
  const form = document.getElementById('form-prodotto-finito');
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.id   = '';
  document.getElementById('modal-pf-title').textContent = 'Aggiungi Prodotto Finito';
  document.getElementById('pf-error').textContent = '';
  document.getElementById('pf-colore-originale').classList.add('hidden');
  document.getElementById('pf-colore-stock').value = '';
  impostaModalitaFornitore(false);
  coloriComponentiForm = [{ idFornitore: '', idProdotto: '', nomeColore: '', percentuale: 100 }];
  renderColoriComponentiForm();
  aggiornaDatalists();
  openModal('modal-prodotto-finito');
}

function apriModifica(id) {
  const p = tuttiProdottiFiniti.find(p => p.id === id);
  if (!p) return;
  const form = document.getElementById('form-prodotto-finito');
  form.dataset.mode = 'edit';
  form.dataset.id   = id;
  document.getElementById('modal-pf-title').textContent = 'Modifica Prodotto Finito';
  document.getElementById('pf-fornitore').value  = p.fornitore    ?? '';
  document.getElementById('pf-tipologia').value  = p.nome         ?? '';
  document.getElementById('pf-ubicazione').value = p.ubicazione   ?? '';
  document.getElementById('pf-partita').value    = p.partita      ?? '';
  document.getElementById('pf-rocche').value     = p.quantitaRocche ?? 0;
  document.getElementById('pf-soglia').value     = p.sogliaAvviso ?? 0;
  const lav = document.querySelector(`input[name="pf-lavorazione"][value="${p.tipoLavorazione ?? 'cordini'}"]`);
  if (lav) lav.checked = true;
  document.getElementById('pf-error').textContent = '';
  const isStock = p.fornitore === 'STOCK';
  impostaModalitaFornitore(isStock);
  if (isStock) {
    document.getElementById('pf-colore-stock').value = p.colore ?? '';
    document.getElementById('pf-colore-originale').classList.add('hidden');
  } else {
    document.getElementById('pf-colore-stock').value = '';
    const hintEl = document.getElementById('pf-colore-originale');
    if (!p.coloriComponenti?.length && p.colore) {
      hintEl.textContent = `Testo attuale: "${p.colore}"`;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }
    coloriComponentiForm = p.coloriComponenti?.length > 0
      ? p.coloriComponenti.map(c => ({ ...c }))
      : [{ idFornitore: p.fornitore ?? '', idProdotto: '', nomeColore: '', percentuale: 100 }];
    renderColoriComponentiForm();
  }
  aggiornaDatalists();
  openModal('modal-prodotto-finito');
}

async function salva(e) {
  e.preventDefault();
  const form    = e.target;
  const errEl   = document.getElementById('pf-error');
  const saveBtn = form.querySelector('[type="submit"]');

  errEl.textContent = '';

  const fornitore = document.getElementById('pf-fornitore').value.trim();
  const isStock   = fornitore === 'STOCK';

  let coloreCalcolato;
  let coloriDaSalvare;

  if (isStock) {
    coloreCalcolato  = document.getElementById('pf-colore-stock').value.trim() || '—';
    coloriDaSalvare  = [];
  } else {
    if (coloriComponentiForm.some(c => !c.idProdotto)) {
      errEl.textContent = 'Seleziona la materia prima per ogni riga colore.';
      return;
    }
    const tot = coloriComponentiForm.reduce((s, c) => s + (c.percentuale || 0), 0);
    if (tot !== 100) {
      errEl.textContent = `Le percentuali colore devono sommare 100% (attuale: ${tot}%).`;
      return;
    }
    coloreCalcolato = coloriComponentiForm.length === 1
      ? coloriComponentiForm[0].nomeColore
      : 'Multicolore';
    coloriDaSalvare = coloriComponentiForm.map(c => ({
      idProdotto:  c.idProdotto,
      nomeColore:  c.nomeColore,
      idFornitore: c.idFornitore,
      percentuale: c.percentuale
    }));
  }

  saveBtn.disabled = true;

  const dati = {
    fornitore,
    nome:             document.getElementById('pf-tipologia').value.trim(),
    colore:           coloreCalcolato,
    coloriComponenti: coloriDaSalvare,
    ubicazione:       document.getElementById('pf-ubicazione').value.trim(),
    partita:          document.getElementById('pf-partita').value.trim(),
    quantitaRocche:   Number(document.getElementById('pf-rocche').value),
    sogliaAvviso:     Number(document.getElementById('pf-soglia').value),
    tipoLavorazione:  document.querySelector('input[name="pf-lavorazione"]:checked').value
  };

  try {
    if (form.dataset.mode === 'edit') {
      await updateDoc(doc(db, "prodotti_finiti", form.dataset.id), dati);
    } else {
      await addDoc(collection(db, "prodotti_finiti"), dati);
    }
    apriGruppo(dati.fornitore, dati.nome);
    closeModal('modal-prodotto-finito');
  } catch (err) {
    console.error("Errore salvataggio prodotto finito:", err);
    errEl.textContent = 'Errore nel salvataggio. Controlla la connessione.';
  } finally {
    saveBtn.disabled = false;
  }
}

// ─── Colori componenti (multicolore) ────────────────────────────
function renderColoriComponentiForm() {
  const container = document.getElementById('colori-list');
  const prodotti  = getProdotti().sort((a, b) => a.nome.localeCompare(b.nome));
  const fornitori = getFornitori();

  container.innerHTML = '';

  coloriComponentiForm.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'colore-form-row';

    const opzFornitori = fornitori.map(f =>
      `<option value="${f.nome}" ${f.nome === c.idFornitore ? 'selected' : ''}>${f.nome}</option>`
    ).join('');

    const filtrati = c.idFornitore
      ? prodotti.filter(p => p.idFornitore === c.idFornitore)
      : prodotti;

    const opzProdotti = filtrati.map(p =>
      `<option value="${p.id}" data-nome="${p.nome}" ${p.id === c.idProdotto ? 'selected' : ''}>${p.nome}</option>`
    ).join('');

    row.innerHTML = `
      <div class="colore-form-selects">
        <select class="colore-forn-sel" data-index="${i}">
          <option value="">— Fornitore —</option>
          ${opzFornitori}
        </select>
        <select class="colore-prod-sel" data-index="${i}">
          <option value="">— Colore materia prima —</option>
          ${opzProdotti}
        </select>
      </div>
      <div class="colore-form-right">
        <input type="number" class="colore-perc-inp" data-index="${i}"
               value="${c.percentuale}" min="0" max="100" step="1">
        <span class="perc-symbol">%</span>
        <button type="button" class="btn-icon action-btn-del colore-rm-btn" data-index="${i}" title="Rimuovi">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
    `;

    row.querySelector('.colore-forn-sel').addEventListener('change', e => {
      coloriComponentiForm[i].idFornitore = e.target.value;
      coloriComponentiForm[i].idProdotto  = '';
      coloriComponentiForm[i].nomeColore  = '';
      renderColoriComponentiForm();
    });

    row.querySelector('.colore-prod-sel').addEventListener('change', e => {
      const opt = e.target.selectedOptions[0];
      coloriComponentiForm[i].idProdotto = e.target.value;
      coloriComponentiForm[i].nomeColore = opt?.dataset.nome ?? '';
      aggiornaTotalePercColori();
    });

    row.querySelector('.colore-perc-inp').addEventListener('input', e => {
      coloriComponentiForm[i].percentuale = Number(e.target.value) || 0;
      aggiornaTotalePercColori();
    });

    row.querySelector('.colore-rm-btn').addEventListener('click', () => {
      coloriComponentiForm.splice(i, 1);
      renderColoriComponentiForm();
    });

    container.appendChild(row);
  });

  aggiornaTotalePercColori();
}

function aggiornaTotalePercColori() {
  const tot = coloriComponentiForm.reduce((s, c) => s + (c.percentuale || 0), 0);
  const el  = document.getElementById('pf-perc-totale-colori');
  el.textContent = `${tot}%`;
  el.className   = `perc-totale${tot === 100 ? ' ok' : tot > 100 ? ' errore' : ''}`;
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
