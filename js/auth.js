import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function initAuth(auth, onLogin, onLogout) {
  const loginScreen      = document.getElementById('login-screen');
  const appEl            = document.getElementById('app');
  const loginForm        = document.getElementById('login-form');
  const loginError       = document.getElementById('login-error');
  const userEmailDisplay = document.getElementById('user-email-display');
  const logoutBtn        = document.getElementById('logout-btn');

  onAuthStateChanged(auth, user => {
    if (user) {
      loginScreen.classList.add('hidden');
      appEl.classList.remove('hidden');
      userEmailDisplay.textContent = user.email;
      onLogin(user);
    } else {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
      userEmailDisplay.textContent = '';
      if (onLogout) onLogout();
    }
  });

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, loginForm.email.value, loginForm.password.value);
    } catch {
      loginError.textContent = 'Email o password non corretti.';
    }
  });

  logoutBtn.addEventListener('click', () => signOut(auth));
}
