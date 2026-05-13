import {
  collection, query, orderBy, limit,
  addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LS_KEY   = 'cordini_bacheca_ultima_visita';
const LIMIT    = 60;

const COLORI = {
  'Alessandro':         'colore-alessandro',
  'Operatori':          'colore-operatori',
  'Centrale Operativa': 'colore-centrale'
};

let db;
let messaggi = [];

export function initBacheca(firestoreDb) {
  db = firestoreDb;

  document.getElementById('message-form').addEventListener('submit', inviaMessaggio);

  // Quando l'utente apre la bacheca, azzera il badge
  document.querySelector('[data-view="bacheca"]')?.addEventListener('click', () => {
    localStorage.setItem(LS_KEY, Date.now().toString());
    nascondiNotifica();
  });

  caricaMessaggi();
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
function renderMessaggi() {
  const container = document.getElementById('message-list');
  if (messaggi.length === 0) {
    container.innerHTML = '<p class="empty-state">Nessun messaggio.</p>';
    return;
  }
  container.innerHTML = messaggi.map(m => {
    const ts    = m.timestamp?.toDate?.() ?? null;
    const data  = ts ? ts.toLocaleDateString('it-IT') : '';
    const ora   = ts ? ts.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const classe = COLORI[m.operatore] ?? 'msg-default';
    return `
      <div class="message-item ${classe}">
        <div class="message-header">
          <span class="message-author">${m.operatore ?? '—'}</span>
          <span class="message-date">${data} ${ora}</span>
        </div>
        <p style="font-size:.85rem;color:var(--text-primary);line-height:1.5">${m.testo}</p>
      </div>`;
  }).join('');
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
      timestamp: serverTimestamp()
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
  const ultimaVisita = parseInt(localStorage.getItem(LS_KEY) ?? '0', 10);
  const nonLetti = messaggi.filter(m => {
    const ts = m.timestamp?.toMillis?.() ?? 0;
    return ts > ultimaVisita;
  });
  const badge = document.getElementById('bacheca-badge');
  if (!badge) return;
  if (nonLetti.length > 0) {
    badge.textContent = nonLetti.length > 9 ? '9+' : nonLetti.length;
    badge.classList.remove('hidden');
  } else {
    nascondiNotifica();
  }
}

function nascondiNotifica() {
  const badge = document.getElementById('bacheca-badge');
  badge?.classList.add('hidden');
}
