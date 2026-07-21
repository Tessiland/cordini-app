import {
  collection, query, orderBy, limit,
  addDoc, updateDoc, doc, writeBatch, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LS_IDENTITA = 'cordini_bacheca_identita';
const LIMIT       = 60;

const COLORI = {
  'Alessandro':         'colore-alessandro',
  'Operatori':          'colore-operatori',
  'Centrale Operativa': 'colore-centrale'
};

let db;
let messaggi = [];
let vista = 'messaggi'; // 'messaggi' | 'archivio'

export function initBacheca(firestoreDb) {
  db = firestoreDb;

  document.getElementById('message-form').addEventListener('submit', inviaMessaggio);

  // L'identità scelta nel select firma anche le spunte "letto da"
  const select = document.getElementById('operator-select');
  const salvata = localStorage.getItem(LS_IDENTITA);
  if (salvata && COLORI[salvata]) select.value = salvata;
  select.addEventListener('change', () => localStorage.setItem(LS_IDENTITA, select.value));

  // Tab Messaggi / Archivio
  document.querySelectorAll('.bacheca-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      vista = btn.dataset.bachecaTab;
      renderMessaggi();
    });
  });

  document.getElementById('bacheca-segna-tutti').addEventListener('click', segnaTuttiLetti);

  document.getElementById('message-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-azione]');
    if (!btn) return;
    const { azione, id } = btn.dataset;
    if (azione === 'leggi')      segnaLetto(id, btn);
    if (azione === 'archivia')   archivia(id, true, btn);
    if (azione === 'ripristina') archivia(id, false, btn);
  });

  caricaMessaggi();
}

function identitaCorrente() {
  return document.getElementById('operator-select')?.value ?? 'Operatori';
}

// ─── Caricamento real-time ────────────────────────────────────────
function caricaMessaggi() {
  const q = query(
    collection(db, "messaggi"),
    orderBy("timestamp", "desc"),
    limit(LIMIT)
  );
  onSnapshot(q, snap => {
    messaggi = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMessaggi();
    aggiornaNotifica();
  }, err => console.error("Errore bacheca:", err));
}

// ─── Render ───────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formattaData(ts) {
  const d = ts?.toDate?.() ?? null;
  if (!d) return '';
  return d.toLocaleDateString('it-IT') + ' ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function cardMessaggio(m) {
  const classe = COLORI[m.operatore] ?? 'msg-default';
  const nuovo  = !m.letto;
  let azioni;
  if (m.archiviato) {
    azioni = `
      <span class="tag-letto"><i class="fas fa-box-archive"></i> Archiviato</span>
      <button class="btn-msg btn-msg-archivia" data-azione="ripristina" data-id="${m.id}">
        <i class="fas fa-rotate-left"></i> Riporta in bacheca
      </button>`;
  } else if (nuovo) {
    azioni = `
      <button class="btn-msg btn-msg-leggi" data-azione="leggi" data-id="${m.id}">
        <i class="fas fa-check"></i> Segna come letto
      </button>`;
  } else {
    azioni = `
      <span class="tag-letto"><i class="fas fa-check-double"></i>
        Letto${m.lettoDa ? ' da ' + escapeHtml(m.lettoDa) : ''}${m.lettoIl ? ' · ' + formattaData(m.lettoIl) : ''}
      </span>
      <button class="btn-msg btn-msg-archivia" data-azione="archivia" data-id="${m.id}">
        <i class="fas fa-box-archive"></i> Archivia
      </button>`;
  }
  return `
    <div class="message-item ${classe} ${nuovo && !m.archiviato ? '' : 'msg-letto'}" data-msg="${m.id}">
      <div class="message-header">
        <span class="message-author">${nuovo && !m.archiviato ? '<span class="dot-nuovo"></span>' : ''}${escapeHtml(m.operatore ?? '—')}</span>
        <span class="message-date">${formattaData(m.timestamp)}</span>
      </div>
      <p class="message-body">${escapeHtml(m.testo)}</p>
      <div class="message-actions">${azioni}</div>
    </div>`;
}

function renderMessaggi() {
  const container = document.getElementById('message-list');
  const attivi    = messaggi.filter(m => !m.archiviato);
  const archivio  = messaggi.filter(m => m.archiviato);
  const nonLetti  = attivi.filter(m => !m.letto);

  // Tab: stato attivo + conteggi
  document.querySelectorAll('.bacheca-tab').forEach(btn => {
    const attiva = btn.dataset.bachecaTab === vista;
    btn.classList.toggle('active', attiva);
    const n = btn.querySelector('.bacheca-tab-count');
    if (n) n.textContent = btn.dataset.bachecaTab === 'messaggi' ? attivi.length : archivio.length;
  });

  // "Segna tutti come letti" solo se serve
  const btnTutti = document.getElementById('bacheca-segna-tutti');
  btnTutti.classList.toggle('hidden', vista !== 'messaggi' || nonLetti.length === 0);

  // Divisore "N nuovi"
  const divider = document.getElementById('bacheca-divider');
  if (vista === 'messaggi' && nonLetti.length > 0) {
    divider.classList.remove('hidden');
    divider.querySelector('span').textContent =
      nonLetti.length === 1 ? '1 nuovo messaggio' : `${nonLetti.length} nuovi messaggi`;
  } else {
    divider.classList.add('hidden');
  }

  // Composer visibile solo nella bacheca
  document.getElementById('message-form').classList.toggle('hidden', vista !== 'messaggi');

  const daMostrare = vista === 'messaggi' ? attivi : archivio;
  if (daMostrare.length === 0) {
    container.innerHTML = `<p class="empty-state">${vista === 'messaggi' ? 'Nessun messaggio.' : 'L’archivio è vuoto.'}</p>`;
    return;
  }
  container.innerHTML = daMostrare.map(cardMessaggio).join('');
}

// ─── Azioni ──────────────────────────────────────────────────────
async function segnaLetto(id, btn) {
  btn.disabled = true;
  // Effetto trasparenza immediato, il re-render arriva dall'onSnapshot
  btn.closest('.message-item')?.classList.add('msg-letto');
  try {
    await updateDoc(doc(db, "messaggi", id), {
      letto: true,
      lettoDa: identitaCorrente(),
      lettoIl: serverTimestamp()
    });
  } catch (err) {
    console.error("Errore segna letto:", err);
    btn.disabled = false;
  }
}

async function archivia(id, valore, btn) {
  btn.disabled = true;
  const card = btn.closest('.message-item');
  if (card) card.classList.add('msg-esce');
  try {
    await updateDoc(doc(db, "messaggi", id), { archiviato: valore });
  } catch (err) {
    console.error("Errore archivia:", err);
    btn.disabled = false;
    card?.classList.remove('msg-esce');
  }
}

async function segnaTuttiLetti() {
  const daLeggere = messaggi.filter(m => !m.archiviato && !m.letto);
  if (daLeggere.length === 0) return;
  const btn = document.getElementById('bacheca-segna-tutti');
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    daLeggere.forEach(m => {
      batch.update(doc(db, "messaggi", m.id), {
        letto: true,
        lettoDa: identitaCorrente(),
        lettoIl: serverTimestamp()
      });
    });
    await batch.commit();
  } catch (err) {
    console.error("Errore segna tutti:", err);
  } finally {
    btn.disabled = false;
  }
}

// ─── Invia ───────────────────────────────────────────────────────
async function inviaMessaggio(e) {
  e.preventDefault();
  const operatore = document.getElementById('operator-select').value;
  const testo     = document.getElementById('message-text').value.trim();
  const btn       = e.target.querySelector('button[type="submit"]');
  if (!testo) return;

  btn.disabled = true;
  try {
    await addDoc(collection(db, "messaggi"), {
      operatore,
      testo,
      timestamp: serverTimestamp(),
      letto: false,
      archiviato: false
    });
    document.getElementById('message-text').value = '';
  } catch (err) {
    console.error("Errore invio messaggio:", err);
  } finally {
    btn.disabled = false;
  }
}

// ─── Badge notifica ───────────────────────────────────────────────
function aggiornaNotifica() {
  const nonLetti = messaggi.filter(m => !m.archiviato && !m.letto);
  const badge = document.getElementById('bacheca-badge');
  if (!badge) return;
  if (nonLetti.length > 0) {
    badge.textContent = nonLetti.length > 9 ? '9+' : nonLetti.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
