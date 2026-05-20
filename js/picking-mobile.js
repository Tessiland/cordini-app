import {
  collection, doc, addDoc, updateDoc, runTransaction,
  serverTimestamp, query, where, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti } from './prodotto-finito.js';
import { sbloccaAudio, suonoOk, suonoErrore } from './audio-mobile.js';

let db, operatoreCorrente;
let sessioneId      = null;
let sessioneData    = null;
let ordineCorrente  = null;
let pickingList     = [];
let itemIdx         = 0;
let modalitaScanner = null;  // 'camera' | 'hid' — scelto una volta all'apertura
let qrcodeScanner   = null;
let scanActive      = false;
let hidActive      = false;
let hidBuffer      = '';
let hidBufferTimer = null;

// ─── Init ─────────────────────────────────────────────────────────
export function initPickingMobile(firestoreDb, email) {
  db = firestoreDb;
  operatoreCorrente = email;

  document.getElementById('picking-exit-btn').addEventListener('click', mostraModaleUscita);
  document.getElementById('picking-mode-camera').addEventListener('click', () => scegliModo('camera'));
  document.getElementById('picking-mode-hid').addEventListener('click',    () => scegliModo('hid'));
  document.getElementById('picking-scan-btn').addEventListener('click', avviaScan);
  document.getElementById('picking-stop-scan-btn').addEventListener('click', () => { fermaScan(); aggiornaUI(); });
  document.getElementById('picking-stop-hid-btn').addEventListener('click', fermaHIDCompleto);
  document.getElementById('picking-confirm-ok').addEventListener('click', confermaScan);
  document.getElementById('picking-confirm-cancel').addEventListener('click', () => { nascondiTutti(); aggiornaUI(); });
  document.getElementById('picking-undo-btn').addEventListener('click', undoUltimaScan);
  document.getElementById('picking-exit-sospendi').addEventListener('click', sospendi);
  document.getElementById('picking-exit-annulla').addEventListener('click', annullaTutto);
  document.getElementById('picking-print-btn').addEventListener('click', stampaDistinta);
  document.getElementById('picking-close-btn').addEventListener('click', chiudiOverlay);
}

// ─── Avvia / Riprendi sessione ────────────────────────────────────
export async function avviaPickingMobile(ordine) {
  ordineCorrente = JSON.parse(JSON.stringify(ordine)); // deep copy

  const q = query(
    collection(db, 'prelievi_sessioni'),
    where('ordineId', '==', ordine.id),
    where('stato', '==', 'in_corso')
  );
  const snap = await getDocs(q);

  if (!snap.empty) {
    const d      = snap.docs[0];
    sessioneId   = d.id;
    sessioneData = d.data();
    sessioneData.scansioni = sessioneData.scansioni ?? [];
  } else {
    const ref = await addDoc(collection(db, 'prelievi_sessioni'), {
      ordineId:     ordine.id,
      ordineNumero: ordine.numero,
      operatore:    operatoreCorrente,
      dataInizio:   serverTimestamp(),
      dataFine:     null,
      stato:        'in_corso',
      scansioni:    []
    });
    sessioneId   = ref.id;
    sessioneData = {
      ordineId: ordine.id, ordineNumero: ordine.numero,
      operatore: operatoreCorrente, stato: 'in_corso', scansioni: []
    };
  }

  buildPickingList();
  modalitaScanner = null;
  document.getElementById('picking-overlay').classList.remove('hidden');
  document.body.classList.add('picking-active');
  nascondiTutti();
  nascondiCard();
  document.getElementById('picking-mode-select').classList.remove('hidden');
}

function scegliModo(modo) {
  modalitaScanner = modo;
  document.getElementById('picking-mode-select').classList.add('hidden');
  // In modalità HID il bottone camera non serve — lo nascondiamo
  document.getElementById('picking-scan-btn').classList.toggle('hidden', modo === 'hid');
  aggiornaUI();
}

// ─── Picking list ─────────────────────────────────────────────────
function buildPickingList() {
  const pfCache = getProdottiFiniti();

  pickingList = (ordineCorrente.items ?? [])
    .map((item, origIdx) => ({ ...item, origIdx }))
    .filter(item => item.idProdottoFinito)
    .map(item => {
      const pf          = pfCache.find(p => p.id === item.idProdottoFinito);
      const colore      = pf?.coloriComponenti?.length === 1
        ? pf.colore || pf.coloriComponenti[0].nomeColore || '—'
        : pf?.colore ?? '—';
      const qtyPrelevata = (sessioneData.scansioni ?? [])
        .filter(s => s.sku === item.sku && !s.annullata)
        .reduce((sum, s) => sum + s.qtyPrelevata, 0);

      return {
        sku:              item.sku,
        nome:             pf?.nome ?? item.nome ?? '—',
        colore,
        ubicazione:       pf?.ubicazione ?? '—',
        idProdottoFinito: item.idProdottoFinito,
        qtyRichiesta:     item.qtyRichiesta,
        qtyPrelevata,
        origIdx:          item.origIdx,
        completato:       item.spuntato || qtyPrelevata >= item.qtyRichiesta
      };
    });

  // Ordina per ubicazione (completati in fondo), senza ubicazione alla fine del gruppo
  pickingList.sort((a, b) => {
    if (a.completato !== b.completato) return a.completato ? 1 : -1;
    const ubA = a.ubicazione?.trim() || null;
    const ubB = b.ubicazione?.trim() || null;
    if (!ubA && !ubB) return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
    if (!ubA) return 1;
    if (!ubB) return -1;
    return ubA.localeCompare(ubB, 'it', { sensitivity: 'base' });
  });

  itemIdx = pickingList.findIndex(i => !i.completato);
  if (itemIdx === -1) itemIdx = pickingList.length;
}

// ─── UI ──────────────────────────────────────────────────────────
function aggiornaUI() {
  const completati = pickingList.filter(i => i.completato).length;
  const totale     = pickingList.length;

  document.getElementById('picking-items-done').textContent  = completati;
  document.getElementById('picking-items-total').textContent = totale;
  document.getElementById('picking-progress-bar').style.width =
    totale > 0 ? `${Math.round((completati / totale) * 100)}%` : '0%';

  nascondiTutti();

  if (completati === totale && totale > 0) {
    mostraStatoCompletato();
    return;
  }

  const item = pickingList[itemIdx];
  if (!item) return;

  document.getElementById('picking-item-nome').textContent       = item.nome;
  document.getElementById('picking-item-colore').textContent     = item.colore;
  document.getElementById('picking-item-sku').textContent        = item.sku;
  document.getElementById('picking-item-ubicazione').textContent = item.ubicazione;
  document.getElementById('picking-qty-done').textContent        = item.qtyPrelevata;
  document.getElementById('picking-qty-totale').textContent      = item.qtyRichiesta;

  const scansNec = Math.ceil(item.qtyRichiesta / 30);
  const scansFatte = (sessioneData.scansioni ?? [])
    .filter(s => s.sku === item.sku && !s.annullata).length;
  document.getElementById('picking-scan-count').textContent  = scansFatte;
  document.getElementById('picking-scan-needed').textContent = scansNec;

  document.getElementById('picking-item-card').classList.remove('hidden');
  document.getElementById('picking-main-actions').classList.remove('hidden');

  const haScansioni = (sessioneData.scansioni ?? []).some(s => !s.annullata);
  document.getElementById('picking-undo-btn').disabled = !haScansioni;

  // In modalità HID riattiva lo scanner (solo se non già attivo)
  if (modalitaScanner === 'hid' && !hidActive) avviaHID();
}

function nascondiTutti() {
  // picking-item-card NON è in questa lista — resta sempre visibile durante il picking
  ['picking-mode-select', 'picking-scanner-wrap', 'picking-hid-wrap',
   'picking-confirm-wrap', 'picking-done-wrap', 'picking-success-flash',
   'picking-main-actions'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
}

function nascondiCard() {
  document.getElementById('picking-item-card').classList.add('hidden');
}

function mostraCard() {
  document.getElementById('picking-item-card').classList.remove('hidden');
}

async function mostraStatoCompletato() {
  nascondiCard();
  document.getElementById('picking-done-wrap').classList.remove('hidden');
  try {
    await updateDoc(doc(db, 'prelievi_sessioni', sessioneId), {
      stato:   'completato',
      dataFine: serverTimestamp()
    });
    sessioneData.stato = 'completato';
  } catch (err) {
    console.error('Errore chiusura sessione:', err);
  }
}

// ─── Scanner ─────────────────────────────────────────────────────
function avviaScan() {
  if (!window.Html5Qrcode) {
    alert('Scanner non disponibile. Ricarica la pagina.');
    return;
  }
  nascondiTutti();
  nascondiCard(); // camera prende tutto lo schermo
  document.getElementById('picking-scanner-wrap').classList.remove('hidden');
  document.getElementById('picking-stop-scan-btn').classList.remove('hidden');

  sbloccaAudio(); // sblocca AudioContext su iOS al gesto utente
  qrcodeScanner = new window.Html5Qrcode('picking-reader');
  scanActive    = true;

  qrcodeScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 100 } },
    (testo) => {
      if (!scanActive) return;
      fermaScan();
      onScanSuccess(testo.trim());
    },
    () => {}
  ).catch(err => {
    console.error('Errore camera:', err);
    fermaScan();
    alert('Impossibile avviare la fotocamera. Controlla i permessi del browser.');
    aggiornaUI();
  });
}

function fermaScan() {
  scanActive = false;
  document.getElementById('picking-scanner-wrap').classList.add('hidden');
  document.getElementById('picking-stop-scan-btn').classList.add('hidden');
  if (qrcodeScanner) {
    qrcodeScanner.stop().catch(() => {}).finally(() => {
      try { qrcodeScanner.clear(); } catch (_) {}
      qrcodeScanner = null;
    });
  }
}

// ─── Modalità HID (scanner fisico) ───────────────────────────────
function hidKeyHandler(e) {
  if (!hidActive) return;

  if (e.key === 'Enter' || e.keyCode === 13 || e.which === 13) {
    e.preventDefault();
    const barcode = hidBuffer.trim();
    hidBuffer = '';
    clearTimeout(hidBufferTimer);
    document.getElementById('picking-hid-buffer').textContent = '';
    if (barcode) {
      fermaHID();
      onScanSuccess(barcode);
    }
    return;
  }

  if (e.key.length === 1) {
    hidBuffer += e.key;
    document.getElementById('picking-hid-buffer').textContent = hidBuffer;
    clearTimeout(hidBufferTimer);
    hidBufferTimer = setTimeout(() => {
      hidBuffer = '';
      document.getElementById('picking-hid-buffer').textContent = '';
    }, 500);
  }
}

function avviaHID() {
  // Nessun input focalizzato → nessuna tastiera virtuale
  hidActive  = true;
  hidBuffer  = '';
  document.getElementById('picking-hid-buffer').textContent = '';
  document.getElementById('picking-hid-wrap').classList.remove('hidden');
  document.getElementById('picking-stop-hid-btn').classList.remove('hidden');
  document.addEventListener('keydown', hidKeyHandler);
}

function fermaHIDCompleto() {
  fermaHID();
  modalitaScanner = null;
  nascondiTutti();
  nascondiCard();
  document.getElementById('picking-mode-select').classList.remove('hidden');
}

function fermaHID() {
  hidActive = false;
  hidBuffer = '';
  clearTimeout(hidBufferTimer);
  document.removeEventListener('keydown', hidKeyHandler);
  document.getElementById('picking-hid-buffer').textContent = '';
  document.getElementById('picking-hid-wrap').classList.add('hidden');
  document.getElementById('picking-stop-hid-btn').classList.add('hidden');
}

function onScanSuccess(barcode) {
  const item = pickingList[itemIdx];
  if (!item) return;

  if (barcode !== item.sku) {
    suonoErrore();
    alert(`Barcode non corrisponde.\nAtteso: ${item.sku}\nLetto: ${barcode}`);
    aggiornaUI();
    return;
  }

  const qty = parseInt(document.getElementById('picking-qty-input').value, 10) || 30;

  document.getElementById('picking-confirm-msg').textContent = `${item.nome} — ${item.colore}`;
  document.getElementById('picking-confirm-riepilogo').textContent =
    `Stai prelevando ${qty} pz${qty % 30 !== 0 ? ' ⚠️ (quantità anomala)' : ''}`;

  // Nasconde solo i controlli di scan, non la card prodotto
  ['picking-main-actions', 'picking-hid-wrap', 'picking-scanner-wrap'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  document.getElementById('picking-stop-hid-btn').classList.add('hidden');
  mostraCard(); // assicura card visibile (dopo camera che la nasconde)
  document.getElementById('picking-confirm-wrap').classList.remove('hidden');
}

// ─── Conferma prelievo ────────────────────────────────────────────
async function confermaScan() {
  const item = pickingList[itemIdx];
  const qty  = parseInt(document.getElementById('picking-qty-input').value, 10);
  if (!item || !qty || qty < 1) return;

  const btn = document.getElementById('picking-confirm-ok');
  btn.disabled = true;

  try {
    await eseguiPrelievo(item, qty);
    suonoOk();

    // Flash successo
    nascondiTutti();
    document.getElementById('picking-success-msg').textContent =
      `✓ ${qty} pz prelevati${qty % 30 !== 0 ? ' ⚠️' : ''}`;
    document.getElementById('picking-success-flash').classList.remove('hidden');

    setTimeout(() => {
      document.getElementById('picking-success-flash').classList.add('hidden');
      buildPickingList();
      aggiornaUI();
    }, 1500);
  } catch (err) {
    console.error('Errore prelievo:', err);
    alert(`Errore: ${err.message}`);
    aggiornaUI();
  } finally {
    btn.disabled = false;
  }
}

async function eseguiPrelievo(item, qty) {
  const pfRef      = doc(db, 'prodotti_finiti', item.idProdottoFinito);
  const ordineRef  = doc(db, 'ordini_produzione', ordineCorrente.id);
  const sessRef    = doc(db, 'prelievi_sessioni', sessioneId);
  const scanId     = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Calcola qtyTotale dopo questa scansione
  const qtyGiaPrelevata = (sessioneData.scansioni ?? [])
    .filter(s => s.sku === item.sku && !s.annullata)
    .reduce((sum, s) => sum + s.qtyPrelevata, 0);
  const qtyTotaleItem = qtyGiaPrelevata + qty;
  const itemCompleto  = qtyTotaleItem >= item.qtyRichiesta;

  const nuovaScan = {
    id:               scanId,
    sku:              item.sku,
    idProdottoFinito: item.idProdottoFinito,
    nomeProdotto:     item.nome,
    colore:           item.colore,
    ubicazione:       item.ubicazione,
    qtyRichiesta:     item.qtyRichiesta,
    qtyPrelevata:     qty,
    completoItem:     itemCompleto,
    timestamp:        new Date().toISOString(),
    annullata:        false
  };

  await runTransaction(db, async t => {
    const [pfSnap, ordineSnap] = await Promise.all([t.get(pfRef), t.get(ordineRef)]);

    if (!pfSnap.exists())     throw new Error('Prodotto finito non trovato.');
    if (!ordineSnap.exists()) throw new Error('Ordine non trovato.');

    const stockAttuale = pfSnap.data().quantitaRocche ?? 0;
    const nuovoStock   = stockAttuale - qty;
    const maiConsegnata = pfSnap.data().maiConsegnata ?? true;

    t.update(pfRef, { quantitaRocche: nuovoStock, maiConsegnata: false });

    t.set(doc(collection(db, 'movimenti_pf')), {
      idProdotto:   item.idProdottoFinito,
      nomeProdotto: item.nome,
      tipo:         'prelievo',
      quantita:     qty,
      quantitaDopo: nuovoStock,
      nota:         `Picking mobile — Ordine #${ordineCorrente.numero}`,
      operatore:    operatoreCorrente,
      sessione:     sessioneId,
      scanId,
      timestamp:    serverTimestamp()
    });

    if (itemCompleto) {
      const freshItems = [...ordineSnap.data().items];
      freshItems[item.origIdx] = {
        ...freshItems[item.origIdx],
        spuntato:      true,
        qtyConsegnata: qtyTotaleItem,
        nuovaPartita:  maiConsegnata
      };
      const statoNuovo = freshItems.every(i => i.spuntato || !i.idProdottoFinito)
        ? 'chiuso' : 'aperto';
      t.update(ordineRef, { items: freshItems, stato: statoNuovo });

      // Aggiorna copia locale ordine
      ordineCorrente.items[item.origIdx] = {
        ...ordineCorrente.items[item.origIdx],
        spuntato: true, qtyConsegnata: qtyTotaleItem
      };
    }
  });

  // Aggiorna sessione (fuori dalla transaction: solo append)
  const scansioni = [...(sessioneData.scansioni ?? []), nuovaScan];
  await updateDoc(sessRef, { scansioni });
  sessioneData.scansioni = scansioni;
}

// ─── Undo ultima scansione ────────────────────────────────────────
async function undoUltimaScan() {
  const scansioni = sessioneData.scansioni ?? [];
  const ultimaIdx = [...scansioni].map((s, i) => ({ s, i }))
    .reverse()
    .find(({ s }) => !s.annullata);

  if (!ultimaIdx) return;

  const ultima = ultimaIdx.s;
  const idx    = ultimaIdx.i;

  if (!confirm(`Annullare il prelievo di ${ultima.qtyPrelevata} pz di "${ultima.nomeProdotto}"?\nLa quantità tornerà a magazzino.`))
    return;

  const pfRef     = doc(db, 'prodotti_finiti', ultima.idProdottoFinito);
  const ordineRef = doc(db, 'ordini_produzione', ordineCorrente.id);
  const sessRef   = doc(db, 'prelievi_sessioni', sessioneId);

  try {
    await runTransaction(db, async t => {
      const [pfSnap, ordineSnap] = await Promise.all([t.get(pfRef), t.get(ordineRef)]);

      const stockAttuale = pfSnap.data().quantitaRocche ?? 0;
      const nuovoStock   = stockAttuale + ultima.qtyPrelevata;

      t.update(pfRef, { quantitaRocche: nuovoStock });

      t.set(doc(collection(db, 'movimenti_pf')), {
        idProdotto:   ultima.idProdottoFinito,
        nomeProdotto: ultima.nomeProdotto,
        tipo:         'rettifica',
        quantita:     ultima.qtyPrelevata,
        quantitaDopo: nuovoStock,
        nota:         `Undo picking mobile — Ordine #${ordineCorrente.numero}`,
        operatore:    operatoreCorrente,
        sessione:     sessioneId,
        timestamp:    serverTimestamp()
      });

      // Se la scan aveva completato l'item, re-spunta indietro
      if (ultima.completoItem) {
        const freshItems = [...ordineSnap.data().items];
        const origIdx    = freshItems.findIndex(it => it.sku === ultima.sku);
        if (origIdx !== -1) {
          freshItems[origIdx] = {
            ...freshItems[origIdx],
            spuntato: false, qtyConsegnata: null
          };
          t.update(ordineRef, { items: freshItems, stato: 'aperto' });
          ordineCorrente.items[origIdx] = { ...ordineCorrente.items[origIdx], spuntato: false, qtyConsegnata: null };
        }
      }
    });

    // Aggiorna sessione locale
    const nuoveScansioni = sessioneData.scansioni.map((s, i) =>
      i === idx ? { ...s, annullata: true } : s
    );
    await updateDoc(sessRef, { scansioni: nuoveScansioni });
    sessioneData.scansioni = nuoveScansioni;

    buildPickingList();
    aggiornaUI();
  } catch (err) {
    console.error('Errore undo:', err);
    alert(`Errore: ${err.message}`);
  }
}

// ─── Uscita ───────────────────────────────────────────────────────
function mostraModaleUscita() {
  fermaScan();
  const haScansioni = (sessioneData?.scansioni ?? []).some(s => !s.annullata);
  if (!haScansioni) {
    chiudiOverlay();
    return;
  }
  document.getElementById('modal-picking-exit').classList.remove('hidden');
}

async function sospendi() {
  document.getElementById('modal-picking-exit').classList.add('hidden');
  chiudiOverlay();
}

async function annullaTutto() {
  if (!confirm('Annullare tutte le scansioni di questa sessione? Le quantità torneranno a magazzino.'))
    return;

  document.getElementById('modal-picking-exit').classList.add('hidden');

  const scansioni = (sessioneData.scansioni ?? []).filter(s => !s.annullata);

  try {
    // Ripristina ogni scan in ordine inverso
    for (const scan of [...scansioni].reverse()) {
      const pfRef = doc(db, 'prodotti_finiti', scan.idProdottoFinito);
      const pfSnap = await getDoc(pfRef);
      const stockAttuale = pfSnap.data()?.quantitaRocche ?? 0;
      const nuovoStock   = stockAttuale + scan.qtyPrelevata;

      await runTransaction(db, async t => {
        t.update(pfRef, { quantitaRocche: nuovoStock });
        t.set(doc(collection(db, 'movimenti_pf')), {
          idProdotto:   scan.idProdottoFinito,
          nomeProdotto: scan.nomeProdotto,
          tipo:         'rettifica',
          quantita:     scan.qtyPrelevata,
          quantitaDopo: nuovoStock,
          nota:         `Annullo sessione mobile — Ordine #${ordineCorrente.numero}`,
          operatore:    operatoreCorrente,
          sessione:     sessioneId,
          timestamp:    serverTimestamp()
        });
      });
    }

    // Ripristina spuntati nell'ordine
    const ordineRef  = doc(db, 'ordini_produzione', ordineCorrente.id);
    const ordineSnap = await getDoc(ordineRef);
    if (ordineSnap.exists()) {
      const freshItems = ordineSnap.data().items.map(it => {
        const eraInSessione = scansioni.some(s => s.sku === it.sku && s.completoItem);
        return eraInSessione ? { ...it, spuntato: false, qtyConsegnata: null } : it;
      });
      await updateDoc(ordineRef, { items: freshItems, stato: 'aperto' });
    }

    await updateDoc(doc(db, 'prelievi_sessioni', sessioneId), {
      stato:   'annullato',
      dataFine: serverTimestamp(),
      scansioni: sessioneData.scansioni.map(s => ({ ...s, annullata: true }))
    });
  } catch (err) {
    console.error('Errore annulla tutto:', err);
    alert(`Errore durante l'annullamento: ${err.message}`);
  }

  chiudiOverlay();
}

function chiudiOverlay() {
  fermaScan();
  fermaHID();
  document.getElementById('picking-overlay').classList.add('hidden');
  document.getElementById('modal-picking-exit').classList.add('hidden');
  document.body.classList.remove('picking-active');
  sessioneId      = null;
  sessioneData    = null;
  ordineCorrente  = null;
  pickingList     = [];
  modalitaScanner = null;
}

// ─── Stampa distinta ──────────────────────────────────────────────
function stampaDistinta() {
  const scansioni  = (sessioneData?.scansioni ?? []).filter(s => !s.annullata);
  const perSku     = new Map();

  for (const s of scansioni) {
    if (!perSku.has(s.sku)) {
      perSku.set(s.sku, {
        nome: s.nomeProdotto, colore: s.colore, sku: s.sku,
        ubicazione: s.ubicazione, qtyRichiesta: s.qtyRichiesta,
        qtyConsegnata: 0
      });
    }
    perSku.get(s.sku).qtyConsegnata += s.qtyPrelevata;
  }

  const righe = [...perSku.values()].map(r => {
    const anomalia = r.qtyConsegnata % 30 !== 0;
    return `<tr${anomalia ? ' class="distinta-anomalia"' : ''}>
      <td>${r.nome}</td>
      <td>${r.colore}</td>
      <td>${r.sku}</td>
      <td>${r.ubicazione}</td>
      <td class="tc">${r.qtyRichiesta}</td>
      <td class="tc"><b>${r.qtyConsegnata}</b></td>
      <td class="tc">${anomalia ? '<span class="distinta-alert">⚠️</span>' : '✓'}</td>
    </tr>`;
  }).join('');

  const anomalie  = [...perSku.values()].filter(r => r.qtyConsegnata % 30 !== 0).length;
  const dataOggi  = new Date().toLocaleDateString('it-IT');

  const area = document.getElementById('print-area');
  area.innerHTML = `
    <div class="print-doc">
      <div class="print-header">
        <h1>Distinta di Consegna Mobile</h1>
        <div class="print-meta">
          <span><b>Ordine #${ordineCorrente?.numero ?? '—'}</b></span>
          <span>Hub: ${ordineCorrente?.hub ?? '—'}</span>
          <span>Operatore: ${operatoreCorrente}</span>
          <span>Data: ${dataOggi}</span>
        </div>
      </div>
      <table class="print-table">
        <thead><tr>
          <th>Prodotto</th><th>Colore</th><th>SKU</th><th>Ubicazione</th>
          <th class="tc">Ordinato</th><th class="tc">Consegnato</th><th class="tc">Stato</th>
        </tr></thead>
        <tbody>${righe}</tbody>
      </table>
      <div class="print-footer">
        Articoli: ${perSku.size}
        ${anomalie > 0 ? ` · <strong>⚠️ ${anomalie} riga/e da verificare nel WMS</strong>` : ' · Tutto corretto'}
      </div>
      <div class="print-firma">
        <div class="firma-box"><div class="firma-line"></div><div class="firma-label">Firma operatore</div></div>
        <div class="firma-box"><div class="firma-line"></div><div class="firma-label">Firma ricevente</div></div>
      </div>
    </div>`;

  window.print();
  setTimeout(() => { area.innerHTML = ''; }, 1500);
}
