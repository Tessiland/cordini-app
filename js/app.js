import { initFirebase }  from './firebase.js';
import { initAuth }      from './auth.js';
import { initNav, initModals } from './nav.js';

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

  initAuth(auth, async () => {
    if (initialized) return;
    initialized = true;

    initNav();
    initModals();

    // Le sezioni verranno importate e inizializzate nei prossimi step di sviluppo.
    // Esempio futuro:
    // const { initMagazzino } = await import('./magazzino.js');
    // initMagazzino(db);
  });
}

main();
