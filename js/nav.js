const VIEWS = ['magazzino', 'alert', 'ordini', 'bacheca', 'produzione', 'catalogo'];

const callbacks = {};

export function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Tab bars dentro le sezioni
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

export function switchView(viewName) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== viewName);
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
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
