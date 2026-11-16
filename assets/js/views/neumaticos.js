// Menú «Neumáticos»: una sola entrada con dos pestañas, Stock y Recauchutado. Cada pestaña sigue siendo su vista
// (`stock`, `recauchutado`), así que los enlaces internos y el buscador no cambian; aquí solo se cablea el tablist
// (clic y teclado) y se decide qué pestañas ve cada rol (domain/neumaticos.js).
import { esAdmin, esAdminEmpresa, onLogin, onLogout } from '../core/auth.js';
import { switchView } from '../core/nav.js';
import { pestanasVisibles, pestanaPorTecla, hayPestanas, PESTANA_RECAUCHUTADO } from '../domain/neumaticos.js';

const visibles = () => pestanasVisibles({ admin: esAdmin(), adminEmpresa: esAdminEmpresa() });

function aplicarRol() {
  const v = visibles();
  document.querySelectorAll('[data-neu-tabs]').forEach(t => { t.style.display = hayPestanas(v) ? '' : 'none'; });
  document.querySelectorAll('[data-neu-reca]').forEach(b => { b.style.display = v.includes(PESTANA_RECAUCHUTADO) ? '' : 'none'; });
}

// Al cambiar de pestaña la vista cambia, así que el foco se lleva a la pestaña activa de la vista nueva.
function ir(destino) {
  switchView(destino);
  document.querySelector(`#view-${destino} [role="tab"][data-neu-tab="${destino}"]`)?.focus();
}

onLogin(aplicarRol);
onLogout(() => {
  document.querySelectorAll('[data-neu-tabs]').forEach(t => { t.style.display = 'none'; });
  document.querySelectorAll('[data-neu-reca]').forEach(b => { b.style.display = 'none'; });
});

export function init() {
  document.querySelectorAll('[data-neu-tabs]').forEach(tablist => {
    tablist.addEventListener('click', e => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && tab.getAttribute('aria-selected') !== 'true') switchView(tab.dataset.neuTab);
    });
    tablist.addEventListener('keydown', e => {
      const tab = e.target.closest('[role="tab"]');
      const destino = tab && pestanaPorTecla(visibles(), tab.dataset.neuTab, e.key);
      if (!destino) return;
      e.preventDefault();
      if (destino !== tab.dataset.neuTab) ir(destino);
    });
  });
}
