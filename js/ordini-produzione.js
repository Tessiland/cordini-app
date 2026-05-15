import {
  collection, query, orderBy, onSnapshot, doc, addDoc,
  getDocs, updateDoc, runTransaction, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti } from './prodotto-finito.js';

let db;
let operatoreCorrente = 'Operatori';
let ordini = [];
const statiAperti = new Set();

export function initOrdiniProduzione(firestoreDb, operatoreEmail) {
  db = firestoreDb;
  operatoreCorrente = operatoreEmail || 'Operatori';

  document.getElementById('prod-import-btn').addEventListener('click', importaOrdine);
  document.getElementById('prod-ordini-list').addEventListener('click', gestisciClick);

  caricaOrdini();
}

// ─── Caricamento ─────────────────────────────────────────────────
function caricaOrdini() {
  const q = query(collection(db, "ordini_produzione"), orderBy("createdAt", "desc"));
  onSnapshot(q, snap => {
    ordini = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrdini();
  }, err => console.error("Errore caricamento ordini produzione:", err));
}

// ─── Helper sort: tipologia → colore usando pfCache ───────────────
function getSortKeys(item) {
  const pfCache = getProdottiFiniti();
  if (item.idProdottoFinito) {
    const pf = pfCache.find(p => p.id === item.idProdottoFinito);
    if (pf) return { tip: pf.nome ?? '', col: pf.colore ?? '' };
  }
  // Fallback: ultima parola = colore, resto = tipologia
  const parts = (item.nome ?? '').split(' ');
  const col   = parts.length > 1 ? parts[parts.length - 1] : '';
  const tip   = parts.slice(0, -1).join(' ');
  return { tip, col };
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const ka = getSortKeys(a);
    const kb = getSortKeys(b);
    const tipCmp = ka.tip.localeCompare(kb.tip, 'it', { sensitivity: 'base' });
    if (tipCmp !== 0) return tipCmp;
    return ka.col.localeCompare(kb.col, 'it', { sensitivity: 'base' });
  });
}

// ─── Render ──────────────────────────────────────────────────────
function renderOrdini() {
  const container = document.getElementById('prod-ordini-list');
  if (ordini.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun ordine attivo.</p>';
    return;
  }
  container.innerHTML = '';
  ordini.forEach(o => container.appendChild(creaCardOrdine(o)));
}

function creaCardOrdine(ordine) {
  const items = ordine.items ?? [];
  const spuntati = items.filter(i => i.spuntato).length;
  const aperto   = statiAperti.has(ordine.id);

  const dataFmt = ordine.data
    ? new Date(ordine.data + 'T00:00:00').toLocaleDateString('it-IT')
    : '—';

  const statoClass = ordine.stato === 'chiuso' ? 'chiuso' : 'aperto';
  const statoLabel = ordine.stato === 'chiuso' ? 'CHIUSO' : 'APERTO';

  // Mantieni indice originale prima di ordinare (per tipologia → colore)
  const itemsConIndice = items.map((item, origIdx) => ({ ...item, origIdx }));
  const itemsOrdinati  = sortItems(itemsConIndice);

  const card = document.createElement('div');
  card.className = 'ordine-card';
  card.dataset.id = ordine.id;

  card.innerHTML = `
    <div class="ordine-card-header" data-action="toggle" data-id="${ordine.id}">
      <div class="ordine-header-main">
        <div class="ordine-numero">Ordine #${ordine.numero}</div>
        <div class="ordine-meta">${dataFmt} · Hub: ${ordine.hub ?? '—'} · ${items.length} articoli</div>
      </div>
      <div class="ordine-header-right">
        <span class="badge-stato ${statoClass}">${statoLabel}</span>
        <span class="ordine-progress">${spuntati}/${items.length}</span>
        <i class="fas fa-chevron-right ordine-chevron${aperto ? ' open' : ''}"></i>
      </div>
    </div>
    <div class="ordine-body${aperto ? '' : ' hidden'}">
      <div class="ordine-actions-bar">
        <button class="btn-ghost btn-sm" data-action="stampa-lista" data-id="${ordine.id}">
          <i class="fas fa-print"></i> Stampa Lista
        </button>
        <button class="btn-ghost btn-sm" data-action="stampa-consegna" data-id="${ordine.id}">
          <i class="fas fa-file-invoice"></i> Stampa Consegna
        </button>
        <button class="btn-ghost btn-sm btn-ghost-danger" data-action="elimina" data-id="${ordine.id}">
          <i class="fas fa-trash"></i> Elimina
        </button>
      </div>
      <div class="ordine-items">
        <div class="ordine-items-header">
          <span class="col-nome">Prodotto</span>
          <span class="col-richiesta">Richiesta</span>
          <span class="col-disponibile">Disponibile</span>
          <span class="col-azione"></span>
        </div>
        ${itemsOrdinati.map(item => creaRigaItemHtml(item, item.origIdx, ordine.id)).join('')}
      </div>
    </div>
  `;

  return card;
}

function creaRigaItemHtml(item, origIdx, ordineId) {
  const pfCache    = getProdottiFiniti();
  const pfItem     = item.idProdottoFinito
    ? pfCache.find(p => p.id === item.idProdottoFinito)
    : null;
  const stockAttuale = pfItem?.quantitaRocche ?? null;

  let stockHtml, colStock;

  if (item.spuntato) {
    const parziale = item.qtyConsegnata < item.qtyRichiesta;
    stockHtml = `${item.qtyConsegnata}${parziale ? ' <span class="badge-parziale">PARZIALE</span>' : ''}`;
    colStock  = '';
  } else if (!item.idProdottoFinito) {
    stockHtml = `<span class="stock-na">N/D</span>`;
    colStock  = 'col-danger';
  } else if (stockAttuale === null) {
    stockHtml = `<span class="stock-na">?</span>`;
    colStock  = '';
  } else if (stockAttuale === 0) {
    stockHtml = `<span>0</span>`;
    colStock  = 'col-danger';
  } else if (stockAttuale < item.qtyRichiesta) {
    stockHtml = `<span>${stockAttuale}</span>`;
    colStock  = 'col-warning';
  } else {
    stockHtml = `<span>${stockAttuale}</span>`;
    colStock  = 'col-ok';
  }

  let azioneHtml;
  if (item.spuntato) {
    azioneHtml = `<i class="fas fa-check-circle ordine-check-done"></i>`;
  } else if (!item.idProdottoFinito || stockAttuale === 0) {
    azioneHtml = `<span class="badge-da-produrre">DA PRODURRE</span>`;
  } else {
    azioneHtml = `
      <button class="btn-spunta" data-action="spunta"
        data-ordine-id="${ordineId}" data-index="${origIdx}">
        <i class="fas fa-check"></i>
      </button>`;
  }

  const ubicazione = (!item.spuntato && pfItem && stockAttuale > 0)
    ? (pfItem.ubicazione?.trim() || 'non ubicato')
    : null;

  // Qty editabile se non spuntato
  const qtyHtml = item.spuntato
    ? item.qtyRichiesta
    : `<span class="qty-editable" data-action="edit-qty"
          data-ordine-id="${ordineId}" data-index="${origIdx}"
          title="Clicca per modificare la quantità">${item.qtyRichiesta} <i class="fas fa-pen-to-square qty-edit-icon"></i></span>`;

  return `
    <div class="ordine-item-row${item.spuntato ? ' spuntato' : ''}">
      <div class="col-nome">
        <div class="ordine-item-nome">${item.nome ?? '—'}</div>
        <div class="ordine-item-sku">${item.sku ?? ''}</div>
        ${ubicazione ? `<div class="ordine-item-ubicazione"><i class="fas fa-location-dot"></i> ${ubicazione}</div>` : ''}
      </div>
      <div class="col-richiesta">${qtyHtml}</div>
      <div class="col-disponibile ${colStock}">${stockHtml}</div>
      <div class="col-azione">${azioneHtml}</div>
    </div>
  `;
}

// ─── Click delegato ──────────────────────────────────────────────
function gestisciClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  if (action === 'toggle') {
    toggleOrdine(el.dataset.id);
  } else if (action === 'stampa-lista') {
    const o = ordini.find(o => o.id === el.dataset.id);
    if (o) stampaLista(o);
  } else if (action === 'stampa-consegna') {
    const o = ordini.find(o => o.id === el.dataset.id);
    if (o) stampaConsegna(o);
  } else if (action === 'elimina') {
    eliminaOrdine(el.dataset.id);
  } else if (action === 'spunta') {
    el.disabled = true;
    spuntaItem(el.dataset.ordineId, Number(el.dataset.index))
      .finally(() => { el.disabled = false; });
  } else if (action === 'edit-qty') {
    apriEditQty(el, el.dataset.ordineId, Number(el.dataset.index));
  }
}

function toggleOrdine(id) {
  statiAperti.has(id) ? statiAperti.delete(id) : statiAperti.add(id);
  renderOrdini();
}

async function eliminaOrdine(id) {
  const ordine = ordini.find(o => o.id === id);
  if (!ordine) return;
  if (!confirm(`Rimuovere l'ordine #${ordine.numero} dalla sezione Produzione?`)) return;
  if (!confirm('Conferma: l\'ordine verrà eliminato definitivamente. Continuare?')) return;
  try {
    await deleteDoc(doc(db, "ordini_produzione", id));
    statiAperti.delete(id);
  } catch (err) {
    console.error("Errore eliminazione ordine:", err);
    alert('Errore durante l\'eliminazione. Riprova.');
  }
}

// ─── Modifica qty richiesta inline ───────────────────────────────
function apriEditQty(el, ordineId, itemIndex) {
  const ordine = ordini.find(o => o.id === ordineId);
  if (!ordine) return;
  const item = ordine.items[itemIndex];
  if (!item || item.spuntato) return;

  const valoreOriginale = item.qtyRichiesta;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'qty-edit-input';
  input.value = valoreOriginale;
  input.min = 1;

  const conferma = async () => {
    const nuova = Number(input.value);
    if (!nuova || nuova < 1 || nuova === valoreOriginale) {
      renderOrdini();
      return;
    }
    const freshItems = ordine.items.map((it, i) =>
      i === itemIndex ? { ...it, qtyRichiesta: nuova } : it
    );
    try {
      await updateDoc(doc(db, "ordini_produzione", ordineId), { items: freshItems });
    } catch (err) {
      console.error("Errore modifica quantità:", err);
      renderOrdini();
    }
  };

  input.addEventListener('blur', conferma);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') renderOrdini();
  });

  el.replaceWith(input);
  input.focus();
  input.select();
}

// ─── Spunta item ─────────────────────────────────────────────────
async function spuntaItem(ordineId, itemIndex) {
  const ordine = ordini.find(o => o.id === ordineId);
  if (!ordine) return;

  const item = ordine.items[itemIndex];
  if (!item || item.spuntato) return;

  if (!item.idProdottoFinito) {
    alert(`SKU "${item.sku}" non trovato nel Magazzino Prodotto Finito.`);
    return;
  }

  const pfRef     = doc(db, "prodotti_finiti", item.idProdottoFinito);
  const ordineRef = doc(db, "ordini_produzione", ordineId);

  try {
    await runTransaction(db, async t => {
      const [pfSnap, ordineSnap] = await Promise.all([t.get(pfRef), t.get(ordineRef)]);

      if (!pfSnap.exists())     throw new Error("Prodotto finito non trovato.");
      if (!ordineSnap.exists()) throw new Error("Ordine non trovato.");

      const pfData        = pfSnap.data();
      const stockAttuale  = pfData.quantitaRocche ?? 0;
      const qtyConsegnata = Math.min(stockAttuale, item.qtyRichiesta);
      const nuovoStock    = stockAttuale - qtyConsegnata;
      const nuovaPartita  = pfData.maiConsegnata ?? true;

      const freshItems = [...ordineSnap.data().items];
      freshItems[itemIndex] = {
        ...freshItems[itemIndex],
        spuntato:      true,
        qtyConsegnata,
        nuovaPartita
      };

      const statoNuovo = freshItems.every(i => i.spuntato || !i.idProdottoFinito)
        ? 'chiuso'
        : 'aperto';

      t.update(ordineRef, { items: freshItems, stato: statoNuovo });
      t.update(pfRef, { quantitaRocche: nuovoStock, maiConsegnata: false });
      t.set(doc(collection(db, "movimenti_pf")), {
        idProdotto:   item.idProdottoFinito,
        nomeProdotto: item.nome,
        tipo:         'prelievo',
        quantita:     qtyConsegnata,
        quantitaDopo: nuovoStock,
        nota:         `Consegna ordine #${ordine.numero}`,
        operatore:    operatoreCorrente,
        timestamp:    serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Errore spunta:", err);
    alert(`Errore: ${err.message}`);
  }
}

// ─── Import Excel ─────────────────────────────────────────────────
async function importaOrdine() {
  const fileInput = document.getElementById('prod-import-file');
  const statusEl  = document.getElementById('prod-import-status');
  const btn       = document.getElementById('prod-import-btn');

  if (!fileInput.files[0]) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = 'Seleziona un file Excel prima di procedere.';
    return;
  }

  btn.disabled = true;
  statusEl.style.color = 'var(--text-secondary)';
  statusEl.textContent = 'Lettura file…';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const rows     = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]], { header: 1 }
      );

      const hdr  = rows[0] ?? [];
      const idx  = name => hdr.findIndex(h => String(h ?? '').trim().toLowerCase() === name);
      const get  = (row, i) => i !== -1 ? String(row[i] ?? '').trim() : '';

      const iNum  = idx('num');
      const iDate = idx('date');
      const iSupp = idx('supplier');
      const iSku  = idx('sku');
      const iName = idx('name');
      const iQty  = idx('qty_ord');
      const iArr  = idx('arr_date');
      const iNote = idx('note');

      if (iNum === -1 || iSku === -1 || iQty === -1) {
        throw new Error('Colonne non trovate. Verifica che il file abbia: num, sku, qty_ord');
      }

      // Raggruppa righe per numero ordine
      const gruppi = new Map();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const num = get(row, iNum);
        if (!num) continue;
        if (!gruppi.has(num)) {
          gruppi.set(num, {
            num,
            date:    get(row, iDate),
            hub:     get(row, iSupp) || 'Hub',
            arrDate: get(row, iArr),
            items:   []
          });
        }
        gruppi.get(num).items.push({
          sku:          get(row, iSku),
          nome:         get(row, iName),
          qtyRichiesta: Number(rows[i][iQty]) || 0,
          note:         get(row, iNote)
        });
      }

      const totArticoli = [...gruppi.values()].reduce((s, g) => s + g.items.length, 0);
      statusEl.textContent = `Trovati ${gruppi.size} ordini, ${totArticoli} articoli. Verifica duplicati…`;

      // Controlla numeri già esistenti
      const esistenti       = await getDocs(collection(db, "ordini_produzione"));
      const numeriEsistenti = new Set(esistenti.docs.map(d => String(d.data().numero)));

      // Mappa SKU → prima partita valida (con stock se possibile, oldest createdAt)
      const pfCache = getProdottiFiniti();
      const pfPerSku = {};
      pfCache.filter(p => p.sku && !p.eliminato).forEach(p => {
        if (!pfPerSku[p.sku]) pfPerSku[p.sku] = [];
        pfPerSku[p.sku].push(p);
      });
      const skuMap = new Map();
      for (const [sku, partite] of Object.entries(pfPerSku)) {
        const conStock = partite.filter(p => (p.quantitaRocche ?? 0) > 0);
        const gruppo   = conStock.length > 0 ? conStock : partite;
        gruppo.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        skuMap.set(sku, gruppo[0].id);
      }

      let importati = 0;
      let duplicati = 0;

      for (const [num, gruppo] of gruppi) {
        if (numeriEsistenti.has(num)) { duplicati++; continue; }

        const itemsConMatch = gruppo.items.map(item => ({
          sku:              item.sku,
          nome:             item.nome,
          qtyRichiesta:     item.qtyRichiesta,
          note:             item.note,
          spuntato:         false,
          qtyConsegnata:    null,
          idProdottoFinito: skuMap.get(item.sku) ?? null
        }));

        await addDoc(collection(db, "ordini_produzione"), {
          numero:            num,
          data:              gruppo.date,
          hub:               gruppo.hub,
          dataArrivoPrevista: gruppo.arrDate,
          stato:             'aperto',
          items:             itemsConMatch,
          createdAt:         serverTimestamp()
        });

        importati++;
      }

      statusEl.style.color = 'var(--success)';
      let msg = `✓ Importati: ${importati} ordini.`;
      if (duplicati > 0) msg += ` ${duplicati} già presenti (ignorati).`;
      statusEl.textContent = msg;
      fileInput.value = '';
    } catch (err) {
      console.error("Errore import ordine:", err);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Errore: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  };
  reader.readAsArrayBuffer(fileInput.files[0]);
}

// ─── Stampa Lista (pre-picking) ───────────────────────────────────
function stampaLista(ordine) {
  const pfCache = getProdottiFiniti();
  const pfMap   = new Map(pfCache.map(p => [p.id, p]));
  const dataFmt = ordine.data
    ? new Date(ordine.data + 'T00:00:00').toLocaleDateString('it-IT') : '—';

  const items = sortItems(ordine.items ?? []);

  const righe = items.map(item => {
    const pf    = item.idProdottoFinito ? pfMap.get(item.idProdottoFinito) : null;
    const stock = pf !== undefined && pf !== null ? (pf.quantitaRocche ?? 0) : '—';
    const ubicazione = pf?.ubicazione ?? '—';
    const partita    = pf?.partita    ?? '—';
    const cls = stock === 0 ? 'print-danger'
      : (typeof stock === 'number' && stock < item.qtyRichiesta) ? 'print-warning' : '';
    return `<tr>
      <td>${item.nome ?? '—'}</td>
      <td>${item.sku ?? '—'}</td>
      <td class="tc">${item.qtyRichiesta}</td>
      <td class="tc ${cls}">${stock}</td>
      <td>${ubicazione}</td>
      <td>${partita}</td>
      <td class="tc note-col"></td>
    </tr>`;
  }).join('');

  const daProdurre = items.filter(i => !i.idProdottoFinito || (pfMap.get(i.idProdottoFinito)?.quantitaRocche ?? 0) === 0).length;

  eseguiStampa(`
    <div class="print-doc">
      <div class="print-header">
        <h1>Lista di Lavoro</h1>
        <div class="print-meta">
          <span><b>Ordine #${ordine.numero}</b></span>
          <span>Data: ${dataFmt}</span>
          <span>Hub: ${ordine.hub ?? '—'}</span>
          <span>Stampato: ${new Date().toLocaleDateString('it-IT')}</span>
        </div>
      </div>
      <table class="print-table">
        <thead><tr>
          <th>Prodotto</th><th>SKU</th>
          <th class="tc">Richiesta</th><th class="tc">Disponibile</th>
          <th>Ubicazione</th><th>Partita</th>
          <th class="tc">Note</th>
        </tr></thead>
        <tbody>${righe}</tbody>
      </table>
      <div class="print-footer">
        Totale: ${items.length} articoli · Da produrre / stock 0: ${daProdurre}
      </div>
    </div>
  `);
}

// ─── Stampa Consegna (post-picking) ──────────────────────────────
function stampaConsegna(ordine) {
  const pfCache = getProdottiFiniti();
  const pfMap   = new Map(pfCache.map(p => [p.id, p]));
  const dataFmt = ordine.data
    ? new Date(ordine.data + 'T00:00:00').toLocaleDateString('it-IT') : '—';

  const items    = sortItems(ordine.items ?? []);
  const spuntati = items.filter(i => i.spuntato);
  const pendenti = items.filter(i => !i.spuntato);

  const righeSpuntati = spuntati.map(item => {
    const pf      = item.idProdottoFinito ? pfMap.get(item.idProdottoFinito) : null;
    const partita = pf?.partita ?? '—';
    const parziale = item.qtyConsegnata < item.qtyRichiesta;

    const eliminatoBadge   = pf?.eliminato
      ? `<span class="badge-eliminato">ELIMINATO</span>` : '';
    const nuovaPartitaBadge = item.nuovaPartita
      ? `<span class="badge-nuova-partita">&#9873; NUOVA PARTITA</span>` : '';

    return `<tr${parziale ? ' class="print-warning-row"' : ''}>
      <td>${item.nome ?? '—'} ${eliminatoBadge} ${nuovaPartitaBadge}</td>
      <td>${item.sku ?? '—'}</td>
      <td class="tc">${item.qtyRichiesta}</td>
      <td class="tc"><b>${item.qtyConsegnata}</b></td>
      <td>${partita}</td>
      <td class="tc">${parziale ? 'PARZIALE' : '✓'}</td>
    </tr>`;
  }).join('');

  const righePendenti = pendenti.length > 0 ? `
    <tr class="print-section-sep"><td colspan="6">NON EVASI / DA PRODURRE</td></tr>
    ${pendenti.map(item => `<tr class="print-danger-row">
      <td>${item.nome ?? '—'}</td>
      <td>${item.sku ?? '—'}</td>
      <td class="tc">${item.qtyRichiesta}</td>
      <td class="tc">—</td>
      <td>—</td>
      <td class="tc">DA PRODURRE</td>
    </tr>`).join('')}
  ` : '';

  eseguiStampa(`
    <div class="print-doc">
      <div class="print-header">
        <h1>Documento di Consegna</h1>
        <div class="print-meta">
          <span><b>Ordine #${ordine.numero}</b></span>
          <span>Data ordine: ${dataFmt}</span>
          <span>Hub: ${ordine.hub ?? '—'}</span>
          <span>Data consegna: ${new Date().toLocaleDateString('it-IT')}</span>
        </div>
      </div>
      <table class="print-table">
        <thead><tr>
          <th>Prodotto</th><th>SKU</th>
          <th class="tc">Richiesta</th><th class="tc">Consegnata</th>
          <th>Partita</th><th class="tc">Stato</th>
        </tr></thead>
        <tbody>${righeSpuntati}${righePendenti}</tbody>
      </table>
      <div class="print-footer">
        Consegnati: ${spuntati.length}/${items.length} articoli
        ${pendenti.length > 0 ? ` · Non evasi: ${pendenti.length}` : ''}
      </div>
      <div class="print-firma">
        <div class="firma-box"><div class="firma-line"></div><div class="firma-label">Firma operatore</div></div>
        <div class="firma-box"><div class="firma-line"></div><div class="firma-label">Firma ricevente</div></div>
      </div>
    </div>
  `);
}

function eseguiStampa(html) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  window.print();
  setTimeout(() => { area.innerHTML = ''; }, 1500);
}
