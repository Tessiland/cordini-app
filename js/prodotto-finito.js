import {
  collection, query, orderBy, limit, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, closeModal } from './nav.js';
import { aggiornaDatalists } from './tipologie.js';
import { getProdotti } from './magazzino.js';
import { getFornitori, normalizzaFornitore } from './fornitori.js';
import { stampaEtichetta } from './etichette.js';

let db;
let operatoreCorrente = 'Operatori';
let tuttiProdottiFiniti = [];
let coloriComponentiForm = [];
let archivioVisibile = false;
let idSorgentePF = null;

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
  document.getElementById('toggle-archivio-pf').addEventListener('click', toggleArchivio);
  document.getElementById('form-nuova-partita').addEventListener('submit', salvaNuovaPartita);
  document.getElementById('storico-movimenti-btn').addEventListener('click', apriStoricoMovimenti);
  document.getElementById('storico-search').addEventListener('input', renderStorico);
  document.getElementById('storico-operatore').addEventListener('change', renderStorico);
  document.getElementById('storico-tipo').addEventListener('change', renderStorico);
  document.querySelectorAll('.storico-tab').forEach(btn =>
    btn.addEventListener('click', () => caricaStoricoTab(btn.dataset.storicoTab))
  );

  document.getElementById('add-colore-btn').addEventListener('click', () => {
    coloriComponentiForm.push({ idFornitore: '', idProdotto: '', nomeColore: '', percentuale: 0 });
    renderColoriComponentiForm();
  });

  document.getElementById('pf-fornitore').addEventListener('input', e => {
    const val = e.target.value.trim();
    impostaModalitaFornitore(val === 'STOCK');
    if (!document.getElementById('pf-colori-section').classList.contains('hidden')) {
      renderColoriComponentiForm();
    }
  });

  document.querySelectorAll('input[name="pf-lavorazione"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const fornVal = document.getElementById('pf-fornitore').value.trim();
      impostaModalitaFornitore(fornVal === 'STOCK');
    });
  });
}

function impostaModalitaFornitore(isStock) {
  const lavorazione   = document.querySelector('input[name="pf-lavorazione"]:checked')?.value;
  const isRoccatura   = lavorazione === 'roccatura';
  const usaColoreSemplice = isStock || isRoccatura;

  document.getElementById('pf-colore-stock-group').classList.toggle('hidden', !usaColoreSemplice);
  document.getElementById('pf-colori-section').classList.toggle('hidden', usaColoreSemplice);
  document.getElementById('pf-roccatura-note').classList.toggle('hidden', !isRoccatura);
}

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
    if (archivioVisibile) renderArchivio();
  }, err => console.error("Errore caricamento prodotti finiti:", err));
}

// ─── Render accordion annidato ───────────────────────────────────
function render() {
  const testo = document.getElementById('search-pf').value.toLowerCase();

  const filtrati = tuttiProdottiFiniti.filter(p =>
    !p.eliminato &&
    (!testo ||
      p.fornitore?.toLowerCase().includes(testo) ||
      p.nome?.toLowerCase().includes(testo) ||
      p.colore?.toLowerCase().includes(testo) ||
      p.partita?.toLowerCase().includes(testo))
  );

  const container = document.getElementById('list-prodotto-finito');

  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto finito trovato.</p>';
    return;
  }

  // Raggruppa: fornitore → tipologia → colore → [partite]
  const perFornitore = {};
  filtrati.forEach(p => {
    const f = p.fornitore ?? '—';
    const t = p.nome      ?? '—';
    const c = p.colore    ?? '—';
    if (!perFornitore[f]) perFornitore[f] = {};
    if (!perFornitore[f][t]) perFornitore[f][t] = {};
    if (!perFornitore[f][t][c]) perFornitore[f][t][c] = [];
    perFornitore[f][t][c].push(p);
  });

  container.innerHTML = '';
  const hasTesto = testo.length > 0;
  const sortIT = (a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' });

  Object.keys(perFornitore).sort(sortIT).forEach(fornitore => {
    const tipologie = perFornitore[fornitore];
    const totale = Object.values(tipologie).flatMap(t => Object.values(t)).flat().length;
    const fornAperto = statiAperti.fornitori.has(fornitore) || hasTesto;

    const block = document.createElement('div');
    block.className = `pf-fornitore-block${fornAperto ? ' open' : ''}`;
    block.dataset.fornitore = fornitore;

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

    const body = document.createElement('div');
    body.className = 'pf-fornitore-body';

    Object.keys(tipologie).sort(sortIT).forEach(tipologia => {
      const chiaveTip = `${fornitore}__${tipologia}`;
      const tipAperta = statiAperti.tipologie.has(chiaveTip) || hasTesto;
      const colori    = tipologie[tipologia];

      const numColori  = Object.keys(colori).length;
      const numPartite = Object.values(colori).flat().length;
      const infoColori = numPartite > numColori
        ? `${numColori} color${numColori === 1 ? 'e' : 'i'} · ${numPartite} partite`
        : `${numColori} color${numColori === 1 ? 'e' : 'i'}`;

      const group = document.createElement('div');
      group.className = `pf-tipologia-group${tipAperta ? ' open' : ''}`;

      const tipHeader = document.createElement('div');
      tipHeader.className = 'pf-tipologia-header';
      tipHeader.innerHTML = `
        <div class="pf-tipologia-name">${tipologia}</div>
        <div class="pf-tipologia-info">
          <span class="pf-tipologia-count">${infoColori}</span>
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

      const tipBody = document.createElement('div');
      tipBody.className = 'pf-tipologia-body';

      Object.keys(colori).sort(sortIT).forEach(colore => {
        const partite = [...colori[colore]].sort((a, b) =>
          (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
        );

        if (partite.length === 1) {
          tipBody.appendChild(creaRigaColore(partite[0]));
        } else {
          const totRocche = partite.reduce((s, p) => s + (p.quantitaRocche ?? 0), 0);
          const coloreGroup = document.createElement('div');
          coloreGroup.className = 'pf-colore-group';

          const coloreHeader = document.createElement('div');
          coloreHeader.className = 'pf-colore-group-header';
          coloreHeader.innerHTML = `
            <div class="pf-color-name">${colore}</div>
            <div style="display:flex;align-items:center;gap:.75rem">
              <div class="pf-colore-group-count">${partite.length} partite · ${totRocche} rocche totali</div>
              <button class="btn-ghost btn-sm aggiungi-partita-btn" data-id="${partite[0].id}"
                style="font-size:.7rem;padding:.2rem .5rem;height:auto">
                <i class="fas fa-plus"></i> Partita
              </button>
            </div>
          `;
          coloreGroup.appendChild(coloreHeader);

          partite.forEach((p, idx) => {
            coloreGroup.appendChild(creaRigaPartita(p, idx === 0));
          });

          tipBody.appendChild(coloreGroup);
        }
      });

      group.appendChild(tipBody);
      body.appendChild(group);
    });

    block.appendChild(body);
    container.appendChild(block);
  });
}

// ─── Riga singola partita (usata quando ci sono più partite per colore) ──
function creaRigaPartita(p, isPrima) {
  const rocche = p.quantitaRocche ?? 0;
  const soglia  = p.sogliaAvviso  ?? 0;

  let stockClass = 'ok';
  if (rocche <= soglia && rocche > 0) stockClass = 'warning';
  if (rocche === 0)                   stockClass = 'danger';

  const primaBadge = isPrima
    ? `<span class="tag tag-prima-partita">PRIMA</span>`
    : '';

  const row = document.createElement('div');
  row.className = 'pf-partita-row';
  row.dataset.id = p.id;

  row.innerHTML = `
    <div class="pf-partita-info">
      <div class="pf-partita-detail">
        ${primaBadge}
        ${p.partita
          ? `<span class="pf-meta-chip pf-meta-partita"><i class="fas fa-tag"></i> ${p.partita}</span>`
          : `<span class="pf-meta-chip" style="color:var(--text-muted)">Partita non specificata</span>`}
        ${p.ubicazione
          ? `<span class="pf-meta-chip pf-meta-location"><i class="fas fa-location-dot"></i> ${p.ubicazione}</span>`
          : ''}
        ${p.sku
          ? `<span class="pf-meta-chip pf-meta-sku"><i class="fas fa-barcode"></i> ${p.sku}</span>`
          : ''}
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
      <button class="pf-row-menu elimina-pf-btn" data-id="${p.id}" title="Archivia come eliminato">
        <i class="fas fa-ban"></i>
      </button>
      <button class="pf-row-menu delete-pf-btn" data-id="${p.id}" data-nome="${p.colore}" title="Cancella definitivamente">
        <i class="fas fa-trash"></i>
      </button>
      <button class="pf-row-menu print-label-btn" data-id="${p.id}" title="Stampa etichetta">
        <i class="fas fa-tag"></i>
      </button>
    </div>
  `;

  return row;
}

// ─── Riga colore standard (una sola partita) ─────────────────────
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

  const isRoccatura = p.tipoLavorazione === 'roccatura';
  const mixHtml = p.coloriComponenti?.length > 1
    ? `<span class="pf-mix">${p.coloriComponenti.map(c => `${c.percentuale}% ${c.nomeColore}`).join(' · ')}</span>`
    : (!isStock && !isRoccatura && !p.coloriComponenti?.length && p.colore)
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
      <button class="pf-aggiungi-partita-link aggiungi-partita-btn" data-id="${p.id}">
        <i class="fas fa-plus"></i> aggiungi partita
      </button>
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
      <button class="pf-row-menu elimina-pf-btn" data-id="${p.id}" title="Archivia come eliminato">
        <i class="fas fa-ban"></i>
      </button>
      <button class="pf-row-menu delete-pf-btn" data-id="${p.id}" data-nome="${p.colore}" title="Cancella definitivamente">
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

  if (btn.classList.contains('aggiungi-partita-btn')) {
    apriNuovaPartita(id);
  } else if (btn.classList.contains('edit-pf-btn')) {
    apriModifica(id);
  } else if (btn.classList.contains('elimina-pf-btn')) {
    archivia(id);
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

// ─── Archivia / Ripristina / Elimina ────────────────────────────
async function archivia(id) {
  const p = tuttiProdottiFiniti.find(p => p.id === id);
  if (!p) return;
  if (!confirm(`Archiviare "${p.colore}" come ELIMINATO?\nNon sarà più visibile nel magazzino ma rimarrà nell'archivio e potrà essere ripristinato.`)) return;
  try {
    await updateDoc(doc(db, "prodotti_finiti", id), { eliminato: true });
  } catch (err) {
    console.error("Errore archiviazione:", err);
  }
}

// ─── Nuova partita (copia dati da prodotto esistente) ───────────
function apriNuovaPartita(idSorgente) {
  idSorgentePF = idSorgente;
  const sorgente = tuttiProdottiFiniti.find(p => p.id === idSorgente);
  if (!sorgente) return;
  const form = document.getElementById('form-nuova-partita');
  form.reset();
  document.getElementById('np-rocche').value = 0;
  document.getElementById('np-error').textContent = '';
  document.getElementById('np-prodotto-info').textContent =
    `${sorgente.fornitore ?? '—'} · ${sorgente.nome ?? '—'} · ${sorgente.colore ?? '—'}`;
  openModal('modal-nuova-partita');
}

async function salvaNuovaPartita(e) {
  e.preventDefault();
  const sorgente = tuttiProdottiFiniti.find(p => p.id === idSorgentePF);
  if (!sorgente) return;
  const errEl   = document.getElementById('np-error');
  const saveBtn = e.target.querySelector('[type="submit"]');
  errEl.textContent = '';
  saveBtn.disabled  = true;
  try {
    await addDoc(collection(db, "prodotti_finiti"), {
      fornitore:        sorgente.fornitore,
      nome:             sorgente.nome,
      colore:           sorgente.colore,
      coloriComponenti: sorgente.coloriComponenti ?? [],
      tipoLavorazione:  sorgente.tipoLavorazione  ?? 'cordini',
      sogliaAvviso:     sorgente.sogliaAvviso      ?? 0,
      sku:              sorgente.sku               ?? '',
      partita:          document.getElementById('np-partita').value.trim(),
      ubicazione:       document.getElementById('np-ubicazione').value.trim(),
      quantitaRocche:   Number(document.getElementById('np-rocche').value),
      eliminato:        false,
      maiConsegnata:    true,
      createdAt:        serverTimestamp()
    });
    apriGruppo(sorgente.fornitore, sorgente.nome);
    closeModal('modal-nuova-partita');
  } catch (err) {
    console.error("Errore salvataggio nuova partita:", err);
    errEl.textContent = 'Errore nel salvataggio. Controlla la connessione.';
  } finally {
    saveBtn.disabled = false;
  }
}

async function ripristina(id) {
  if (!confirm('Ripristinare questo prodotto nel magazzino attivo?')) return;
  try {
    await updateDoc(doc(db, "prodotti_finiti", id), { eliminato: false });
  } catch (err) {
    console.error("Errore ripristino:", err);
  }
}

async function elimina(id, nome) {
  if (!confirm(`Eliminare definitivamente "${nome}"? L'operazione non è reversibile.`)) return;
  try {
    await deleteDoc(doc(db, "prodotti_finiti", id));
  } catch (err) {
    console.error("Errore eliminazione:", err);
  }
}

// ─── Archivio eliminati ──────────────────────────────────────────
function toggleArchivio() {
  archivioVisibile = !archivioVisibile;
  const btn  = document.getElementById('toggle-archivio-pf');
  const list = document.getElementById('list-archivio-pf');
  btn.innerHTML = archivioVisibile
    ? `<i class="fas fa-eye-slash"></i> Nascondi Archivio`
    : `<i class="fas fa-archive"></i> Archivio Eliminati`;
  list.classList.toggle('hidden', !archivioVisibile);
  if (archivioVisibile) renderArchivio();
}

function renderArchivio() {
  const eliminati = tuttiProdottiFiniti.filter(p => p.eliminato);
  const container = document.getElementById('list-archivio-pf');

  if (eliminati.length === 0) {
    container.innerHTML = '<div class="pf-archivio-section"><h4>Archivio Eliminati</h4><p class="empty-state">Nessun prodotto archiviato.</p></div>';
    return;
  }

  const sortIT = (a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' });
  const sorted = [...eliminati].sort((a, b) =>
    sortIT(a.nome ?? '', b.nome ?? '') || sortIT(a.colore ?? '', b.colore ?? '')
  );

  container.innerHTML = '';
  const section = document.createElement('div');
  section.className = 'pf-archivio-section';
  section.innerHTML = `<h4><i class="fas fa-archive" style="margin-right:.35rem"></i>Archivio Eliminati (${eliminati.length})</h4>`;

  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'pf-archivio-row';
    row.innerHTML = `
      <div>
        <div class="pf-archivio-nome">${p.nome ?? '—'} — ${p.colore ?? '—'}</div>
        <div class="pf-archivio-meta">
          ${p.fornitore ? `<span>${p.fornitore}</span>` : ''}
          ${p.partita   ? `<span>Partita: ${p.partita}</span>` : ''}
          ${p.sku       ? `<span>SKU: ${p.sku}</span>` : ''}
        </div>
      </div>
      <button class="btn-ghost btn-sm ripristina-pf-btn" data-id="${p.id}" style="flex-shrink:0">
        <i class="fas fa-undo"></i> Ripristina
      </button>
    `;
    row.querySelector('.ripristina-pf-btn').addEventListener('click', () => ripristina(p.id));
    section.appendChild(row);
  });

  container.appendChild(section);
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
  document.getElementById('pf-nome-multicolore').value = '';
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
  document.getElementById('pf-nome-multicolore').value = p.colore ?? '';
  const isStock     = p.fornitore === 'STOCK';
  const isRoccatura = (p.tipoLavorazione ?? 'cordini') === 'roccatura';
  impostaModalitaFornitore(isStock);
  if (isStock || isRoccatura) {
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

  const fornitore   = document.getElementById('pf-fornitore').value.trim();
  const isStock     = fornitore === 'STOCK';
  const lavorazione = document.querySelector('input[name="pf-lavorazione"]:checked')?.value;
  const isRoccatura = lavorazione === 'roccatura';

  let coloreCalcolato;
  let coloriDaSalvare;

  if (isStock || isRoccatura) {
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
    const nomeDisplay = document.getElementById('pf-nome-multicolore').value.trim();
    if (coloriComponentiForm.length === 1) {
      coloreCalcolato = nomeDisplay || coloriComponentiForm[0].nomeColore;
    } else {
      if (!nomeDisplay) {
        errEl.textContent = 'Inserisci il nome del colore.';
        return;
      }
      coloreCalcolato = nomeDisplay;
    }
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
      await addDoc(collection(db, "prodotti_finiti"), {
        ...dati,
        eliminato:     false,
        maiConsegnata: true,
        createdAt:     serverTimestamp()
      });
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
  const container           = document.getElementById('colori-list');
  const prodotti            = getProdotti().sort((a, b) => a.nome.localeCompare(b.nome));
  const fornitori           = getFornitori();
  const fornitorePrincipale = document.getElementById('pf-fornitore').value.trim();

  container.innerHTML = '';

  coloriComponentiForm.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'colore-form-row';

    // Preseleziona il fornitore principale se la riga non ha ancora un fornitore
    const fornitoreRiga = c.idFornitore || fornitorePrincipale;

    const opzFornitori = fornitori.map(f =>
      `<option value="${f.nome}" ${f.nome === fornitoreRiga ? 'selected' : ''}>${f.nome}</option>`
    ).join('');

    const filtrati = fornitoreRiga
      ? prodotti.filter(p =>
          normalizzaFornitore(p.idFornitore) === normalizzaFornitore(fornitoreRiga)
        )
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
      coloriComponentiForm[i].idProdotto  = e.target.value;
      coloriComponentiForm[i].nomeColore  = opt?.dataset.nome ?? '';
      coloriComponentiForm[i].idFornitore = fornitoreRiga;
      // Auto-compila il nome colore se è ancora vuoto (solo per monocomponente)
      if (coloriComponentiForm.length === 1) {
        const campoNome = document.getElementById('pf-nome-multicolore');
        if (!campoNome.value) campoNome.value = coloriComponentiForm[i].nomeColore;
      }
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

  // Il campo nome colore è sempre visibile
  document.getElementById('pf-nome-multicolore-group').classList.remove('hidden');

  aggiornaTotalePercColori();
}

function aggiornaTotalePercColori() {
  const tot = coloriComponentiForm.reduce((s, c) => s + (c.percentuale || 0), 0);
  const el  = document.getElementById('pf-perc-totale-colori');
  el.textContent = `${tot}%`;
  el.className   = `perc-totale${tot === 100 ? ' ok' : tot > 100 ? ' errore' : ''}`;
}

// ─── Ripristino prodotti finiti da CSV ───────────────────────────
// Formato atteso: separatore ; | colonne: (vuoto);(vuoto);Cod.;Descrizione;Libero 4;Q.tà in giacenza;Fornitore;Ubicazione;Note
async function ripristinaDaCSV(e) {
  const file     = e.target.files[0];
  const statusEl = document.getElementById('import-qty-status');
  if (!file) return;
  e.target.value = '';

  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Lettura CSV…';

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const testo = ev.target.result;
      const wb    = XLSX.read(testo, { type: 'string', FS: ';' });
      const rows  = XLSX.utils.sheet_to_json(
        wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }
      );

      // Individua colonne dal header (flessibile)
      const hdr   = (rows[0] ?? []).map(h => String(h).trim().toLowerCase());
      const iSku  = hdr.findIndex(h => h === 'cod.');
      const iDesc = hdr.findIndex(h => h === 'descrizione');
      const iPart = hdr.findIndex(h => h === 'libero 4' || h.includes('libero'));
      const iQty  = hdr.findIndex(h => h.includes('giacenza') || h.includes('q.tà'));
      const iForn = hdr.findIndex(h => h === 'fornitore');
      const iUbic = hdr.findIndex(h => h === 'ubicazione');
      const iNote = hdr.findIndex(h => h === 'note');

      if (iSku === -1 || iDesc === -1) {
        throw new Error('Colonne non trovate. Verifica che il CSV abbia: Cod., Descrizione, Fornitore');
      }

      const prodotti = [];
      for (let i = 1; i < rows.length; i++) {
        const row  = rows[i];
        const sku  = String(row[iSku]  ?? '').trim();
        const desc = String(row[iDesc] ?? '').trim();
        if (!sku || !desc) continue;

        // Separa tipologia e colore dalla descrizione
        // Formato atteso: "Nome Tipologia Colore Grammi N gr"
        const parteProdotto = desc.split(/\s+grammi\s+/i)[0].trim();
        const parole        = parteProdotto.split(' ');
        const colore        = parole.length > 1 ? parole[parole.length - 1] : parteProdotto;
        const nome          = parole.length > 1 ? parole.slice(0, -1).join(' ') : parteProdotto;

        // Fornitore normalizzato
        const fornitoreCsv  = String(row[iForn] ?? '').trim();
        const normForn      = normalizzaFornitore(fornitoreCsv);
        const fornMatch     = getFornitori().find(f => normalizzaFornitore(f.nome) === normForn);
        const fornitore     = fornMatch
          ? fornMatch.nome
          : (normForn.charAt(0).toUpperCase() + normForn.slice(1).toLowerCase());

        const qty       = parseInt(String(row[iQty] ?? '0').replace(/\D/g, '')) || 0;
        const partita   = String(row[iPart] ?? '').trim();
        const ubicazione = String(row[iUbic] ?? '').trim();
        const note      = String(row[iNote] ?? '').trim();

        prodotti.push({ sku, nome, colore, fornitore, qty, partita, ubicazione, note });
      }

      if (prodotti.length === 0) {
        throw new Error('Nessun prodotto valido trovato nel CSV.');
      }

      const preview = prodotti.slice(0, 5).map(p =>
        `${p.fornitore} — ${p.nome} — ${p.colore} (${p.qty} rocche)`
      ).join('\n');
      const extra = prodotti.length > 5 ? `\n…e altri ${prodotti.length - 5}` : '';

      if (!confirm(
        `Ripristinare ${prodotti.length} prodotti finiti?\n\n${preview}${extra}\n\nATTENZIONE: verranno creati nuovi documenti in Firestore.\n\nProcedo?`
      )) {
        statusEl.textContent = '';
        return;
      }

      statusEl.textContent = 'Creazione prodotti in corso…';

      // Batch a blocchi da 200
      const CHUNK = 200;
      for (let i = 0; i < prodotti.length; i += CHUNK) {
        const batch = writeBatch(db);
        prodotti.slice(i, i + CHUNK).forEach(p => {
          const ref = doc(collection(db, "prodotti_finiti"));
          batch.set(ref, {
            sku:              p.sku,
            nome:             p.nome,
            colore:           p.colore,
            fornitore:        p.fornitore,
            partita:          p.partita,
            ubicazione:       p.ubicazione,
            quantitaRocche:   p.qty,
            sogliaAvviso:     0,
            tipoLavorazione:  'cordini',
            coloriComponenti: [],
            eliminato:        false,
            maiConsegnata:    true,
            createdAt:        serverTimestamp()
          });
        });
        await batch.commit();
        statusEl.textContent = `Creati ${Math.min(i + CHUNK, prodotti.length)}/${prodotti.length}…`;
      }

      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ ${prodotti.length} prodotti ripristinati correttamente.`;
      apriGruppo(prodotti[0]?.fornitore ?? '', prodotti[0]?.nome ?? '');
      setTimeout(() => { statusEl.textContent = ''; }, 8000);

    } catch (err) {
      console.error("Errore ripristino CSV:", err);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Errore: ${err.message}`;
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ─── Aggiorna partita e ubicazione da CSV (abbina per SKU) ──────
async function aggiornaPartiteDaCSV(e) {
  const file     = e.target.files[0];
  const statusEl = document.getElementById('import-qty-status');
  if (!file) return;
  e.target.value = '';

  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Lettura CSV…';

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb   = XLSX.read(ev.target.result, { type: 'string', FS: ';' });
      const rows = XLSX.utils.sheet_to_json(
        wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }
      );

      const hdr   = (rows[0] ?? []).map(h => String(h).trim().toLowerCase());
      const iSku  = hdr.findIndex(h => h === 'cod.');
      const iPart = hdr.findIndex(h => h === 'libero 4' || h.includes('libero'));
      const iUbic = hdr.findIndex(h => h === 'ubicazione');

      if (iSku === -1 || iPart === -1) {
        throw new Error('Colonne non trovate. Usa il file Prodotti-11-5-26.csv con le colonne: Cod., Libero 4, Ubicazione');
      }

      // Mappa SKU → {partita, ubicazione} dal CSV
      const csvMap = new Map();
      for (let i = 1; i < rows.length; i++) {
        const row  = rows[i];
        const sku  = String(row[iSku]  ?? '').trim();
        const part = String(row[iPart] ?? '').trim();
        const ubic = String(row[iUbic] ?? '').trim();
        if (sku) csvMap.set(sku, { partita: part, ubicazione: ubic });
      }

      // Abbina ai prodotti finiti esistenti per SKU
      const aggiornamenti = [];
      tuttiProdottiFiniti.forEach(pf => {
        if (!pf.sku) return;
        const dati = csvMap.get(pf.sku);
        if (!dati) return;
        if (dati.partita === (pf.partita ?? '') && dati.ubicazione === (pf.ubicazione ?? '')) return;
        aggiornamenti.push({ id: pf.id, sku: pf.sku, ...dati });
      });

      if (aggiornamenti.length === 0) {
        statusEl.style.color = 'var(--success)';
        statusEl.textContent = '✓ Tutti i prodotti hanno già partita e ubicazione aggiornate.';
        return;
      }

      const preview = aggiornamenti.slice(0, 5).map(a =>
        `SKU ${a.sku}: partita "${a.partita}" | ubicazione "${a.ubicazione}"`
      ).join('\n');
      const extra = aggiornamenti.length > 5 ? `\n…e altri ${aggiornamenti.length - 5}` : '';

      if (!confirm(`Aggiornare partita e ubicazione per ${aggiornamenti.length} prodotti?\n\n${preview}${extra}\n\nProcedo?`)) {
        statusEl.textContent = '';
        return;
      }

      statusEl.textContent = 'Aggiornamento in corso…';

      const CHUNK = 200;
      for (let i = 0; i < aggiornamenti.length; i += CHUNK) {
        const batch = writeBatch(db);
        aggiornamenti.slice(i, i + CHUNK).forEach(a => {
          batch.update(doc(db, "prodotti_finiti", a.id), {
            partita:    a.partita,
            ubicazione: a.ubicazione
          });
        });
        await batch.commit();
      }

      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ ${aggiornamenti.length} prodotti aggiornati con partita e ubicazione.`;
      setTimeout(() => { statusEl.textContent = ''; }, 6000);

    } catch (err) {
      console.error("Errore aggiornamento partite:", err);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Errore: ${err.message}`;
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ─── Import quantità da Excel ────────────────────────────────────
async function importaQuantita(e) {
  const file     = e.target.files[0];
  const statusEl = document.getElementById('import-qty-status');
  if (!file) return;
  e.target.value = '';

  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Lettura file…';

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb   = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(
        wb.Sheets[wb.SheetNames[0]], { header: 1 }
      );

      // Normalizza header (trim spazi e lowercase)
      const hdr    = (rows[0] ?? []).map(h => String(h ?? '').trim().toLowerCase());
      const iSku   = hdr.findIndex(h => h === 'sku');
      const iQty   = hdr.findIndex(h => h.replace(/\s/g, '') === 'q.tà' || h.replace(/\s/g, '') === 'qty' || h === 'quantita' || h === 'quantità');

      if (iSku === -1 || iQty === -1) {
        throw new Error('Colonne non trovate. Il file deve avere: sku, Q.tà');
      }

      // Mappa SKU → prima partita valida (oldest createdAt, non eliminata)
      const pfPerSku = {};
      tuttiProdottiFiniti.filter(p => p.sku && !p.eliminato).forEach(p => {
        if (!pfPerSku[p.sku]) pfPerSku[p.sku] = [];
        pfPerSku[p.sku].push(p);
      });
      const skuMap = new Map();
      for (const [sku, partite] of Object.entries(pfPerSku)) {
        partite.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        skuMap.set(sku, partite[0]);
      }

      // Leggi righe
      const aggiornamenti = [];
      const nonTrovati    = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const sku = String(row[iSku] ?? '').trim();
        const qty = Number(row[iQty]);
        if (!sku || isNaN(qty) || qty < 0) continue;

        const pf = skuMap.get(sku);
        if (!pf) { nonTrovati.push(sku); continue; }

        aggiornamenti.push({ pf, nuovaQty: Math.round(qty) });
      }

      if (aggiornamenti.length === 0) {
        statusEl.style.color = 'var(--warning)';
        statusEl.textContent = `Nessun prodotto trovato. ${nonTrovati.length} SKU non abbinati.`;
        return;
      }

      // Anteprima
      const preview = aggiornamenti.slice(0, 5).map(a =>
        `${a.pf.nome} — ${a.pf.colore}: ${a.pf.quantitaRocche ?? 0} → ${a.nuovaQty}`
      ).join('\n');
      const extra = aggiornamenti.length > 5 ? `\n…e altri ${aggiornamenti.length - 5}` : '';
      const nonTrovatiMsg = nonTrovati.length > 0 ? `\n\n⚠ ${nonTrovati.length} SKU non trovati` : '';

      if (!confirm(`Aggiornare ${aggiornamenti.length} prodotti?\n\n${preview}${extra}${nonTrovatiMsg}\n\nProcedo?`)) {
        statusEl.textContent = '';
        return;
      }

      statusEl.textContent = 'Aggiornamento in corso…';

      // Batch a blocchi da 200 (400 ops/batch)
      const CHUNK = 200;
      for (let i = 0; i < aggiornamenti.length; i += CHUNK) {
        const batch = writeBatch(db);
        aggiornamenti.slice(i, i + CHUNK).forEach(({ pf, nuovaQty }) => {
          const ref = doc(db, "prodotti_finiti", pf.id);
          batch.update(ref, { quantitaRocche: nuovaQty });
          batch.set(doc(collection(db, "movimenti_pf")), {
            idProdotto:   pf.id,
            nomeProdotto: `${pf.fornitore} — ${pf.nome} — ${pf.colore}`,
            tipo:         'carico',
            quantita:     nuovaQty,
            quantitaDopo: nuovaQty,
            nota:         'Import da Excel',
            operatore:    operatoreCorrente,
            timestamp:    serverTimestamp()
          });
        });
        await batch.commit();
      }

      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ ${aggiornamenti.length} prodotti aggiornati${nonTrovati.length > 0 ? ` · ${nonTrovati.length} SKU non trovati` : ''}.`;
      setTimeout(() => { statusEl.textContent = ''; }, 5000);

    } catch (err) {
      console.error("Errore import quantità:", err);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Errore: ${err.message}`;
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Migrazione one-time: rimuove suffisso "Multicolore" dal campo colore ──
export async function rimuoviSuffissoMulticolore() {
  const btn = document.getElementById('rimuovi-multicolore-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analisi…'; }

  try {
    const daAggiornare = tuttiProdottiFiniti.filter(p =>
      p.colore && / multicolore$/i.test(p.colore.trim())
    );

    if (daAggiornare.length === 0) {
      alert('Nessun prodotto da correggere. Il database è già pulito.');
      return;
    }

    const preview = daAggiornare.slice(0, 8).map(p =>
      `• "${p.colore}"  →  "${p.colore.replace(/ multicolore$/i, '').trim()}"`
    ).join('\n');
    const extra = daAggiornare.length > 8 ? `\n…e altri ${daAggiornare.length - 8}` : '';

    if (!confirm(`${daAggiornare.length} prodotti da correggere:\n\n${preview}${extra}\n\nProcedo?`)) return;

    if (btn) btn.textContent = 'Migrazione…';

    await Promise.all(daAggiornare.map(p =>
      updateDoc(doc(db, "prodotti_finiti", p.id), {
        colore: p.colore.replace(/ multicolore$/i, '').trim()
      })
    ));

    alert(`✓ Corretti ${daAggiornare.length} prodotti.`);
  } catch (err) {
    console.error("Errore migrazione Multicolore:", err);
    alert(`Errore: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Rimuovi "Multicolore"'; }
  }
}

// ─── Storico movimenti ───────────────────────────────────────────
const storicoCache = { pf: [], mp: [] };
let storicoTabAttiva = 'pf';

async function apriStoricoMovimenti() {
  openModal('modal-storico-movimenti');
  document.getElementById('storico-search').value = '';
  document.getElementById('storico-tipo').value   = '';
  await caricaStoricoTab(storicoTabAttiva);
}

async function caricaStoricoTab(tab) {
  storicoTabAttiva = tab;
  document.querySelectorAll('.storico-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.storicoTab === tab)
  );

  const collez  = tab === 'pf' ? 'movimenti_pf' : 'movimenti';
  const unita   = tab === 'pf' ? 'rocche' : 'cartoni';
  const el      = document.getElementById('storico-movimenti-list');

  el.innerHTML = '<p class="empty-state">Caricamento…</p>';
  document.getElementById('storico-count').textContent = '';

  try {
    const q    = query(collection(db, collez), orderBy("timestamp", "desc"), limit(300));
    const snap = await getDocs(q);
    storicoCache[tab] = snap.docs.map(d => ({ id: d.id, _unita: unita, ...d.data() }));
    popolaFiltroOperatori();
    renderStorico();
  } catch (err) {
    console.error("Errore caricamento storico:", err);
    el.innerHTML = '<p class="empty-state">Errore nel caricamento.</p>';
  }
}

function popolaFiltroOperatori() {
  const dati      = storicoCache[storicoTabAttiva];
  const operatori = [...new Set(dati.map(m => m.operatore).filter(Boolean))].sort();
  const sel       = document.getElementById('storico-operatore');
  sel.innerHTML   = '<option value="">Tutti gli operatori</option>' +
    operatori.map(o => `<option value="${o}">${o}</option>`).join('');
}

function renderStorico() {
  const dati      = storicoCache[storicoTabAttiva];
  const cerca     = document.getElementById('storico-search').value.toLowerCase().trim();
  const operatore = document.getElementById('storico-operatore').value;
  const tipo      = document.getElementById('storico-tipo').value;

  let filtrati = dati;
  if (cerca)     filtrati = filtrati.filter(m => m.nomeProdotto?.toLowerCase().includes(cerca));
  if (operatore) filtrati = filtrati.filter(m => m.operatore === operatore);
  if (tipo)      filtrati = filtrati.filter(m => m.tipo === tipo);

  const countEl = document.getElementById('storico-count');
  countEl.textContent = `${filtrati.length} moviment${filtrati.length === 1 ? 'o' : 'i'}${dati.length >= 300 ? ' (ultimi 300)' : ''}`;

  const container = document.getElementById('storico-movimenti-list');

  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun movimento trovato.</p>';
    return;
  }

  const tipoConfig = {
    carico:    { label: 'Carico',    cls: 'tipo-carico' },
    prelievo:  { label: 'Prelievo',  cls: 'tipo-prelievo' },
    rettifica: { label: 'Rettifica', cls: 'tipo-rettifica' },
  };

  const header = `
    <div class="storico-mov-header">
      <span>Data</span><span>Prodotto</span><span>Tipo</span>
      <span style="text-align:right">Qtà</span>
      <span style="text-align:right">Dopo</span>
      <span style="text-align:right">Operatore</span>
    </div>`;

  const righe = filtrati.map(m => {
    const ts    = m.timestamp?.toDate?.() ?? null;
    const data  = ts ? ts.toLocaleDateString('it-IT') : '—';
    const ora   = ts ? ts.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const cfg   = tipoConfig[m.tipo] ?? { label: m.tipo ?? '—', cls: '' };
    const isPos = m.tipo !== 'prelievo';
    const segno = isPos ? '+' : '−';
    const nota  = m.nota ? `<span class="storico-mov-nota">${m.nota}</span>` : '';

    return `
      <div class="storico-mov-row">
        <div class="storico-mov-data">${data}<br>${ora}</div>
        <div class="storico-mov-prodotto" title="${m.nomeProdotto ?? ''}">${m.nomeProdotto ?? '—'}${nota}</div>
        <div><span class="storico-mov-tipo ${cfg.cls}">${cfg.label}</span></div>
        <div class="storico-mov-qty ${isPos ? 'pos' : 'neg'}">${segno}${m.quantita ?? 0}</div>
        <div class="storico-mov-dopo">${m.quantitaDopo ?? 0} <small>${m._unita}</small></div>
        <div class="storico-mov-operatore">${m.operatore ?? '—'}</div>
      </div>`;
  }).join('');

  container.innerHTML = header + righe;
}

export { apriAggiungi as apriModalAggiuntaPF };
