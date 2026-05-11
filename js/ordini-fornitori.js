import {
  collection, query, orderBy, onSnapshot, doc, addDoc,
  getDoc, updateDoc, deleteDoc, runTransaction, writeBatch,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdotti } from './magazzino.js';
import { openModal, closeModal } from './nav.js';

let db;
let ordiniStorico = [];

export function initOrdiniFornitori(firestoreDb) {
  db = firestoreDb;

  document.getElementById('aggiorna-proposte-btn').addEventListener('click', generaProposte);
  document.getElementById('list-proposte').addEventListener('click', gestisciClickProposte);
  document.getElementById('list-storico').addEventListener('click', gestisciClickStorico);
  document.getElementById('copy-email-btn').addEventListener('click', copiaTestoEmail);

  generaProposte();
  caricaStorico();
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
        </tr></thead>
        <tbody>${righe}</tbody>
      </table>
    </div>
    <div class="proposta-footer">
      <label class="proposta-data-label">
        <i class="fas fa-calendar-alt"></i> Data consegna prevista
        <span style="color:var(--text-muted);font-size:.7rem">(opzionale)</span>
      </label>
      <input type="date" class="proposta-data-consegna">
    </div>`;

  return card;
}

function gestisciClickProposte(e) {
  const btn = e.target.closest('.crea-ordine-btn');
  if (!btn) return;

  const card = btn.closest('.proposta-card');
  if (!card) return;

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
    ricevuto:         false
  }));

  const invalidi = prodotti.filter(p => isNaN(p.quantitaOrdinata) || p.quantitaOrdinata <= 0);
  if (invalidi.length > 0) { alert(`Quantità non valida per: "${invalidi[0].nome}"`); return; }

  const dataConsegna = card.querySelector('.proposta-data-consegna')?.value || null;

  btn.disabled = true;
  creaOrdine(fornitore, prodotti, dataConsegna).finally(() => { btn.disabled = false; });
}

async function creaOrdine(fornitore, prodotti, dataConsegna) {
  try {
    const batch = writeBatch(db);

    batch.set(doc(collection(db, "ordini")), {
      idFornitore:          fornitore,
      dataOrdine:           serverTimestamp(),
      stato:                'Attivo',
      dataConsegnaPrevista: dataConsegna || null,
      prodotti
    });

    prodotti.forEach(p => {
      batch.update(doc(db, "prodotti", p.idProdotto), {
        quantitaOrdinata: increment(p.quantitaOrdinata)
      });
    });

    await batch.commit();
    mostraTestoEmail(fornitore, prodotti);
    generaProposte();
  } catch (err) {
    console.error("Errore creazione ordine:", err);
    alert("Errore durante la creazione dell'ordine.");
  }
}

function mostraTestoEmail(fornitore, prodotti) {
  const data  = new Date().toLocaleDateString('it-IT');
  const righe = prodotti
    .map(p => `• ${p.codice} — ${p.nome} — ${p.quantitaOrdinata} ${p.unita}`)
    .join('\n');

  const testo = `Ordine Tessiland — ${data}

Spett. ${fornitore},

Si richiede la seguente fornitura:
${righe}

Cordiali saluti
Tessiland`;

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
    const btn = p.ricevuto
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
        <span class="storico-item-nome">${p.nome} (${p.codice ?? '—'}) — <strong>${p.quantitaOrdinata} ${p.unita}</strong></span>
        ${btn}
      </li>`;
  }).join('');

  const dataConsegnaFmt = ordine.dataConsegnaPrevista
    ? new Date(ordine.dataConsegnaPrevista + 'T00:00:00').toLocaleDateString('it-IT')
    : null;

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
    <div class="storico-data-consegna">
      <label class="storico-consegna-label">
        <i class="fas fa-calendar-alt"></i> Consegna prevista:
      </label>
      <input type="date" class="storico-consegna-input"
        value="${ordine.dataConsegnaPrevista ?? ''}"
        data-id="${ordine.id}"
        placeholder="—">
      ${dataConsegnaFmt ? `<span class="storico-consegna-fmt">${dataConsegnaFmt}</span>` : ''}
    </div>
    <ul class="storico-prodotti">${prodottiHtml}</ul>
    ${tuttiRicevuti ? '<div class="storico-completato-badge"><i class="fas fa-check-circle"></i> Tutto ricevuto</div>' : ''}
  `;

  card.querySelector('.storico-consegna-input').addEventListener('change', async e => {
    try {
      await updateDoc(doc(db, "ordini", ordine.id), {
        dataConsegnaPrevista: e.target.value || null
      });
    } catch (err) { console.error("Errore salvataggio data consegna:", err); }
  });

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
  }
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

      t.update(productRef, {
        quantitaDisponibile: attualeDisp + quantitaDaCaricare,
        quantitaOrdinata:    Math.max(0, attualeOrdinato - quantity)
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
      if (p.idProdotto) {
        batch.update(doc(db, "prodotti", p.idProdotto), {
          quantitaOrdinata: increment(-p.quantitaOrdinata)
        });
      }
    }
    batch.delete(ordineRef);
    await batch.commit();
  } catch (err) {
    console.error("Errore cancellazione ordine:", err);
    alert('Errore durante la cancellazione.');
  }
}
