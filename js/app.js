import { initFirebase }                        from './firebase.js';
import { initAuth }                            from './auth.js';
import { initNav, initModals, openModal }      from './nav.js';
import { initFornitori }                       from './fornitori.js';
import { initMagazzino, setOperatore,
         apriModalAggiungi }                   from './magazzino.js';
import { initProdottoFinito, initModalPF,
         setOperatorePF, apriModalAggiuntaPF } from './prodotto-finito.js';

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
    initMagazzino(db);
    initProdottoFinito(db);
    initModalPF();

    // Il bottone "+ Prodotto" apre il modal giusto in base al tab attivo
    document.getElementById('add-product-btn').addEventListener('click', () => {
      const tabAttivo = document.querySelector('#view-magazzino .tab-btn.active');
      if (tabAttivo?.dataset.tab === 'prodotto-finito') {
        apriModalAggiuntaPF();
      } else {
        apriModalAggiungi();
      }
    });
  });
}

main();
