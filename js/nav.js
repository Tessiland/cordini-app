const VIEWS = ['magazzino', 'alert', 'ordini', 'bacheca', 'produzione', 'catalogo'];

const callbacks = {};

export function initNav() {
  // Bottom nav (tenuto nel DOM ma nascosto via CSS — i badge restano aggiornabili)
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Side nav items
  document.querySelectorAll('.side-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      chiudiSideNav();
    });
  });

  // Hamburger
  document.getElementById('hamburger-btn').addEventListener('click', apriSideNav);
  document.getElementById('side-nav-close').addEventListener('click', chiudiSideNav);
  document.getElementById('nav-backdrop').addEventListener('click', chiudiSideNav);

  // Sincronizza badge dal bottom-nav ai badge side-nav via MutationObserver
  sincronizzaBadge('alert-badge',   'alert-badge-side');
  sincronizzaBadge('bacheca-badge', 'bacheca-badge-side');

  // Tab bars
  document.querySelectorAll('.tab-bar').forEach(bar => {
    bar.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tabName = btn.dataset.tab;
      const bar = btn.closest('.tab-bar');
      const section = btn.closest('section') || btn.closest('.view');

      bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      section.querySelectorAll('.tab-content').forEach(tc => {
        tc.classList.toggle('active', tc.id === `tab-${tabName}`);
      });
    });
  });
}

function apriSideNav() {
  document.getElementById('side-nav').classList.add('open');
  document.getElementById('nav-backdrop').classList.remove('hidden');
}

function chiudiSideNav() {
  document.getElementById('side-nav').classList.remove('open');
  document.getElementById('nav-backdrop').classList.add('hidden');
}

function sincronizzaBadge(srcId, dstId) {
  const src = document.getElementById(srcId);
  const dst = document.getElementById(dstId);
  if (!src || !dst) return;

  const sync = () => {
    dst.textContent = src.textContent;
    dst.className   = src.className.replace(srcId, dstId);
  };
  sync();
  new MutationObserver(sync).observe(src, {
    attributes: true, childList: true, characterData: true, subtree: true
  });
}

export function switchView(viewName) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== viewName);
  });

  document.querySelectorAll('.nav-item, .side-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  if (callbacks[viewName]) callbacks[viewName]();
}

export function onViewActivate(viewName, fn) {
  callbacks[viewName] = fn;
}

// ── Modal helpers ────────────────────────────────────────────────
export function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

export function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

export function initModals() {
  document.addEventListener('click', e => {
    const closeBtn = e.target.closest('.modal-close');
    if (closeBtn) {
      closeModal(closeBtn.dataset.modal);
      return;
    }
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) {
      overlay.classList.add('hidden');
    }
  });
}
