import {
  doc, setDoc, onSnapshot, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Descrizioni salvate in tipologie/_descrizioni (collection già nelle regole Firestore).
// setDoc con merge:true crea il doc se non esiste, altrimenti lo aggiorna.
const DESC_REF = (db) => doc(db, "tipologie", "_descrizioni");

let db;
let descrizioniMap = {};

export function initEtichette(firestoreDb) {
  db = firestoreDb;
  document.getElementById('desc-form').addEventListener('submit', salvaDescrizione);
  document.getElementById('desc-list').addEventListener('click', gestisciClickDesc);

  onSnapshot(DESC_REF(db), snap => {
    descrizioniMap = snap.exists() ? snap.data() : {};
    renderDescList();
  }, err => console.error("Errore listener descrizioni:", err));
}

// ─── Render lista ─────────────────────────────────────────────────
function renderDescList() {
  const el = document.getElementById('desc-list');
  if (!el) return;
  const nomi = Object.keys(descrizioniMap).sort((a, b) => a.localeCompare(b, 'it'));
  if (nomi.length === 0) {
    el.innerHTML = '<p class="empty-state" style="font-size:.8rem;margin-top:.5rem">Nessuna descrizione salvata.</p>';
    return;
  }
  el.innerHTML = nomi.map(nome => `
    <div class="desc-item">
      <div class="desc-item-header">
        <strong class="desc-item-nome">${nome}</strong>
        <div style="display:flex;gap:.25rem">
          <button class="btn-icon action-btn-edit edit-desc-btn" data-nome="${nome}" title="Modifica">
            <i class="fas fa-pen"></i>
          </button>
          <button class="btn-icon action-btn-del delete-desc-btn" data-nome="${nome}" title="Elimina">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <p class="desc-item-text">${descrizioniMap[nome]}</p>
    </div>
  `).join('');
}

// ─── Salva descrizione ────────────────────────────────────────────
async function salvaDescrizione(e) {
  e.preventDefault();
  const nome   = document.getElementById('desc-nome').value.trim();
  const testo  = document.getElementById('desc-testo').value.trim();
  const status = document.getElementById('desc-status');
  const btn    = e.target.querySelector('[type="submit"]');

  btn.disabled = true;
  status.style.color = 'var(--text-secondary)';
  status.textContent = 'Salvataggio…';

  try {
    await setDoc(DESC_REF(db), { [nome]: testo }, { merge: true });
    status.style.color = 'var(--success)';
    status.textContent = `✓ Descrizione per "${nome}" salvata.`;
    e.target.reset();
  } catch (err) {
    console.error(err);
    status.style.color = 'var(--danger)';
    status.textContent = `Errore: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function gestisciClickDesc(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const nome = btn.dataset.nome;
  if (btn.classList.contains('edit-desc-btn')) {
    document.getElementById('desc-nome').value  = nome;
    document.getElementById('desc-testo').value = descrizioniMap[nome] ?? '';
    document.getElementById('desc-nome').focus();
    document.getElementById('desc-status').textContent = '';
  } else if (btn.classList.contains('delete-desc-btn')) {
    if (!confirm(`Eliminare la descrizione per "${nome}"?`)) return;
    updateDoc(DESC_REF(db), { [nome]: deleteField() }).catch(console.error);
  }
}

// ─── API pubblica ─────────────────────────────────────────────────
export function getDescrizione(nomeTipologia) {
  if (!nomeTipologia) return null;
  const key = Object.keys(descrizioniMap).find(
    k => k.trim().toLowerCase() === nomeTipologia.trim().toLowerCase()
  );
  return key ? { nome: key, descrizione: descrizioniMap[key] } : null;
}

let _prodottoCorrente = null;

export function stampaEtichetta(prodotto) {
  const descObj = getDescrizione(prodotto.nome);
  if (!descObj) {
    alert(`Nessuna descrizione per "${prodotto.nome}".\nAggiungila nel Catalogo → Descrizioni Tipologie, poi riprova.`);
    return;
  }
  _prodottoCorrente = { ...prodotto, _descrizione: descObj.descrizione };

  const colore = prodotto.coloriComponenti?.length === 1
    ? prodotto.coloriComponenti[0].nomeColore
    : (prodotto.colore || '—');

  document.getElementById('stampa-preview').textContent = `${prodotto.nome} — ${colore}`;
  document.getElementById('stampa-qty').value = '';

  import('./nav.js').then(({ openModal }) => openModal('modal-stampa-etichette'));
}

export function confermaPrint() {
  if (!_prodottoCorrente) return;
  const qty = Math.max(1, parseInt(document.getElementById('stampa-qty').value, 10) || 1);
  import('./nav.js').then(({ closeModal }) => {
    closeModal('modal-stampa-etichette');
    eseguiStampa(_prodottoCorrente, _prodottoCorrente._descrizione, qty);
    _prodottoCorrente = null;
  });
}

// Rimuove tutto il contenuto tra parentesi (es. "Bianco (Naturale)" → "Bianco")
function senzaParentesi(s) {
  return (s ?? '').replace(/\s*\(.*?\)\s*/g, '').trim();
}

// ─── Stampa ──────────────────────────────────────────────────────
function creaLabelHtml(prodotto, descrizione) {
  const coloreRaw = prodotto.coloriComponenti?.length === 1
    ? prodotto.coloriComponenti[0].nomeColore
    : (prodotto.colore || '—');
  const colore = senzaParentesi(coloreRaw);

  return `
    <div class="print-label">
      <div class="print-label-tipo">${prodotto.nome ?? '—'}</div>
      <div class="print-label-colore">${colore}</div>
      <div class="print-label-partita">${prodotto.partita || '—'}</div>
      <div class="print-label-desc">${descrizione}</div>
      ${prodotto.sku
        ? `<div class="print-label-barcode"><svg class="print-barcode-svg"></svg></div>`
        : ''}
    </div>`;
}

function eseguiStampa(prodotto, descrizione, qty) {
  const area = document.getElementById('print-area');
  area.innerHTML = Array.from({ length: qty }, (_, i) =>
    creaLabelHtml(prodotto, descrizione) +
    (i < qty - 1 ? '<div class="print-label-break"></div>' : '')
  ).join('');

  if (prodotto.sku && window.JsBarcode) {
    area.querySelectorAll('.print-barcode-svg').forEach(svg => {
      JsBarcode(svg, prodotto.sku, {
        format:       'CODE128',
        width:        1.5,
        height:       28,
        displayValue: true,
        fontSize:     6,
        margin:       1,
        textMargin:   1,
        background:   '#ffffff',
        lineColor:    '#000000'
      });
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width  = '45mm';
      svg.style.height = '7.5mm';
    });
  }

  let styleEl = document.getElementById('label-print-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'label-print-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    @page { size: 62mm 36mm; margin: 0.5mm; }
    #print-area {
      position: static !important;
      padding: 0 !important;
      width: 61mm !important;
      overflow: hidden !important;
      background: #fff;
    }
  `;

  window.print();
  setTimeout(() => { styleEl.textContent = ''; area.innerHTML = ''; }, 1500);
}
