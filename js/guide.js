import { openModal, closeModal } from './nav.js';

// ================================================================
// CONTENUTI GUIDA — modifica qui per aggiornare i testi.
// Ogni sezione ha: titolo, flusso (passi operativi) e funzioni.
// ================================================================
const GUIDE = {

  magazzino: {
    titolo: 'Magazzino',
    flusso: [
      'Scegli la tab <b>Materia Prima</b> per gestire fili e cartoni, oppure <b>Prodotto Finito</b> per le rocche già lavorate.',
      '<b>Materia Prima:</b> usa + e − per aggiornare la quantità dopo un carico o un prelievo. Ogni movimento viene registrato automaticamente.',
      '<b>Prodotto Finito:</b> apri Fornitore → Tipologia → Colore per trovare il cordino. Usa + e − per aggiornare le rocche disponibili.',
      'Se arriva una nuova partita dello stesso colore, clicca <b>"aggiungi partita"</b> sotto il nome del colore — non serve creare un nuovo prodotto.',
      'Il tag <b>PRIMA</b> indica la partita più vecchia: è quella che va spedita all\'hub per prima.',
    ],
    funzioni: [
      { ic: 'fa-plus-minus',     txt: '<b>+ / −</b> — aggiornano la quantità e registrano il movimento' },
      { ic: 'fa-pen',            txt: '<b>Matita</b> — modifica i dati del prodotto (nome, soglia, ubicazione, partita…)' },
      { ic: 'fa-layer-group',    txt: '<b>Aggiungi partita</b> — crea una seconda partita dello stesso colore, con ubicazione propria' },
      { ic: 'fa-ban',            txt: '<b>Ban (archivia)</b> — sposta il prodotto nell\'archivio eliminati, recuperabile' },
      { ic: 'fa-tag',            txt: '<b>Etichetta</b> — stampa l\'etichetta per la rocca (solo Prodotto Finito)' },
      { ic: 'fa-triangle-exclamation', txt: '<b>Soglia avviso</b> — quando la quantità scende sotto questa soglia, il prodotto compare nelle proposte d\'ordine' },
      { ic: 'fa-weight-scale',   txt: '<b>kgPerCartone</b> — compilarlo sblocca il calcolo producibilità nella sezione Alert' },
    ]
  },

  alert: {
    titolo: 'Alert',
    flusso: [
      'Ogni mattina guarda la lista — è ordinata per urgenza, i rossi sono in cima.',
      'Usa i <b>chip filtro</b> in cima per vedere solo i critici 🔴, solo le attenzioni 🟠, o solo i manuali 📌.',
      'Clicca su qualsiasi riga per espandere il dettaglio: rotazione, stock, producibilità, conflitti.',
      'Per segnalare un evento futuro (tutorial, promozione) clicca <b>+ Nuovo</b>: scegli il prodotto, scrivi le note e inserisci la data dell\'evento. Il sistema decide automaticamente la priorità.',
      'La priorità degli alert si aggiorna da sola ogni volta che il magazzino cambia — non devi fare nulla.',
    ],
    funzioni: [
      { ic: 'fa-circle',              txt: '<b>🔴 Critico automatico</b> — stock a zero, oppure copertura sotto 4 settimane. Diventa rosso anche se c\'è un conflitto MP critico (rotazione 2× superiore) e lo stock è già sotto le 4 settimane' },
      { ic: 'fa-circle',              txt: '<b>🟠 Attenzione automatico</b> — copertura totale tra 4 e 8 settimane. I conflitti MP da soli non generano questo alert: appaiono come informazione nel dettaglio' },
      { ic: 'fa-thumbtack',           txt: '<b>📌 Alert manuale</b> — evento segnalato dall\'operatore (tutorial, promozione…). Il livello è calcolato dal sistema in base allo stock e alla data evento' },
      { ic: 'fa-chart-line',          txt: '<b>Rotazione</b> — rocche uscite in media per settimana negli ultimi 60 giorni' },
      { ic: 'fa-shield-halved',       txt: '<b>Copertura</b> — settimane garantite da stock attuale + producibilità dalla materia prima' },
      { ic: 'fa-triangle-exclamation',txt: '<b>Conflitto MP</b> — la stessa materia prima serve a un prodotto con rotazione più alta; è solo informativo a meno che non sia critico (2×) con stock già basso' },
      { ic: 'fa-pen',                 txt: '<b>Modifica alert manuale</b> — aggiorna note o data evento; il sistema rivaluta subito la priorità' },
      { ic: 'fa-ban',                 txt: '<b>Archivia come eliminato</b> — disponibile nel dettaglio di ogni alert automatico; sposta il prodotto finito nell\'archivio eliminati (non appare più in magazzino né negli alert)' },
      { ic: 'fa-bell',                txt: '<b>Badge nav</b> — mostra solo il numero di alert 🔴 critici; si azzera quando non ce ne sono' },
    ]
  },

  ordini: {
    titolo: 'Ordini Fornitori',
    flusso: [
      'Clicca <b>Aggiorna proposte</b> per vedere i prodotti sotto soglia, già raggruppati per fornitore.',
      'Modifica le quantità se necessario e deseleziona le righe che non vuoi ordinare.',
      'Imposta la <b>data di spedizione</b> (default o riga per riga) e clicca <b>Crea Ordine</b>.',
      'Copia il testo dell\'email e mandalo al fornitore. L\'ordine è salvato nello <b>Storico</b>.',
      'Quando la merce arriva: vai in Storico → clicca <b>Arrivata</b> → inserisci i BOX o i KG ricevuti. Il magazzino si aggiorna automaticamente.',
    ],
    funzioni: [
      { ic: 'fa-rotate',         txt: '<b>Aggiorna proposte</b> — ricalcola i prodotti da ordinare in base alle soglie attuali' },
      { ic: 'fa-paper-plane',    txt: '<b>Crea Ordine</b> — salva l\'ordine e aggiorna la "quantità in ordine" nel magazzino' },
      { ic: 'fa-copy',           txt: '<b>Copia testo</b> — copia il testo da incollare nell\'email al fornitore' },
      { ic: 'fa-truck-ramp-box', txt: '<b>Arrivata</b> — battesimo merce: aggiorna la disponibilità e chiude la voce dell\'ordine' },
      { ic: 'fa-folder',         txt: '<b>Cartella Output</b> — collegala per salvare automaticamente i testi degli ordini come file .txt' },
      { ic: 'fa-trash',          txt: '<b>Cancella ordine</b> — ripristina automaticamente la quantità ordinata nel magazzino' },
    ]
  },

  produzione: {
    titolo: 'Produzione',
    flusso: [
      'Ricevi l\'Excel dall\'hub e clicca <b>Importa Ordine</b>. L\'app abbina ogni riga al prodotto finito in magazzino tramite SKU.',
      'La lista è ordinata per <b>ubicazione</b>: segui l\'ordine dall\'alto per fare il percorso più efficiente in magazzino.',
      '<b>Da PC:</b> spunta i prodotti uno a uno cliccando il segno di spunta. La quantità viene scalata dal magazzino automaticamente.',
      '<b>Da mobile:</b> clicca <b>Picking Mobile</b> per aprire lo scanner. Ogni scansione del barcode sul cartone preleva 30 pz (modificabile). L\'app avanza automaticamente all\'articolo successivo.',
      'I prodotti in rosso (DA PRODURRE) non sono disponibili: sono raggruppati in fondo alla lista.',
      'Stampa la <b>Lista di Lavoro</b> prima di iniziare. Stampa il <b>Documento di Consegna</b> quando hai finito — da mobile usa la <b>Distinta di Consegna</b> generata alla fine del picking.',
    ],
    funzioni: [
      { ic: 'fa-file-import',    txt: '<b>Importa Ordine</b> — carica l\'Excel dell\'hub (formato: num, sku, qty_ord, name…)' },
      { ic: 'fa-barcode',        txt: '<b>Picking Mobile</b> — apre lo scanner da smartphone: mostra articolo per articolo con nome, colore, SKU e ubicazione' },
      { ic: 'fa-print',          txt: '<b>Lista di Lavoro</b> — foglio picking con ubicazione e partita per ogni prodotto' },
      { ic: 'fa-file-invoice',   txt: '<b>Documento di Consegna</b> — accompagna la merce all\'hub; evidenzia NUOVA PARTITA, ELIMINATO e righe parziali' },
      { ic: 'fa-check',          txt: '<b>Spunta (da PC)</b> — segna il prodotto come consegnato e scala le rocche dal magazzino' },
      { ic: 'fa-pen-to-square',  txt: '<b>Quantità modificabile</b> — clicca il numero richiesto per cambiarlo prima della spunta' },
      { ic: 'fa-rotate-left',    txt: '<b>Annulla ultima (mobile)</b> — inverte l\'ultimo prelievo scansionato e ricarica le rocche a magazzino' },
      { ic: 'fa-pause',          txt: '<b>Sospendi (mobile)</b> — salva il progresso e torna all\'ordine; puoi riprendere in seguito' },
      { ic: 'fa-trash',          txt: '<b>Elimina ordine</b> — se ci sono prodotti già spuntati, le rocche vengono restituite al magazzino' },
      { ic: 'fa-triangle-exclamation', txt: '<b>⚠️ Distinta</b> — appare sulle righe dove la quantità consegnata non è multipla di 30: da verificare nel WMS dell\'hub' },
    ]
  },

  bacheca: {
    titolo: 'Bacheca',
    flusso: [
      'Leggi i messaggi dall\'alto: i più recenti sono in cima.',
      'Seleziona il tuo nome dal menu a tendina, scrivi il messaggio e premi Invia.',
      'Il numero rosso sulla nav indica messaggi arrivati da quando hai visitato l\'ultima volta la bacheca.',
    ],
    funzioni: [
      { ic: 'fa-bell',           txt: '<b>Badge notifica</b> — sparisce non appena apri la bacheca' },
      { ic: 'fa-clock-rotate-left', txt: '<b>Storico</b> — vengono mostrati gli ultimi 60 messaggi' },
    ]
  },

  catalogo: {
    titolo: 'Catalogo',
    flusso: [
      'Cerca un prodotto per nome, SKU o barcode.',
      'Apri la scheda per verificare la <b>ricetta</b> (percentuali materia prima) — viene usata dal sistema per calcolare la producibilità.',
      'Usa <b>Descrizioni Tipologie</b> per gestire i testi che appaiono sull\'etichetta di ogni tipo di cordino.',
    ],
    funzioni: [
      { ic: 'fa-percent',        txt: '<b>Ricetta %</b> — composizione materia prima, usata per il calcolo producibilità negli Alert' },
      { ic: 'fa-barcode',        txt: '<b>SKU / Barcode</b> — codice univoco del prodotto, stampato sull\'etichetta' },
      { ic: 'fa-file-excel',     txt: '<b>Import Excel</b> — carica i dati del catalogo da file' },
      { ic: 'fa-tag',            txt: '<b>Descrizioni Tipologie</b> — testi che appaiono sull\'etichetta (una per tipo cordino)' },
    ]
  },

};

// ─── Init ────────────────────────────────────────────────────────
export function initGuide() {
  document.querySelectorAll('[data-guida]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      apriGuida(btn.dataset.guida);
    });
  });
}

function apriGuida(id) {
  const g = GUIDE[id];
  if (!g) return;

  document.getElementById('guida-titolo').textContent = g.titolo;

  document.getElementById('guida-flusso').innerHTML =
    g.flusso.map((p, i) =>
      `<li><span class="guida-step-num">${i + 1}</span><span>${p}</span></li>`
    ).join('');

  document.getElementById('guida-funzioni').innerHTML =
    g.funzioni.map(f =>
      `<li><i class="fas ${f.ic} guida-fn-ic"></i><span>${f.txt}</span></li>`
    ).join('');

  openModal('modal-guida');
}
