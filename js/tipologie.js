import {
  collection, getDocs, addDoc, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db;
let tipologie = [];

export async function initTipologie(firestoreDb) {
  db = firestoreDb;
  await caricaTipologie();
}

async function caricaTipologie() {
  const snap = await getDocs(query(collection(db, "tipologie"), orderBy("nome")));
  tipologie = snap.docs.map(d => d.data().nome);
  aggiornaTipologieSelect();
}

function aggiornaTipologieSelect() {
  const opzioni = tipologie.map(t => `<option value="${t}">${t}</option>`).join('');
  document.querySelectorAll('#pf-tipologia').forEach(el => {
    const val = el.value;
    el.innerHTML = `<option value="">— Seleziona tipo cordino —</option>` + opzioni;
    if (val && tipologie.includes(val)) el.value = val;
  });
}

export function getTipologie() { return tipologie; }

export async function aggiuntaTipologia() {
  const nome = prompt('Nome del tipo cordino (es. Thai Sublime):');
  if (!nome?.trim()) return;
  const nomeFormattato = nome.trim();
  const q = query(collection(db, "tipologie"), where("nome", "==", nomeFormattato));
  const snap = await getDocs(q);
  if (!snap.empty) { alert(`"${nomeFormattato}" già presente.`); return; }
  await addDoc(collection(db, "tipologie"), { nome: nomeFormattato });
  tipologie = [...tipologie, nomeFormattato].sort();
  aggiornaTipologieSelect();
  document.querySelectorAll('#pf-tipologia').forEach(el => { el.value = nomeFormattato; });
}
