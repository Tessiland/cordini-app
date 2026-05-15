import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  writeBatch, doc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db;
let fornitori = [];

export async function initFornitori(firestoreDb) {
  db = firestoreDb;
  await carica();

  document.getElementById('unifica-fornitori-btn')?.addEventListener('click', eseguiUnificazione);
}

async function carica() {
  const snap = await getDocs(collection(db, "fornitori"));
  fornitori = snap.docs.map(d => ({ id: d.id, nome: d.data().nome }));
  fornitori.sort((a, b) => a.nome.localeCompare(b.nome));
  aggiornaSelect();
}

function aggiornaSelect() {
  const opzioniTutti = `<option value="tutti">Tutti</option>` +
    fornitori.map(f => `<option value="${f.nome}">${f.nome}</option>`).join('');
  const opzioniForm = fornitori.map(f =>
    `<option value="${f.nome}">${f.nome}</option>`
  ).join('');

  document.querySelectorAll('#filter-fornitore').forEach(el => {
    el.innerHTML = opzioniTutti;
  });
  document.querySelectorAll('#p-fornitore').forEach(el => {
    el.innerHTML = opzioniForm;
  });
  document.querySelectorAll('#pf-fornitore').forEach(el => {
    el.innerHTML = `<option value="">— Seleziona fornitore —</option>` + opzioniForm;
  });
}

export function getFornitori() {
  return fornitori;
}

// ─── Normalizzazione nome fornitore ─────────────────────────────
export function normalizzaFornitore(nome) {
  if (!nome) return '';
  return nome
    .trim()
    .toLowerCase()
    .replace(/[,\s]+(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?)$/i, '')
    .replace(/[,\s]+ventures\s+lifestyle\s+italy\s+spa$/i, '')
    .replace(/[,\s]+ventures.+$/i, '')
    .trim();
}

function nomeCanonicoFornitore(nome) {
  const radice = normalizzaFornitore(nome);
  return radice.charAt(0).toUpperCase() + radice.slice(1).toLowerCase();
}

// ─── Unificazione fornitori duplicati ───────────────────────────
async function eseguiUnificazione() {
  const btn = document.getElementById('unifica-fornitori-btn');
  btn.disabled = true;
  btn.textContent = 'Analisi in corso…';

  try {
    const fornSnap = await getDocs(collection(db, "fornitori"));
    const allForn  = fornSnap.docs.map(d => ({ id: d.id, nome: d.data().nome }));

    // Raggruppa per nome canonico
    const gruppi = {};
    allForn.forEach(f => {
      const can = nomeCanonicoFornitore(f.nome);
      if (!gruppi[can]) gruppi[can] = [];
      gruppi[can].push(f);
    });

    const daUnificare = Object.entries(gruppi).filter(([, g]) => g.length > 1);

    if (daUnificare.length === 0) {
      alert('Nessun fornitore duplicato trovato. Il database è già pulito.');
      return;
    }

    const preview = daUnificare.map(([can, grp]) =>
      `• ${grp.map(f => `"${f.nome}"`).join(' + ')}  →  "${can}"`
    ).join('\n');

    if (!confirm(`Trovati ${daUnificare.length} grupp${daUnificare.length === 1 ? 'o' : 'i'} da unificare:\n\n${preview}\n\nProcedo?`)) return;

    btn.textContent = 'Migrazione in corso…';

    // Leggi tutti i prodotti e prodotti finiti
    const [prodSnap, pfSnap] = await Promise.all([
      getDocs(collection(db, "prodotti")),
      getDocs(collection(db, "prodotti_finiti"))
    ]);

    // Mappa oldNome → nomeCanonicoFornitore
    const remap = {};
    daUnificare.forEach(([can, grp]) => {
      grp.forEach(f => { remap[f.nome] = can; });
    });

    const batch = writeBatch(db);

    // Aggiorna prodotti materia prima
    prodSnap.docs.forEach(d => {
      const idF = d.data().idFornitore;
      if (idF && remap[idF]) {
        batch.update(doc(db, "prodotti", d.id), { idFornitore: remap[idF] });
      }
    });

    // Aggiorna prodotti finiti (fornitore + coloriComponenti)
    pfSnap.docs.forEach(d => {
      const data    = d.data();
      const updates = {};

      if (data.fornitore && remap[data.fornitore]) {
        updates.fornitore = remap[data.fornitore];
      }

      if (data.coloriComponenti?.length) {
        const nuovi   = data.coloriComponenti.map(c =>
          (c.idFornitore && remap[c.idFornitore])
            ? { ...c, idFornitore: remap[c.idFornitore] }
            : c
        );
        const changed = nuovi.some((c, i) => c.idFornitore !== data.coloriComponenti[i].idFornitore);
        if (changed) updates.coloriComponenti = nuovi;
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc(db, "prodotti_finiti", d.id), updates);
      }
    });

    // Aggiorna/elimina documenti fornitori
    daUnificare.forEach(([can, grp]) => {
      const haCanon = grp.find(f => f.nome === can);
      if (haCanon) {
        grp.filter(f => f.nome !== can).forEach(f => {
          batch.delete(doc(db, "fornitori", f.id));
        });
      } else {
        const primo = grp[0];
        batch.update(doc(db, "fornitori", primo.id), { nome: can });
        grp.slice(1).forEach(f => {
          batch.delete(doc(db, "fornitori", f.id));
        });
      }
    });

    await batch.commit();
    await carica();

    alert(`✓ Migrazione completata!\n${daUnificare.length} grupp${daUnificare.length === 1 ? 'o unificato' : 'i unificati'}.`);

  } catch (err) {
    console.error("Errore unificazione fornitori:", err);
    alert(`Errore durante la migrazione: ${err.message}`);
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Unifica Fornitori';
  }
}

export async function aggiungiFornitoreSeDiverso(nome) {
  const nomeFormattato = nome.trim();
  if (!nomeFormattato) return;
  const q = query(collection(db, "fornitori"), where("nome", "==", nomeFormattato));
  const snap = await getDocs(q);
  if (!snap.empty) {
    alert(`Fornitore "${nomeFormattato}" già presente.`);
    return;
  }
  await addDoc(collection(db, "fornitori"), { nome: nomeFormattato });
  await carica();
  document.querySelectorAll('#p-fornitore').forEach(el => {
    el.value = nomeFormattato;
  });
}
