import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export async function initFirebase() {
  const res = await fetch('/api/get-config');
  if (!res.ok) throw new Error('Configurazione non disponibile.');
  const config = await res.json();
  const app = initializeApp(config);
  return {
    db: getFirestore(app),
    auth: getAuth(app)
  };
}
