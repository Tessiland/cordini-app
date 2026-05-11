import {
  collection, query, orderBy, onSnapshot, doc,
  addDoc, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, closeModal } from './nav.js';
import { getProdotti } from './magazzino.js';

const ADMIN_EMAIL = 'giovanni@tessiland.com';

let db;
let isAdmin   = false;
let catalogo  = [];
let componentiForm = []; // stato locale per la ricetta nel modal

export function initCatalogo(firestoreDb, userEmail) {
  db      = firestoreDb;
  isAdmin = userEmail === ADMIN_EMAIL;

  // Mostra controlli admin
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  carica();

  document.getElementById('search-catalogo').addEventListener('input', render);
  document.getElementById('add-anagrafica-btn').addEventListener('click', apriAggiungi);
  document.getElementById('import-btn').addEventListener('click', avviaImport);
  document.getElementById('list-catalogo').addEventListener('click', gestisciClick);
  document.getElementById('add-componente-btn').addEventListener('click', () => {
    componentiForm.push({ idProdotto: '', nomeProdotto: '', percentuale: 0 });
    renderComponentiForm();
  });
  document.getElementById('form-anagrafica').addEventListener('submit', salva);
}

export function getCatalogo() { return catalogo; }

// ─── Caricamento ─────────────────────────────────────────────────
function carica() {
  const q = query(collection(db, "anagrafica"), orderBy("nome"));
  onSnapshot(q, snap => {
    catalogo = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => console.error("Errore caricamento catalogo:", err));
}

// ─── Render lista ────────────────────────────────────────────────
function render() {
  const testo    = document.getElementById('search-catalogo').value.toLowerCase();
  const filtrati = catalogo.filter(p =>
    !testo ||
    p.nome?.toLowerCase().includes(testo) ||
    p.sku?.toLowerCase().includes(testo)
  );

  const container = document.getElementById('list-catalogo');
  if (filtrati.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto in catalogo.</p>';
    return;
  }

  container.innerHTML = '';
  filtrati.forEach(p => container.appendChild(creaCard(p)));
}

function creaCard(p) {
  const componenti = p.componenti ?? [];
  const card = document.createElement('div');
  card.className = 'catalogo-card';
  card.dataset.id = p.id;

  const compoHtml = componenti.length === 0
    ? '<span style="color:var(--text-muted);font-size:.78rem">Nessun componente definito</span>'
    : componenti.map(c => `
        <div class="componente-row">
          <span class="componente-nome">${c.nomeProdotto}</span>
          <div class="componente-bar">
            <div class="componente-bar-fill" style="width:${c.percentuale}%"></div>
          </div>
          <span class="componente-perc">${c.percentuale}%</span>
        </div>`).join('');

  const adminControls = isAdmin ? `
    <div style="display:flex;gap:.25rem">
      <button class="btn-icon action-btn-edit edit-cat-btn" data-id="${p.id}" title="Modifica">
        <i class="fas fa-pen"></i>
      </button>
      <button class="btn-icon action-btn-del delete-cat-btn" data-id="${p.id}" data-nome="${p.nome}" title="Elimina">
        <i class="fas fa-trash"></i>
      </button>
    </div>` : '';

  card.innerHTML = `
    <div class="catalogo-card-top">
      <div class="catalogo-card-nome">${p.nome}</div>
      ${adminControls}
    </div>
    <div class="catalogo-card-meta">
      ${p.sku     ? `<span class="catalogo-meta-item"><i class="fas fa-tag"></i> ${p.sku}</span>` : ''}
      ${p.barcode ? `<span class="catalogo-meta-item"><i class="fas fa-barcode"></i> ${p.barcode}</span>` : ''}
      ${p.pesoFormato ? `<span class="catalogo-meta-item"><i class="fas fa-weight-hanging"></i> ${p.pesoFormato}g/rocca</span>` : ''}
    </div>
    <div class="catalogo-composizione">
      <div class="catalogo-composizione-title">Composizione</div>
      ${compoHtml}
    </div>
  `;

  return card;
}

// ─── Click delegato ──────────────────────────────────────────────
function gestisciClick(e) {
  if (!isAdmin) return;
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.classList.contains('edit-cat-btn'))   apriModifica(btn.dataset.id);
  if (btn.classList.contains('delete-cat-btn')) elimina(btn.dataset.id, btn.dataset.nome);
}

// ─── Modal ───────────────────────────────────────────────────────
function apriAggiungi() {
  const form = document.getElementById('form-anagrafica');
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.id   = '';
  document.getElementById('modal-anagrafica-title').textContent = 'Nuovo Prodotto Catalogo';
  document.getElementById('a-error').textContent = '';
  componentiForm = [{ idProdotto: '', nomeProdotto: '', percentuale: 100 }];
  renderComponentiForm();
  openModal('modal-anagrafica');
}

function apriModifica(id) {
  const p = catalogo.find(p => p.id === id);
  if (!p) return;
  const form = document.getElementById('form-anagrafica');
  form.dataset.mode = 'edit';
  form.dataset.id   = id;
  document.getElementById('modal-anagrafica-title').textContent = 'Modifica Prodotto';
  document.getElementById('a-nome').value    = p.nome        ?? '';
  document.getElementById('a-sku').value     = p.sku         ?? '';
  document.getElementById('a-barcode').value = p.barcode     ?? '';
  document.getElementById('a-peso').value    = p.pesoFormato ?? '';
  document.getElementById('a-error').textContent = '';
  componentiForm = (p.componenti ?? []).map(c => ({ ...c }));
  if (componentiForm.length === 0) componentiForm = [{ idProdotto: '', nomeProdotto: '', percentuale: 100 }];
  renderComponentiForm();
  openModal('modal-anagrafica');
}

// ─── Componenti form ─────────────────────────────────────────────
function renderComponentiForm() {
  const container = document.getElementById('componenti-list');
  const prodotti  = getProdotti().sort((a, b) => a.nome.localeCompare(b.nome));

  container.innerHTML = '';

  componentiForm.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'componente-form-row';

    const opzioni = prodotti.map(p =>
      `<option value="${p.id}" data-nome="${p.nome}" ${p.id === c.idProdotto ? 'selected' : ''}>${p.nome} (${p.idFornitore})</option>`
    ).join('');

    row.innerHTML = `
      <select class="comp-prodotto" data-index="${i}">
        <option value="">— Seleziona materia prima —</option>
        ${opzioni}
      </select>
      <input type="number" class="comp-perc" data-index="${i}" value="${c.percentuale}" min="0" max="100" step="1">
      <span class="perc-symbol">%</span>
      <button type="button" class="btn-icon action-btn-del remove-comp-btn" data-index="${i}" title="Rimuovi">
        <i class="fas fa-xmark"></i>
      </button>
    `;

    row.querySelector('.comp-prodotto').addEventListener('change', e => {
      const opt = e.target.selectedOptions[0];
      componentiForm[i].idProdotto  = e.target.value;
      componentiForm[i].nomeProdotto = opt?.dataset.nome ?? '';
      aggiornaTotalePerc();
    });

    row.querySelector('.comp-perc').addEventListener('input', e => {
      componentiForm[i].percentuale = Number(e.target.value) || 0;
      aggiornaTotalePerc();
    });

    row.querySelector('.remove-comp-btn').addEventListener('click', () => {
      componentiForm.splice(i, 1);
      renderComponentiForm();
    });

    container.appendChild(row);
  });

  aggiornaTotalePerc();
}

function aggiornaTotalePerc() {
  const totale = componentiForm.reduce((s, c) => s + (c.percentuale || 0), 0);
  const el = document.getElementById('a-perc-totale');
  el.textContent = `${totale}%`;
  el.className = `perc-totale${totale === 100 ? ' ok' : totale > 100 ? ' errore' : ''}`;
}

// ─── Salva ───────────────────────────────────────────────────────
async function salva(e) {
  e.preventDefault();
  const form    = e.target;
  const errEl   = document.getElementById('a-error');
  const saveBtn = form.querySelector('[type="submit"]');

  errEl.textContent = '';

  const totale = componentiForm.reduce((s, c) => s + (c.percentuale || 0), 0);
  if (totale !== 100) {
    errEl.textContent = `La composizione deve sommare 100% (attuale: ${totale}%).`;
    return;
  }

  if (componentiForm.some(c => !c.idProdotto)) {
    errEl.textContent = 'Seleziona la materia prima per ogni componente.';
    return;
  }

  saveBtn.disabled = true;

  const dati = {
    nome:        document.getElementById('a-nome').value.trim(),
    sku:         document.getElementById('a-sku').value.trim(),
    barcode:     document.getElementById('a-barcode').value.trim(),
    pesoFormato: Number(document.getElementById('a-peso').value),
    componenti:  componentiForm.map(c => ({
      idProdotto:   c.idProdotto,
      nomeProdotto: c.nomeProdotto,
      percentuale:  c.percentuale
    }))
  };

  try {
    if (form.dataset.mode === 'edit') {
      await updateDoc(doc(db, "anagrafica", form.dataset.id), dati);
    } else {
      await addDoc(collection(db, "anagrafica"), dati);
    }
    closeModal('modal-anagrafica');
  } catch (err) {
    console.error("Errore salvataggio anagrafica:", err);
    errEl.textContent = 'Errore nel salvataggio.';
  } finally {
    saveBtn.disabled = false;
  }
}

async function elimina(id, nome) {
  if (!confirm(`Eliminare "${nome}" dal catalogo?`)) return;
  try { await deleteDoc(doc(db, "anagrafica", id)); }
  catch (err) { console.error("Errore eliminazione:", err); }
}

// ─── Import Excel → prodotti_finiti ──────────────────────────────
function parseDescrizione(desc) {
  const m = desc.match(/^(.+?)\s+(Grammi|Gr)\s+(\d+)/i);
  let before, pesoFormato;
  if (m) {
    before      = m[1].trim();
    pesoFormato = Number(m[3]);
  } else {
    before      = desc.trim();
    pesoFormato = null;
  }
  const words  = before.split(' ').filter(w => w);
  const colore = words.length > 1 ? words[words.length - 1] : '';
  const nome   = words.length > 1 ? words.slice(0, -1).join(' ') : before;
  return { nome, colore, pesoFormato };
}

function getTipoLavorazione(fornitore) {
  return fornitore.trim() === 'Cofil S.R.L.' ? 'raccatura' : 'cordini';
}

async function avviaImport() {
  const fileInput  = document.getElementById('import-file');
  const statusEl   = document.getElementById('import-status');
  const btn        = document.getElementById('import-btn');

  if (!fileInput.files[0]) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = 'Seleziona un file Excel prima di procedere.';
    return;
  }

  if (!confirm('Stai per importare i prodotti nel Magazzino Prodotto Finito. Continuare?')) return;

  btn.disabled = true;
  statusEl.style.color = 'var(--text-secondary)';
  statusEl.textContent = 'Lettura file in corso…';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // Riga 0 = intestazioni, dati da riga 1 in poi
      // Colonne: 0=vuoto, 1=No, 2=Cod, 3=Descrizione, 4=Libero4, 5=Qtà, 6=Fornitore, 7=Ubicazione, 8=Note
      const records = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[3]) continue; // skip righe vuote

        const sku         = String(row[2] ?? '').trim();
        const descrizione = String(row[3] ?? '').trim();
        const partita     = String(row[4] ?? '').trim() || 'NP';
        const quantita    = Number(row[5]) || 0;
        const fornitore   = String(row[6] ?? '').trim();
        const ubicazione  = String(row[7] ?? '').trim();
        const note        = String(row[8] ?? '').trim();

        if (!descrizione) continue;

        const { nome, colore, pesoFormato } = parseDescrizione(descrizione);

        records.push({
          sku,
          nome,
          colore,
          pesoFormato,
          partita,
          quantitaRocche: quantita,
          fornitore,
          ubicazione,
          note,
          tipoLavorazione: getTipoLavorazione(fornitore),
          sogliaAvviso: 0
        });
      }

      statusEl.textContent = `Trovati ${records.length} prodotti. Scrittura su Firestore…`;

      // Firestore writeBatch (max 500 per batch)
      const BATCH_SIZE = 490;
      let scritti = 0;
      for (let start = 0; start < records.length; start += BATCH_SIZE) {
        const batch = writeBatch(db);
        records.slice(start, start + BATCH_SIZE).forEach(r => {
          batch.set(doc(collection(db, "prodotti_finiti")), r);
        });
        await batch.commit();
        scritti += Math.min(BATCH_SIZE, records.length - start);
        statusEl.textContent = `Scritti ${scritti}/${records.length}…`;
      }

      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ Import completato: ${records.length} prodotti importati.`;
      fileInput.value = '';
    } catch (err) {
      console.error("Errore import:", err);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = 'Errore durante l\'import. Controlla la console.';
    } finally {
      btn.disabled = false;
    }
  };
  reader.readAsArrayBuffer(fileInput.files[0]);
}
