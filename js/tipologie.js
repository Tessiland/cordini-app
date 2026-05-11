import {
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db;

export async function initTipologie(firestoreDb) {
  db = firestoreDb;
  await aggiornaDatalists();
}

export async function aggiornaDatalists() {
  const [pfSnap, fornSnap] = await Promise.all([
    getDocs(collection(db, "prodotti_finiti")),
    getDocs(collection(db, "fornitori"))
  ]);

  const nomiSet     = new Set();
  const coloriSet   = new Set();
  const fornSet     = new Set();

  // Da fornitori collection
  fornSnap.docs.forEach(d => {
    if (d.data().nome) fornSet.add(d.data().nome.trim());
  });

  // Da prodotti_finiti (include fornitori importati da Excel)
  pfSnap.docs.forEach(d => {
    const data = d.data();
    if (data.nome)      nomiSet.add(data.nome.trim());
    if (data.colore)    coloriSet.add(data.colore.trim());
    if (data.fornitore) fornSet.add(data.fornitore.trim());
  });

  const sort = arr => [...arr].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));

  const dl = id => document.getElementById(id);
  if (dl('tipologie-datalist'))   dl('tipologie-datalist').innerHTML   = sort(nomiSet).map(n => `<option value="${n}">`).join('');
  if (dl('colori-datalist'))      dl('colori-datalist').innerHTML      = sort(coloriSet).map(c => `<option value="${c}">`).join('');
  if (dl('fornitori-pf-datalist')) dl('fornitori-pf-datalist').innerHTML = sort(fornSet).map(f => `<option value="${f}">`).join('');
}
