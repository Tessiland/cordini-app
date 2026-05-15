import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  writeBatch, doc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db;
let fornitori = [];

export async function initFornitori(firestoreDb) {
  db = firestoreDb;
  await carica();

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
// Fonte di verità: i nomi dei fornitori nella materia prima.
// I prodotti finiti vengono allineati a quei nomi.
// "STOCK" e "IBRIDI" nel campo fornitore principale vengono lasciati invariati.
// coloriComponenti[].idFornitore viene normalizzato sempre, anche negli IBRIDI.
async function eseguiUnificazione() {
  const btn = document.getElementById('unifica-fornitori-btn');
  btn.disabled = true;
  btn.textContent = 'Analisi in corso…';

  try {
    // Leggi tutto in parallelo
    const [prodSnap, pfSnap, fornSnap] = await Promise.all([
      getDocs(collection(db, "prodotti")),
      getDocs(collection(db, "prodotti_finiti")),
      getDocs(collection(db, "fornitori"))
    ]);

    // Nomi canonici = valori distinti di idFornitore nella materia prima
    const canonici = [...new Set(
      prodSnap.docs.map(d => d.data().idFornitore).filter(Boolean)
    )];

    if (canonici.length === 0) {
      alert('Nessun fornitore trovato nella materia prima. Impossibile procedere.');
      return;
    }

    // Per ogni nome "sporco", trova il canonico con normalizzazione
    const SPECIALI = new Set(['STOCK', 'IBRIDI']);

    function trovaCanonico(nome) {
      if (!nome || SPECIALI.has(nome)) return null;
      const normNome = normalizzaFornitore(nome);
      return canonici.find(c => normalizzaFornitore(c) === normNome) ?? null;
    }

    // Analizza prodotti finiti: cosa cambierebbe
    const modifiche = [];
    pfSnap.docs.forEach(d => {
      const data = d.data();
      const righe = [];

      const canForn = trovaCanonico(data.fornitore);
      if (canForn && canForn !== data.fornitore) {
        righe.push(`  fornitore: "${data.fornitore}" → "${canForn}"`);
      }

      (data.coloriComponenti ?? []).forEach((c, i) => {
        const canCC = trovaCanonico(c.idFornitore);
        if (canCC && canCC !== c.idFornitore) {
          righe.push(`  componente ${i + 1}: "${c.idFornitore}" → "${canCC}"`);
        }
      });

      if (righe.length > 0) {
        modifiche.push({ id: d.id, nome: data.nome, righe, data, canForn });
      }
    });

    // Fornitori nella collezione da eliminare (non canonici e non speciali)
    const fornDaEliminare = fornSnap.docs.filter(d => {
      const nome = d.data().nome;
      if (SPECIALI.has(nome)) return false;
      return !canonici.includes(nome);
    });

    if (modifiche.length === 0 && fornDaEliminare.length === 0) {
      alert('Tutto già allineato. Nessuna modifica necessaria.');
      return;
    }

    // Anteprima
    const previewPF = modifiche.slice(0, 10).map(m =>
      `${m.nome ?? '(senza nome)'}:\n${m.righe.join('\n')}`
    ).join('\n\n');
    const extraPF = modifiche.length > 10 ? `\n…e altri ${modifiche.length - 10} prodotti` : '';
    const previewForn = fornDaEliminare.length > 0
      ? `\n\nFornitori da rimuovere dalla lista:\n${fornDaEliminare.map(d => `  • "${d.data().nome}"`).join('\n')}`
      : '';

    if (!confirm(
      `Prodotti finiti da aggiornare: ${modifiche.length}\n\n${previewPF}${extraPF}${previewForn}\n\nProcedo?`
    )) return;

    btn.textContent = 'Migrazione in corso…';

    const batch = writeBatch(db);

    // Aggiorna prodotti finiti
    modifiche.forEach(({ id, data, canForn }) => {
      const updates = {};

      if (canForn && canForn !== data.fornitore) {
        updates.fornitore = canForn;
      }

      if (data.coloriComponenti?.length) {
        const nuovi = data.coloriComponenti.map(c => {
          const canCC = trovaCanonico(c.idFornitore);
          return (canCC && canCC !== c.idFornitore) ? { ...c, idFornitore: canCC } : c;
        });
        const changed = nuovi.some((c, i) => c.idFornitore !== data.coloriComponenti[i].idFornitore);
        if (changed) updates.coloriComponenti = nuovi;
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc(db, "prodotti_finiti", id), updates);
      }
    });

    // Rimuovi fornitori non canonici dalla collezione fornitori
    fornDaEliminare.forEach(d => {
      batch.delete(doc(db, "fornitori", d.id));
    });

    await batch.commit();
    await carica();

    alert(`✓ Migrazione completata!\n${modifiche.length} prodotti finiti aggiornati.\n${fornDaEliminare.length} fornitori rimossi dalla lista.`);

  } catch (err) {
    console.error("Errore unificazione fornitori:", err);
    alert(`Errore durante la migrazione: ${err.message}`);
  } finally {
    btn.disabled = false;
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
