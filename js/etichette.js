import {
  collection, query, where, getDocs,
  doc, addDoc, updateDoc, onSnapshot, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Descrizioni salvate in un documento speciale dentro "anagrafica" (già autorizzata).
// Prima volta: addDoc → genera ID → salvato in localStorage come puntatore.
// Dispositivi diversi: se localStorage è vuoto, trova il doc via query Firestore.
const LS_ID_KEY = 'cordini_desc_meta_id';

let db;
let metaDocId    = null;
let descrizioniMap = {};

export function initEtichette(firestoreDb) {
  db = firestoreDb;
  document.getElementById('desc-form').addEventListener('submit', salvaDescrizione);
  document.getElementById('desc-list').addEventListener('click', gestisciClickDesc);
  initMetaDoc();
}

// ─── Inizializzazione documento meta ─────────────────────────────
async function initMetaDoc() {
  // 1. Cerca ID in localStorage (accesso veloce sul device corrente)
  metaDocId = localStorage.getItem(LS_ID_KEY);

  // 2. Se non trovato, cerca il doc su Firestore (altri device, o localStorage svuotato)
  if (!metaDocId) {
    try {
      const snap = await getDocs(
        query(collection(db, "anagrafica"), where("_tipo", "==", "descrizioni_tipologie"))
      );
      if (!snap.empty) {
        metaDocId = snap.docs[0].id;
        localStorage.setItem(LS_ID_KEY, metaDocId);
      }
    } catch (err) { console.error("Errore ricerca meta doc:", err); }
  }

  if (metaDocId) {
    attivaListener();
  } else {
    renderDescList(); // primo avvio: lista vuota
  }
}

function attivaListener() {
  onSnapshot(doc(db, "anagrafica", metaDocId), snap => {
    if (!snap.exists()) { descrizioniMap = {}; renderDescList(); return; }
    const data = snap.data();
    descrizioniMap = {};
    Object.keys(data).forEach(k => { if (k !== '_tipo') descrizioniMap[k] = data[k]; });
    renderDescList();
  }, err => console.error("Errore listener descrizioni:", err));
}

// ─── Render lista ────────────────────────────────────────────────
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
    if (!metaDocId) {
      // Prima volta: crea il documento con addDoc
      const ref = await addDoc(collection(db, "anagrafica"), {
        _tipo: 'descrizioni_tipologie',
        [nome]: testo
      });
      metaDocId = ref.id;
      localStorage.setItem(LS_ID_KEY, metaDocId);
      attivaListener();
    } else {
      await updateDoc(doc(db, "anagrafica", metaDocId), { [nome]: testo });
    }
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
    if (metaDocId) {
      updateDoc(doc(db, "anagrafica", metaDocId), { [nome]: deleteField() }).catch(console.error);
    }
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
  document.getElementById('stampa-qty').value = prodotto.quantitaRocche > 0 ? prodotto.quantitaRocche : 1;

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

// ─── Stampa ──────────────────────────────────────────────────────
function creaLabelHtml(prodotto, descrizione) {
  const colore = prodotto.coloriComponenti?.length === 1
    ? prodotto.coloriComponenti[0].nomeColore
    : (prodotto.colore || '—');
  return `
    <div class="print-label">
      <div class="print-label-top">
        <span class="print-label-tipo">${prodotto.nome ?? '—'}</span>
        <span class="print-label-colore">${colore}</span>
      </div>
      <div class="print-label-desc">${descrizione}</div>
      <div class="print-label-partita">Partita: ${prodotto.partita || '—'}</div>
      ${prodotto.sku
        ? `<div class="print-label-barcode"><svg class="print-barcode-svg"></svg></div>`
        : `<div class="print-label-partita">SKU: n.d.</div>`}
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
        format: 'CODE128', width: 1.2, height: 20,
        displayValue: true, fontSize: 7, margin: 0, textMargin: 1
      });
    });
  }

  let styleEl = document.getElementById('label-print-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'label-print-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    @page { size: 50mm auto; margin: 1mm; }
    #print-area { position: static !important; padding: 0 !important; font-size: 6pt !important; background: #fff; }
  `;

  window.print();
  setTimeout(() => { styleEl.textContent = ''; area.innerHTML = ''; }, 1500);
}
