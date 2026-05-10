import {
  collection, getDocs, addDoc, query, where
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
  // form materia prima
  document.querySelectorAll('#p-fornitore').forEach(el => {
    el.innerHTML = opzioniForm;
  });
  // form prodotto finito
  document.querySelectorAll('#pf-fornitore').forEach(el => {
    el.innerHTML = opzioniForm;
  });
}

export function getFornitori() {
  return fornitori;
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
