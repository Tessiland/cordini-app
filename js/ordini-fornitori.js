import {
  collection, query, orderBy, onSnapshot, doc, addDoc,
  getDoc, updateDoc, deleteDoc, runTransaction, writeBatch,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdotti } from './magazzino.js';
import { openModal, closeModal } from './nav.js';

let db;
let ordiniStorico  = [];
let outputDirHandle = null;

export function initOrdiniFornitori(firestoreDb) {
  db = firestoreDb;

  document.getElementById('aggiorna-proposte-btn').addEventListener('click', generaProposte);
  document.getElementById('list-proposte').addEventListener('click', gestisciClickProposte);
  document.getElementById('list-storico').addEventListener('click', gestisciClickStorico);
  document.getElementById('list-storico').addEventListener('change', gestisciChangeStorico);
  document.getElementById('copy-email-btn').addEventListener('click', copiaTestoEmail);
  document.getElementById('collega-output-btn').addEventListener('click', selezionaCartellaOutput);

  ripristinaCartellaOutput();
  generaProposte();
  caricaStorico();
}

// ─── Cartella Output (File System Access API) ─────────────────────
async function ripristinaCartellaOutput() {
  try {
    const handle = await leggiHandleDaIDB();
    if (!handle) return;
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { outputDirHandle = handle; aggiornaStatoOutput(); }
  } catch { /* silenzioso */ }
}

async function selezionaCartellaOutput() {
  if (!window.showDirectoryPicker) {
    alert('Funzione disponibile solo su Chrome o Edge. Su Safari usa il bottone "Copia testo" nel modal.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    outputDirHandle = handle;
    await salvaHandleInIDB(handle);
    aggiornaStatoOutput();
  } catch (e) {
    if (e.name !== 'AbortError') console.error("Errore selezione cartella:", e);
  }
}

function aggiornaStatoOutput() {
  const btn    = document.getElementById('collega-output-btn');
  const status = document.getElementById('output-folder-status');
  if (outputDirHandle) {
    btn.innerHTML    = `<i class="fas fa-folder-open"></i> ${outputDirHandle.name}`;
    btn.style.color  = 'var(--success)';
    status.textContent = '';
  } else {
    btn.innerHTML    = '<i class="fas fa-folder"></i> Collega cartella Output';
    btn.style.color  = '';
    status.textContent = 'Nessuna cartella collegata — gli ordini non verranno salvati automaticamente.';
  }
}

async function salvaOrdineInOutput(fornitore, testo) {
  if (!outputDirHandle) return;
  try {
    const ora      = new Date();
    const yyyymmdd = ora.toISOString().slice(0, 10).replace(/-/g, '');
    const nome     = fornitore.trim().replace(/[^a-zA-Z0-9À-ÿ]/g, '_').replace(/_+/g, '_');
    const nomeFile = `${yyyymmdd}_${nome}.txt`;
    const file     = await outputDirHandle.getFileHandle(nomeFile, { create: true });
    const writable = await file.createWritable();
    await writable.write(testo);
    await writable.close();
  } catch (err) {
    console.error("Errore salvataggio Output:", err);
  }
}

// ─── IndexedDB per persistere il directory handle ─────────────────
function apriIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cordini-fs', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = () => reject(req.error);
  });
}
async function salvaHandleInIDB(handle) {
  const db = await apriIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'output');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}
async function leggiHandleDaIDB() {
  const db = await apriIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('output');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => resolve(null);
  });
}

// Chiamata da app.js quando si naviga nella sezione Ordini, per aggiornare le proposte
export function refreshProposte() { generaProposte(); }

// ─── Proposte ─────────────────────────────────────────────────────
function generaProposte() {
  const prodotti = getProdotti();

  const daOrdinare = prodotti.filter(p =>
    p.quantitaDisponibile <= p.sogliaAvviso &&
    !(p.quantitaOrdinata > 0)
  );

  const container = document.getElementById('list-proposte');

  if (daOrdinare.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun prodotto da ordinare.</p>';
    return;
  }

  const perFornitore = {};
  daOrdinare.forEach(p => {
    const f = p.idFornitore ?? '—';
    if (!perFornitore[f]) perFornitore[f] = [];
    perFornitore[f].push(p);
  });

  container.innerHTML = '';
  Object.keys(perFornitore)
    .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
    .forEach(f => container.appendChild(creaCardProposta(f, perFornitore[f])));
}

function creaCardProposta(fornitore, prodotti) {
  const righe = prodotti.map(p => `
    <tr data-id="${p.id}">
      <td><input type="checkbox" class="order-item-checkbox" checked></td>
      <td class="td-codice">${p.codice ?? '—'}</td>
      <td class="td-nome">${p.nome}</td>
      <td><input type="number" class="order-qty-input" value="${p.minimoOrdinabile ?? 1}" min="1"></td>
      <td class="td-unita">${p.unitaDiAcquisto ?? 'BOX'}</td>
      <td><input type="date" class="row-data-consegna"></td>
    </tr>`).join('');

  const card = document.createElement('div');
  card.className = 'proposta-card';

  card.innerHTML = `
    <div class="proposta-header">
      <div class="proposta-fornitore">${fornitore}</div>
      <button class="btn-primary btn-sm crea-ordine-btn">
        <i class="fas fa-paper-plane"></i> Crea Ordine
      </button>
    </div>
    <div class="table-scroll">
      <table class="proposta-table">
        <thead><tr>
          <th style="width:2.5rem"></th>
          <th>Codice</th><th>Nome</th>
          <th style="width:5rem">Qtà</th><th>Unità</th>
          <th style="width:9rem">Consegna</th>
        </tr></thead>
        <tbody>${righe}</tbody>
      </table>
    </div>
    <div class="proposta-footer">
      <span class="proposta-data-label">
        <i class="fas fa-calendar-alt"></i> Data di default:
      </span>
      <input type="date" class="proposta-data-default">
      <button class="btn-ghost btn-sm applica-data-btn">
        <i class="fas fa-check"></i> Applica a tutti
      </button>
    </div>`;

  return card;
}

function gestisciClickProposte(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  const card = btn.closest('.proposta-card');
  if (!card) return;

  // "Applica a tutti" — copia la data di default su ogni riga
  if (btn.classList.contains('applica-data-btn')) {
    const dataDefault = card.querySelector('.proposta-data-default').value;
    card.querySelectorAll('.row-data-consegna').forEach(input => {
      input.value = dataDefault;
    });
    return;
  }

  if (!btn.classList.contains('crea-ordine-btn')) return;

  const fornitore = card.querySelector('.proposta-fornitore').textContent;
  const righe = Array.from(card.querySelectorAll('tbody tr'))
    .filter(row => row.querySelector('.order-item-checkbox').checked);

  if (righe.length === 0) { alert('Seleziona almeno un prodotto.'); return; }

  const prodotti = righe.map(row => ({
    idProdotto:       row.dataset.id,
    codice:           row.querySelector('.td-codice').textContent,
    nome:             row.querySelector('.td-nome').textContent,
    quantitaOrdinata: parseInt(row.querySelector('.order-qty-input').value, 10),
    unita:            row.querySelector('.td-unita').textContent.trim(),
    dataConsegna:     row.querySelector('.row-data-consegna').value || null,
    ricevuto:         false
  }));

  const invalidi = prodotti.filter(p => isNaN(p.quantitaOrdinata) || p.quantitaOrdinata <= 0);
  if (invalidi.length > 0) { alert(`Quantità non valida per: "${invalidi[0].nome}"`); return; }

  btn.disabled = true;
  creaOrdine(fornitore, prodotti).finally(() => { btn.disabled = false; });
}

async function creaOrdine(fornitore, prodotti) {
  try {
    const batch = writeBatch(db);

    batch.set(doc(collection(db, "ordini")), {
      idFornitore: fornitore,
      dataOrdine:  serverTimestamp(),
      stato:       'Attivo',
      prodotti
    });

    prodotti.forEach(p => {
      batch.update(doc(db, "prodotti", p.idProdotto), {
        quantitaOrdinata:    increment(p.quantitaOrdinata),
        dataConsegnaPrevista: p.dataConsegna || null
      });
    });

    await batch.commit();
    const testo = generaTestoOrdine(fornitore, prodotti);
    await salvaOrdineInOutput(fornitore, testo);
    mostraTestoEmail(testo);
    generaProposte();
  } catch (err) {
    console.error("Errore creazione ordine:", err);
    alert("Errore durante la creazione dell'ordine.");
  }
}

function generaTestoOrdine(fornitore, prodotti) {
  const data  = new Date().toLocaleDateString('it-IT');
  const righe = prodotti
    .map(p => {
      const dataConsegna = p.dataConsegna
        ? ` (consegna: ${new Date(p.dataConsegna + 'T00:00:00').toLocaleDateString('it-IT')})`
        : '';
      return `• ${p.codice} — ${p.nome} — ${p.quantitaOrdinata} ${p.unita}${dataConsegna}`;
    })
    .join('\n');

  return `Ordine Tessiland — ${data}

Spett. ${fornitore},

Si richiede la seguente fornitura:
${righe}

Cordiali saluti
Tessiland`;
}

function mostraTestoEmail(testo) {
  document.getElementById('email-testo').value = testo;
  openModal('modal-email');
}

function copiaTestoEmail() {
  const textarea = document.getElementById('email-testo');
  textarea.select();
  navigator.clipboard.writeText(textarea.value).then(() => {
    const btn = document.getElementById('copy-email-btn');
    btn.textContent = 'Copiato!';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copia testo'; }, 2000);
  }).catch(() => {
    // Fallback per browser senza clipboard API
    document.execCommand('copy');
  });
}

// ─── Storico ──────────────────────────────────────────────────────
function caricaStorico() {
  const q = query(collection(db, "ordini"), orderBy("dataOrdine", "desc"));
  onSnapshot(q, snap => {
    ordiniStorico = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStorico();
  }, err => console.error("Errore storico ordini:", err));
}

function renderStorico() {
  const container = document.getElementById('list-storico');
  if (ordiniStorico.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun ordine attivo.</p>';
    return;
  }
  container.innerHTML = '';
  ordiniStorico.forEach(o => container.appendChild(creaCardStorico(o)));
}

function creaCardStorico(ordine) {
  const data = ordine.dataOrdine
    ? ordine.dataOrdine.toDate().toLocaleDateString('it-IT')
    : '—';

  const prodotti       = ordine.prodotti ?? [];
  const tuttiRicevuti  = prodotti.length > 0 && prodotti.every(p => p.ricevuto);

  const prodottiHtml = prodotti.map((p, i) => {
    const dataFmt = p.dataConsegna
      ? new Date(p.dataConsegna + 'T00:00:00').toLocaleDateString('it-IT')
      : '';
    const btnArrivo = p.ricevuto
      ? `<button class="arrivo-btn-completato" disabled>Caricata</button>`
      : `<button class="arrivo-btn"
           data-product-id="${p.idProdotto}"
           data-order-id="${ordine.id}"
           data-item-index="${i}"
           data-quantity="${p.quantitaOrdinata}"
           data-unita="${p.unita}"
           data-nome="${p.nome}">Arrivata</button>`;
    return `
      <li class="storico-item${p.ricevuto ? ' ricevuto' : ''}">
        <div class="storico-item-main">
          <span class="storico-item-nome">${p.nome} (${p.codice ?? '—'}) — <strong>${p.quantitaOrdinata} ${p.unita}</strong></span>
          <div class="storico-item-data-row">
            <input type="date" class="storico-prodotto-data"
              value="${p.dataConsegna ?? ''}"
              data-ordine-id="${ordine.id}"
              data-item-index="${i}"
              ${p.ricevuto ? 'disabled' : ''}
              title="Data consegna prevista">
            ${dataFmt ? `<span class="storico-consegna-fmt">${dataFmt}</span>` : ''}
          </div>
        </div>
        ${btnArrivo}
      </li>`;
  }).join('');

  const card = document.createElement('div');
  card.className = `ordine-storico-card${tuttiRicevuti ? ' completato' : ''}`;
  card.dataset.id = ordine.id;
  card.innerHTML = `
    <div class="storico-header">
      <div>
        <div class="storico-fornitore">${ordine.idFornitore}</div>
        <div class="storico-data">del ${data}</div>
      </div>
      <button class="btn-ghost btn-sm btn-ghost-danger cancella-ordine-btn" data-id="${ordine.id}">
        <i class="fas fa-trash"></i>
      </button>
    </div>
    <div class="storico-bulk-date">
      <span class="storico-consegna-label"><i class="fas fa-calendar-alt"></i> Data di default:</span>
      <input type="date" class="storico-data-default">
      <button class="btn-ghost btn-sm applica-tutti-storico-btn" data-id="${ordine.id}">
        <i class="fas fa-check"></i> Applica a tutti
      </button>
    </div>
    <ul class="storico-prodotti">${prodottiHtml}</ul>
    ${tuttiRicevuti ? '<div class="storico-completato-badge"><i class="fas fa-check-circle"></i> Tutto ricevuto</div>' : ''}
  `;

  return card;
}

function gestisciClickStorico(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.classList.contains('arrivo-btn')) {
    btn.disabled = true;
    registraArrivo(
      btn.dataset.productId, btn.dataset.orderId,
      parseInt(btn.dataset.itemIndex), parseInt(btn.dataset.quantity),
      btn.dataset.unita, btn.dataset.nome
    ).finally(() => { btn.disabled = false; });
  } else if (btn.classList.contains('cancella-ordine-btn')) {
    cancellaOrdine(btn.dataset.id);
  } else if (btn.classList.contains('applica-tutti-storico-btn')) {
    const card      = btn.closest('.ordine-storico-card');
    const dataVal   = card.querySelector('.storico-data-default').value;
    const ordineId  = btn.dataset.id;
    card.querySelectorAll('.storico-prodotto-data:not(:disabled)').forEach(input => {
      input.value = dataVal;
    });
    applicaDataATutti(ordineId, dataVal);
  }
}

function gestisciChangeStorico(e) {
  const input = e.target.closest('.storico-prodotto-data');
  if (!input) return;
  aggiornaDataConsegnaProdotto(
    input.dataset.ordineId,
    parseInt(input.dataset.itemIndex),
    input.value || null
  );
}

async function aggiornaDataConsegnaProdotto(ordineId, itemIndex, dataConsegna) {
  const ordine = ordiniStorico.find(o => o.id === ordineId);
  if (!ordine) return;
  const prodotti = ordine.prodotti.map((p, i) =>
    i === itemIndex ? { ...p, dataConsegna: dataConsegna ?? null } : p
  );
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "ordini", ordineId), { prodotti });
    const item = ordine.prodotti[itemIndex];
    if (item?.idProdotto) {
      batch.update(doc(db, "prodotti", item.idProdotto), {
        dataConsegnaPrevista: dataConsegna || null
      });
    }
    await batch.commit();
  } catch (err) { console.error("Errore salvataggio data consegna:", err); }
}

async function applicaDataATutti(ordineId, dataConsegna) {
  const ordine = ordiniStorico.find(o => o.id === ordineId);
  if (!ordine) return;
  const prodotti = ordine.prodotti.map(p =>
    p.ricevuto ? p : { ...p, dataConsegna: dataConsegna || null }
  );
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "ordini", ordineId), { prodotti });
    ordine.prodotti.forEach(p => {
      if (!p.ricevuto && p.idProdotto) {
        batch.update(doc(db, "prodotti", p.idProdotto), {
          dataConsegnaPrevista: dataConsegna || null
        });
      }
    });
    await batch.commit();
  } catch (err) { console.error("Errore applica data a tutti:", err); }
}

// ─── Battesimo (registra arrivo merce) ────────────────────────────
async function registraArrivo(productId, orderId, itemIndex, quantity, unita, nomeProdotto) {
  let quantitaDaCaricare;

  if (unita === 'KG') {
    const input = prompt(`Arrivati ${quantity} KG di "${nomeProdotto}".\nQuanti BOX caricare in magazzino?`);
    if (input === null || input.trim() === '' || isNaN(input) || Number(input) < 0) return;
    quantitaDaCaricare = parseInt(input, 10);
  } else {
    if (!confirm(`Confermi arrivo di ${quantity} ${unita} di "${nomeProdotto}"?`)) return;
    quantitaDaCaricare = quantity;
  }

  try {
    const productRef = doc(db, "prodotti", productId);
    const orderRef   = doc(db, "ordini", orderId);

    await runTransaction(db, async t => {
      const [prodSnap, ordSnap] = await Promise.all([t.get(productRef), t.get(orderRef)]);
      if (!prodSnap.exists()) throw new Error("Prodotto non trovato.");
      if (!ordSnap.exists())  throw new Error("Ordine non trovato.");

      const attualeDisp     = prodSnap.data().quantitaDisponibile ?? 0;
      const attualeOrdinato = prodSnap.data().quantitaOrdinata    ?? 0;

      const nuovoOrdinato = Math.max(0, attualeOrdinato - quantity);
      t.update(productRef, {
        quantitaDisponibile:  attualeDisp + quantitaDaCaricare,
        quantitaOrdinata:     nuovoOrdinato,
        dataConsegnaPrevista: nuovoOrdinato === 0 ? null : prodSnap.data().dataConsegnaPrevista ?? null
      });

      const prodotti = [...ordSnap.data().prodotti];
      prodotti[itemIndex] = { ...prodotti[itemIndex], ricevuto: true };
      t.update(orderRef, { prodotti });
    });
  } catch (err) {
    console.error("Errore registrazione arrivo:", err);
    alert(`Errore: ${err.message}`);
  }
}

// ─── Cancella ordine ──────────────────────────────────────────────
async function cancellaOrdine(ordineId) {
  if (!confirm("Cancellare l'ordine? La quantità ordinata verrà ripristinata nel magazzino.")) return;
  if (!confirm("Conferma definitiva: cancellare l'ordine?")) return;

  try {
    const ordineRef = doc(db, "ordini", ordineId);
    const ordineDoc = await getDoc(ordineRef);
    if (!ordineDoc.exists()) return;

    const batch = writeBatch(db);
    for (const p of ordineDoc.data().prodotti ?? []) {
      if (p.idProdotto && p.quantitaOrdinata > 0) {
        batch.update(doc(db, "prodotti", p.idProdotto), {
          quantitaOrdinata:    increment(-p.quantitaOrdinata),
          dataConsegnaPrevista: null
        });
      }
    }
    batch.delete(ordineRef);
    await batch.commit();
  } catch (err) {
    console.error("Errore cancellazione ordine:", err);
    alert(`Errore durante la cancellazione: ${err.message}`);
  }
}
