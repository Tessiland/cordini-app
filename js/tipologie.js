import {
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db;

export async function initTipologie(firestoreDb) {
  db = firestoreDb;
  await aggiornaDatalists();
}

export async function aggiornaDatalists() {
  // Carica nomi unici da prodotti_finiti
  const [pfSnap] = await Promise.all([
    getDocs(query(collection(db, "prodotti_finiti")))
  ]);

  const nomiSet   = new Set();
  const coloriSet = new Set();

  pfSnap.docs.forEach(d => {
    const data = d.data();
    if (data.nome)   nomiSet.add(data.nome.trim());
    if (data.colore) coloriSet.add(data.colore.trim());
  });

  const nomiSorted   = [...nomiSet].sort();
  const coloriSorted = [...coloriSet].sort();

  // Popola datalist tipologie
  const dlTip = document.getElementById('tipologie-datalist');
  if (dlTip) dlTip.innerHTML = nomiSorted.map(n => `<option value="${n}">`).join('');

  // Popola datalist colori
  const dlCol = document.getElementById('colori-datalist');
  if (dlCol) dlCol.innerHTML = coloriSorted.map(c => `<option value="${c}">`).join('');
}
