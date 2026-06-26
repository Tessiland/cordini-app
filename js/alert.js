import {
  collection, query, orderBy, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProdottiFiniti, onProdottiFinatiChange } from './prodotto-finito.js';
import { getProdotti, onProdottiChange }             from './magazzino.js';
import { openModal, closeModal } from './nav.js';

const GIORNI         = 60;
const SOGLIA_URGENTE = 2;   // settimane — corsie esaurimento + MP
const SOGLIA_MONITOR = 8;   // settimane — cassetto "in osservazione"
const PESO_ROCCA_KG  = 0.200;

let db;
let alertManuali   = [];
let movimentiCache = [];
let filtroAttivo   = 'tutti';

export function initAlert(firestoreDb) {
  db = firestoreDb;
  caricaMovimenti();
  caricaAlertManuali();
  onProdottiChange(renderDashboard);
  onProdottiFinatiChange(renderDashboard);

  document.getElementById('add-alert-btn').addEventListener('click', apriNuovoAlert);
  document.getElementById('form-alert').addEventListener('submit', salvaAlert);

  document.querySelector('.alert-chip-bar')?.addEventListener('click', e => {
    const chip = e.target.closest('.alert-chip');
    if (!chip) return;
    document.querySelectorAll('.alert-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filtroAttivo = chip.dataset.filtro;
    renderDashboard();
  });
}

// ─── Caricamento ─────────────────────────────────────────────────
function caricaMovimenti() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GIORNI);
  const q = query(
    collection(db, "movimenti_pf"),
    where("timestamp", ">=", Timestamp.fromDate(cutoff))
  );
  onSnapshot(q, snap => {
    movimentiCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
  }, err => console.error("Errore movimenti alert:", err));
}

function caricaAlertManuali() {
  const q = query(collection(db, "alert_manuali"), orderBy("createdAt", "desc"));
  onSnapshot(q, snap => {
    alertManuali = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
  }, err => console.error("Errore alert manuali:", err));
}

// ─── Calcoli ─────────────────────────────────────────────────────
function calcolaRotazioni() {
  const totali = {};
  movimentiCache.filter(m => m.tipo === 'prelievo').forEach(m => {
    if (!m.idProdotto) return;
    totali[m.idProdotto] = (totali[m.idProdotto] ?? 0) + (m.quantita ?? 0);
  });
  const rotazioni = {};
  Object.keys(totali).forEach(id => { rotazioni[id] = totali[id] / (GIORNI / 7); });
  return rotazioni;
}

function calcolaProducibilita(pf, prodottiMP) {
  const componenti = pf.coloriComponenti ?? [];
  if (componenti.length === 0) return null;
  let minKgPF = Infinity;
  for (const comp of componenti) {
    const mp = prodottiMP.find(p => p.id === comp.idProdotto);
    if (!mp?.kgPerCartone) return null;
    const kgD = (mp.quantitaDisponibile ?? 0) * mp.kgPerCartone;
    const pct  = (comp.percentuale ?? 0) / 100;
    if (pct <= 0) return null;
    minKgPF = Math.min(minKgPF, kgD / pct);
  }
  return isFinite(minKgPF) ? Math.floor(minKgPF / PESO_ROCCA_KG) : 0;
}

// ─── Generazione alert prodotto finito ───────────────────────────
function generaAlertPF(prodottiFiniti, prodottiMP, rotazioni) {
  const fermi        = [];
  const esaurimento  = [];
  const osservazione = [];

  prodottiFiniti.forEach(pf => {
    if (pf.eliminato) return;

    const stock         = pf.quantitaRocche ?? 0;
    const rotazione     = rotazioni[pf.id] ?? 0;
    const producibilita = calcolaProducibilita(pf, prodottiMP);
    const puoProdurre   = producibilita !== null && producibilita > 0;

    if (stock === 0) {
      fermi.push({
        corsia: 'fermi', pf, stock, rotazione, producibilita, puoProdurre,
        settimaneStock: 0,
        settimaneTotali: puoProdurre ? producibilita / Math.max(rotazione, 0.01) : 0
      });
      return;
    }

    if (rotazione === 0) return;

    const settimaneStock  = stock / rotazione;
    const settimaneProd   = producibilita !== null ? producibilita / rotazione : null;
    const settimaneTotali = settimaneStock + (settimaneProd ?? 0);

    if (settimaneTotali < SOGLIA_URGENTE) {
      esaurimento.push({
        corsia: 'esaurimento', pf, stock, rotazione, producibilita, puoProdurre,
        settimaneStock, settimaneProd, settimaneTotali
      });
    } else if (settimaneTotali < SOGLIA_MONITOR) {
      osservazione.push({
        corsia: 'osservazione', pf, stock, rotazione, producibilita, puoProdurre,
        settimaneStock, settimaneProd, settimaneTotali
      });
    }
  });

  fermi.sort((a, b) => {
    if (a.puoProdurre !== b.puoProdurre) return a.puoProdurre ? 1 : -1;
    return (a.pf.nome ?? '').localeCompare(b.pf.nome ?? '', 'it');
  });
  esaurimento.sort((a, b) => a.settimaneTotali - b.settimaneTotali);
  osservazione.sort((a, b) => a.settimaneTotali - b.settimaneTotali);

  return { fermi, esaurimento, osservazione };
}

// ─── Generazione alert materia prima ─────────────────────────────
function generaAlertMP(prodottiFiniti, prodottiMP, rotazioni) {
  const mpConsumi = {};

  prodottiFiniti.forEach(pf => {
    if (pf.eliminato) return;
    const rot = rotazioni[pf.id] ?? 0;
    if (rot === 0) return;

    (pf.coloriComponenti ?? []).forEach(comp => {
      const mp = prodottiMP.find(p => p.id === comp.idProdotto);
      if (!mp?.kgPerCartone) return;

      const pct = (comp.percentuale ?? 0) / 100;
      if (pct <= 0) return;

      const consumoKgSett = rot * PESO_ROCCA_KG * pct;

      if (!mpConsumi[mp.id]) {
        mpConsumi[mp.id] = { mp, consumoKgSett: 0, pfCoinvolti: [] };
      }
      mpConsumi[mp.id].consumoKgSett += consumoKgSett;
      mpConsumi[mp.id].pfCoinvolti.push({
        nome: `${pf.nome ?? ''} — ${pf.colore ?? ''}`.trim(),
        consumoKgSett
      });
    });
  });

  const alerts = [];
  Object.values(mpConsumi).forEach(({ mp, consumoKgSett, pfCoinvolti }) => {
    if (consumoKgSett <= 0) return;
    const kgDisponibili = (mp.quantitaDisponibile ?? 0) * (mp.kgPerCartone ?? 0);
    const settCopertura = kgDisponibili / consumoKgSett;

    if (settCopertura < SOGLIA_URGENTE) {
      alerts.push({
        corsia: 'mp', mp, kgDisponibili, consumoKgSett, settCopertura,
        cartoniDisponibili: mp.quantitaDisponibile ?? 0,
        pfCoinvolti: pfCoinvolti.sort((a, b) => b.consumoKgSett - a.consumoKgSett)
      });
    }
  });

  return alerts.sort((a, b) => a.settCopertura - b.settCopertura);
}

// ─── Valutazione alert manuali ───────────────────────────────────
function valutaAlertManuale(a, rotazioni, prodottiFiniti, prodottiMP) {
  const pf = prodottiFiniti.find(p => p.id === a.idProdotto);
  if (!pf) return { livello: 'arancio', settimaneEvento: null, copertura: null };

  const stock         = pf.quantitaRocche ?? 0;
  const rotazione     = rotazioni[pf.id] ?? 0;
  const producibilita = calcolaProducibilita(pf, prodottiMP);

  let settimaneEvento = null;
  if (a.dataEvento) {
    const ms = new Date(a.dataEvento + 'T00:00:00') - new Date();
    settimaneEvento = Math.max(0, ms / (1000 * 60 * 60 * 24 * 7));
  }

  let copertura = null;
  if (stock === 0) {
    copertura = 0;
  } else if (rotazione > 0) {
    const settimaneStock = stock / rotazione;
    const settimaneProd  = producibilita !== null ? producibilita / rotazione : 0;
    copertura = settimaneStock + settimaneProd;
  }

  let livello;
  if (stock === 0) {
    livello = 'rosso';
  } else if (settimaneEvento !== null && copertura !== null) {
    const margine = copertura - settimaneEvento;
    if (margine < 0)                   livello = 'rosso';
    else if (margine < SOGLIA_URGENTE) livello = 'arancio';
    else                               livello = 'verde';
  } else if (copertura !== null) {
    if (copertura < SOGLIA_URGENTE)      livello = 'rosso';
    else if (copertura < SOGLIA_MONITOR) livello = 'arancio';
    else                                 livello = 'verde';
  } else {
    livello = 'arancio';
  }

  return { livello, settimaneEvento, copertura };
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(1) : '—'; }

// ─── Render dashboard ─────────────────────────────────────────────
function renderDashboard() {
  const pf  = getProdottiFiniti();
  const mp  = getProdotti().filter(p => !p.congelato);
  const rot = calcolaRotazioni();

  const { fermi, esaurimento, osservazione } = generaAlertPF(pf, mp, rot);
  const materiaPrima = generaAlertMP(pf, mp, rot);

  const manualiCalcolati = alertManuali.map(a => {
    const valutazione = valutaAlertManuale(a, rot, pf, mp);
    return { tipo: 'manuale', ...a, ...valutazione };
  }).filter(a => a.livello !== 'verde');

  const el = id => document.getElementById(id);
  if (el('alert-count-fermi'))       el('alert-count-fermi').textContent       = fermi.length;
  if (el('alert-count-esaurimento')) el('alert-count-esaurimento').textContent = esaurimento.length;
  if (el('alert-count-mp'))          el('alert-count-mp').textContent          = materiaPrima.length;
  if (el('alert-count-manuale'))     el('alert-count-manuale').textContent     = manualiCalcolati.length;

  aggiornaBadge(fermi.length);

  const inbox = document.getElementById('alert-inbox');
  if (!inbox) return;
  inbox.innerHTML = '';

  let haContent = false;

  if (filtroAttivo === 'tutti' || filtroAttivo === 'fermi') {
    if (fermi.length > 0) {
      inbox.appendChild(creaCorsia('Produzione ferma', 'rosso', fermi, creaRigaFermi));
      haContent = true;
    }
  }
  if (filtroAttivo === 'tutti' || filtroAttivo === 'esaurimento') {
    if (esaurimento.length > 0) {
      inbox.appendChild(creaCorsia('Scorte in esaurimento', 'arancio', esaurimento, creaRigaEsaurimento));
      haContent = true;
    }
  }
  if (filtroAttivo === 'tutti' || filtroAttivo === 'mp') {
    if (materiaPrima.length > 0) {
      inbox.appendChild(creaCorsia('Materia prima', 'mp', materiaPrima, creaRigaMP));
      haContent = true;
    }
  }
  if (filtroAttivo === 'tutti' || filtroAttivo === 'manuale') {
    if (manualiCalcolati.length > 0) {
      inbox.appendChild(creaCorsia('Alert manuali', 'manuale', manualiCalcolati, creaRigaManuale));
      haContent = true;
    }
  }

  if ((filtroAttivo === 'tutti' || filtroAttivo === 'esaurimento') && osservazione.length > 0) {
    inbox.appendChild(creaCassetto(osservazione));
    haContent = true;
  }

  if (!haContent) {
    inbox.innerHTML = '<p class="empty-state">Nessun alert attivo.</p>';
  }
}

// ─── Corsia ───────────────────────────────────────────────────────
function creaCorsia(titolo, tipo, items, creaRiga) {
  const section = document.createElement('div');
  section.className = 'alert-corsia';

  const header = document.createElement('div');
  header.className = `alert-corsia-header ${tipo}`;
  header.innerHTML = `
    <span class="alert-corsia-titolo">${titolo}</span>
    <span class="alert-corsia-count">${items.length}</span>
  `;
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'alert-rows';
  items.forEach(item => list.appendChild(creaRiga(item)));
  section.appendChild(list);

  return section;
}

// ─── Cassetto "In osservazione" ──────────────────────────────────
function creaCassetto(items) {
  const wrap = document.createElement('div');
  wrap.className = 'alert-cassetto';

  const header = document.createElement('div');
  header.className = 'alert-cassetto-header';
  header.innerHTML = `
    <i class="fas fa-chevron-right alert-cassetto-chevron"></i>
    <span>In osservazione</span>
    <span class="alert-cassetto-count">${items.length}</span>
  `;
  wrap.appendChild(header);

  const body = document.createElement('div');
  body.className = 'alert-cassetto-body hidden';
  const list = document.createElement('div');
  list.className = 'alert-rows';
  items.forEach(a => list.appendChild(creaRigaEsaurimento(a)));
  body.appendChild(list);
  wrap.appendChild(body);

  header.addEventListener('click', () => {
    const open = wrap.classList.toggle('open');
    body.classList.toggle('hidden', !open);
    header.querySelector('.alert-cassetto-chevron').style.transform = open ? 'rotate(90deg)' : '';
  });

  return wrap;
}

// ─── Riga "Produzione ferma" ─────────────────────────────────────
function creaRigaFermi(a) {
  const { pf, producibilita, puoProdurre, rotazione } = a;

  let tagHtml;
  if (puoProdurre) {
    tagHtml = `<span class="alert-row-tag tag-producibile"><i class="fas fa-industry"></i> Producibile · ${producibilita} rocche</span>`;
  } else if (producibilita === 0) {
    tagHtml = `<span class="alert-row-tag tag-ordina"><i class="fas fa-boxes-stacked"></i> MP esaurita · ordina al fornitore</span>`;
  } else {
    tagHtml = `<span class="alert-row-tag tag-nd">${pf.fornitore ?? ''}</span>`;
  }

  const row = document.createElement('div');
  row.className = 'alert-row rosso';
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-bullet rosso"></span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${pf.nome ?? '—'} — ${pf.colore ?? '—'}</span>
        ${tagHtml}
      </div>
      <span class="alert-row-sett sett-rosso">Stock 0</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Fornitore</span>
          <span class="alert-detail-val">${pf.fornitore ?? '—'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Rotazione</span>
          <span class="alert-detail-val">${rotazione > 0 ? `${fmt(rotazione)} rocche/sett · ultimi ${GIORNI}gg` : 'Nessun prelievo recente'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Producibile da MP</span>
          <span class="alert-detail-val">${producibilita !== null ? `${producibilita} rocche` : 'N/D — dati incompleti'}</span>
        </div>
      </div>
      <div style="margin-top:.5rem">
        <button class="btn-ghost btn-sm btn-ghost-danger archivia-pf-btn" data-id="${pf.id}" data-nome="${pf.nome} — ${pf.colore}">
          <i class="fas fa-ban"></i> Archivia come eliminato
        </button>
      </div>
    </div>
  `;

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));
  row.querySelector('.archivia-pf-btn').addEventListener('click', archiviaHandler);

  return row;
}

// ─── Riga "Scorte in esaurimento" / "In osservazione" ────────────
function creaRigaEsaurimento(a) {
  const { pf, stock, rotazione, producibilita, puoProdurre,
    settimaneStock, settimaneProd, settimaneTotali, corsia } = a;

  const isMonitor  = corsia === 'osservazione';
  const colorClass = isMonitor ? 'monitor' : 'arancio';
  const settCol    = isMonitor ? 'sett-monitor' : 'sett-arancio';

  const mpInfo = puoProdurre
    ? 'MP disponibile'
    : producibilita === 0 ? 'MP esaurita' : '';

  const row = document.createElement('div');
  row.className = `alert-row ${colorClass}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-bullet ${colorClass}"></span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${pf.nome ?? '—'} — ${pf.colore ?? '—'}</span>
        <span class="alert-row-colore">${pf.fornitore ?? ''}</span>
      </div>
      <span class="alert-row-sett ${settCol}">${fmt(settimaneTotali)} sett.</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-row-spiegazione">
        Al ritmo attuale (~${Math.round(rotazione)}/sett), le ${stock} rocche finiscono tra ~${fmt(settimaneStock)} settimane${mpInfo ? ` · ${mpInfo}` : ''}
      </div>
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Stock</span>
          <span class="alert-detail-val">${stock} rocche (${fmt(settimaneStock)} sett.)</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Rotazione</span>
          <span class="alert-detail-val">${fmt(rotazione)} rocche/sett</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Producibile</span>
          <span class="alert-detail-val">${producibilita !== null
            ? `${producibilita} rocche${settimaneProd !== null ? ` (${fmt(settimaneProd)} sett.)` : ''}`
            : 'N/D'}</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Copertura totale</span>
          <span class="alert-detail-val" style="font-weight:700">${fmt(settimaneTotali)} settimane</span>
        </div>
      </div>
      <div style="margin-top:.5rem">
        <button class="btn-ghost btn-sm btn-ghost-danger archivia-pf-btn" data-id="${pf.id}" data-nome="${pf.nome} — ${pf.colore}">
          <i class="fas fa-ban"></i> Archivia come eliminato
        </button>
      </div>
    </div>
  `;

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));
  row.querySelector('.archivia-pf-btn').addEventListener('click', archiviaHandler);

  return row;
}

// ─── Riga "Materia prima" ────────────────────────────────────────
function creaRigaMP(a) {
  const { mp, kgDisponibili, consumoKgSett, settCopertura,
    pfCoinvolti, cartoniDisponibili } = a;

  const nPF = pfCoinvolti.length;
  const settTesto = cartoniDisponibili === 0
    ? 'Esaurita' : `${fmt(settCopertura)} sett.`;

  const row = document.createElement('div');
  row.className = 'alert-row mp';
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-bullet mp"></span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${mp.nome ?? '—'}</span>
        <span class="alert-row-colore">Blocca ${nPF} prodott${nPF === 1 ? 'o' : 'i'} finit${nPF === 1 ? 'o' : 'i'}</span>
      </div>
      <span class="alert-row-sett sett-mp">${settTesto}</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Disponibilità</span>
          <span class="alert-detail-val">${cartoniDisponibili} carton${cartoniDisponibili === 1 ? 'e' : 'i'} (${fmt(kgDisponibili)} kg)</span>
        </div>
        <div class="alert-detail-item">
          <span class="alert-detail-label">Consumo stimato</span>
          <span class="alert-detail-val">${fmt(consumoKgSett)} kg/sett</span>
        </div>
        <div class="alert-detail-item" style="grid-column:1/-1">
          <span class="alert-detail-label">Prodotti coinvolti</span>
          <span class="alert-detail-val">${pfCoinvolti.map(p => p.nome).join(', ')}</span>
        </div>
      </div>
    </div>
  `;

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));

  return row;
}

// ─── Riga alert manuale ──────────────────────────────────────────
function creaRigaManuale(a) {
  const { livello, settimaneEvento, copertura } = a;
  const etichettaLivello = livello === 'rosso' ? '🔴' : '🟠';
  const data = a.createdAt?.toDate().toLocaleDateString('it-IT') ?? '—';
  const eventoFmt = a.dataEvento
    ? new Date(a.dataEvento + 'T00:00:00').toLocaleDateString('it-IT') : null;

  let sottotitolo = '';
  if (settimaneEvento !== null) {
    sottotitolo = settimaneEvento < 1
      ? 'Evento imminente'
      : `Evento tra ${Math.round(settimaneEvento)} settimane`;
  }

  const row = document.createElement('div');
  row.className = `alert-row manuale ${livello}`;
  row.innerHTML = `
    <div class="alert-row-summary">
      <span class="alert-row-pin">📌</span>
      <div class="alert-row-nome">
        <span class="alert-row-prodotto">${a.nomeProdotto ?? '—'}</span>
        <span class="alert-row-colore">${sottotitolo || a.note || ''}</span>
      </div>
      <span class="alert-row-sett" style="font-size:.7rem;color:var(--text-muted);font-weight:400">${etichettaLivello}</span>
      <i class="fas fa-chevron-right alert-row-chevron"></i>
    </div>
    <div class="alert-row-detail hidden">
      <div class="alert-detail-grid">
        <div class="alert-detail-item">
          <span class="alert-detail-label">Note</span>
          <span class="alert-detail-val">${a.note || '—'}</span>
        </div>
        ${eventoFmt ? `
        <div class="alert-detail-item">
          <span class="alert-detail-label">Data evento</span>
          <span class="alert-detail-val">${eventoFmt}${settimaneEvento !== null ? ` (tra ${Math.round(settimaneEvento)} sett.)` : ''}</span>
        </div>` : ''}
        ${copertura !== null ? `
        <div class="alert-detail-item">
          <span class="alert-detail-label">Copertura attuale</span>
          <span class="alert-detail-val">${copertura === 0 ? 'Stock esaurito' : `${fmt(copertura)} settimane`}</span>
        </div>` : ''}
        <div class="alert-detail-item">
          <span class="alert-detail-label">Inserito il</span>
          <span class="alert-detail-val">${data}</span>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.5rem">
        <button class="btn-ghost btn-sm modifica-alert-btn" data-id="${a.id}">
          <i class="fas fa-pen"></i> Modifica
        </button>
        <button class="btn-ghost btn-sm btn-ghost-danger elimina-alert-btn" data-id="${a.id}">
          <i class="fas fa-trash"></i> Elimina
        </button>
      </div>
    </div>
  `;

  row.querySelector('.alert-row-summary').addEventListener('click', () => toggleRiga(row));
  row.querySelector('.modifica-alert-btn').addEventListener('click', e => {
    e.stopPropagation();
    apriModificaAlert(a);
  });
  row.querySelector('.elimina-alert-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`Eliminare l'alert su "${a.nomeProdotto}"?`)) {
      deleteDoc(doc(db, "alert_manuali", a.id)).catch(console.error);
    }
  });

  return row;
}

// ─── Helpers ─────────────────────────────────────────────────────
function toggleRiga(row) {
  const detail  = row.querySelector('.alert-row-detail');
  const chevron = row.querySelector('.alert-row-chevron');
  const open    = row.classList.toggle('open');
  detail.classList.toggle('hidden', !open);
  chevron.style.transform = open ? 'rotate(90deg)' : '';
}

function archiviaHandler(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  if (!confirm(`Archiviare "${btn.dataset.nome}" come eliminato?\nNon sarà più visibile nel magazzino né negli alert.`)) return;
  updateDoc(doc(db, "prodotti_finiti", btn.dataset.id), { eliminato: true })
    .catch(err => alert(`Errore: ${err.message}`));
}

// ─── Badge nav ────────────────────────────────────────────────────
function aggiornaBadge(nFermi) {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  badge.textContent = nFermi;
  badge.classList.toggle('hidden', nFermi === 0);
}

// ─── Modal alert ─────────────────────────────────────────────────
function apriNuovoAlert() {
  const form = document.getElementById('form-alert');
  form.reset();
  form.dataset.mode = 'add';
  document.getElementById('a-id').value = '';
  document.getElementById('a-submit-btn').textContent = 'Crea Alert';
  document.querySelector('#modal-alert .modal-title').textContent = 'Nuovo Alert';
  popolaSelectProdotti();
  openModal('modal-alert');
}

function apriModificaAlert(a) {
  const form = document.getElementById('form-alert');
  form.dataset.mode = 'edit';
  document.getElementById('a-id').value         = a.id;
  document.getElementById('a-note').value        = a.note ?? '';
  document.getElementById('a-data-evento').value = a.dataEvento ?? '';
  document.getElementById('a-submit-btn').textContent = 'Salva Modifiche';
  document.querySelector('#modal-alert .modal-title').textContent = 'Modifica Alert';
  popolaSelectProdotti(a.idProdotto);
  openModal('modal-alert');
}

function popolaSelectProdotti(idSelezionato) {
  const sel  = document.getElementById('a-prodotto');
  const list = getProdottiFiniti().filter(p => !p.eliminato);
  list.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'it', { sensitivity: 'base' })
    || (a.colore ?? '').localeCompare(b.colore ?? '', 'it', { sensitivity: 'base' }));
  sel.innerHTML = list.map(p =>
    `<option value="${p.id}" data-nome="${(p.nome ?? '')} — ${(p.colore ?? '')}"
      ${p.id === idSelezionato ? 'selected' : ''}>${p.nome ?? '—'} — ${p.colore ?? '—'}</option>`
  ).join('');
}

async function salvaAlert(e) {
  e.preventDefault();
  const form   = document.getElementById('form-alert');
  const sel    = document.getElementById('a-prodotto');
  const opt    = sel.selectedOptions[0];
  const note   = document.getElementById('a-note').value.trim();
  const dataEv = document.getElementById('a-data-evento').value || null;
  const btn    = document.getElementById('a-submit-btn');
  const id     = document.getElementById('a-id').value;
  const isEdit = form.dataset.mode === 'edit';

  btn.disabled = true;
  try {
    const dati = {
      idProdotto:   sel.value,
      nomeProdotto: opt?.dataset.nome ?? sel.value,
      note,
      dataEvento:   dataEv
    };
    if (isEdit && id) {
      await updateDoc(doc(db, "alert_manuali", id), dati);
    } else {
      await addDoc(collection(db, "alert_manuali"), { ...dati, createdAt: serverTimestamp() });
    }
    closeModal('modal-alert');
    form.reset();
  } catch (err) {
    console.error("Errore salvataggio alert:", err);
    alert(`Errore: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}
