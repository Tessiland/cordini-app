import { initFirebase }            from './firebase.js';
import { initAuth }                from './auth.js';
import { initNav, initModals }     from './nav.js';
import { initFornitori }           from './fornitori.js';
import { initTipologie }           from './tipologie.js';
import { initMagazzino, setOperatore } from './magazzino.js';
import { initProdottoFinito, setOperatorePF } from './prodotto-finito.js';
import { initCatalogo }                       from './catalogo.js';
import { initOrdiniProduzione }               from './ordini-produzione.js';
import { initOrdiniFornitori }               from './ordini-fornitori.js';
import { initEtichette }                     from './etichette.js';

async function main() {
  let firebase;

  try {
    firebase = await initFirebase();
  } catch (err) {
    console.error('Errore inizializzazione Firebase:', err);
    document.getElementById('login-error').textContent =
      'Errore di connessione. Ricarica la pagina.';
    return;
  }

  const { auth, db } = firebase;
  let initialized = false;

  initAuth(auth, async (user) => {
    if (initialized) return;
    initialized = true;

    setOperatore(user.email);
    setOperatorePF(user.email);

    initNav();
    initModals();

    await initFornitori(db);
    try { await initTipologie(db); } catch (e) { console.error('initTipologie:', e); }
    initMagazzino(db);
    initProdottoFinito(db);
    try { initCatalogo(db, user.email); } catch (e) { console.error('initCatalogo:', e); }
    try { initOrdiniProduzione(db, user.email); } catch (e) { console.error('initOrdiniProduzione:', e); }
    try { initOrdiniFornitori(db); } catch (e) { console.error('initOrdiniFornitori:', e); }
    try { initEtichette(db); } catch (e) { console.error('initEtichette:', e); }
  });
}

main();
