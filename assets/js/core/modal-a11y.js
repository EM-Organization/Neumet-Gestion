// Accesibilidad de los modales sin tocar cada vista: las vistas abren/cierran con la clase .show en .modal-backdrop.
// Un MutationObserver detecta el cambio y aplica role="dialog", foco inicial, foco atrapado (Tab), Esc para cerrar
// y devuelve el foco al elemento que abrió el modal.
import { runAction } from './actions.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const visible = el => el.getClientRects().length > 0;
const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(visible);
const abiertos = [];

function abrir(bd) {
  if (abiertos.some(o => o.bd === bd)) return;
  const dlg = bd.querySelector('.modal');
  if (!dlg) return;
  const titulo = dlg.querySelector('.modal-title');
  dlg.setAttribute('role', bd.id === 'modal-confirm' ? 'alertdialog' : 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  if (titulo && titulo.id) dlg.setAttribute('aria-labelledby', titulo.id);
  dlg.setAttribute('tabindex', '-1');
  abiertos.push({ bd, dlg, previo: document.activeElement });
  const items = focusables(dlg);
  (items.find(el => !el.closest('.modal-footer')) || items[0] || dlg).focus();
}

function cerrar(bd) {
  const i = abiertos.findIndex(o => o.bd === bd);
  if (i < 0) return;
  const [{ previo }] = abiertos.splice(i, 1);
  if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
}

function alTeclear(e) {
  const top = abiertos[abiertos.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    const accion = top.bd.dataset.backdropClose;
    if (accion) runAction(accion, []);
    else document.getElementById('confirm-cancel')?.click();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables(top.dlg);
  if (!items.length) { e.preventDefault(); top.dlg.focus(); return; }
  const primero = items[0], ultimo = items[items.length - 1];
  const activo = document.activeElement;
  if (e.shiftKey && (activo === primero || !top.dlg.contains(activo))) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && (activo === ultimo || !top.dlg.contains(activo))) { e.preventDefault(); primero.focus(); }
}

export function initModales() {
  const obs = new MutationObserver(muts => muts.forEach(m => {
    const bd = m.target;
    if (bd.classList.contains('show')) abrir(bd); else cerrar(bd);
  }));
  document.querySelectorAll('.modal-backdrop').forEach(bd => obs.observe(bd, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('keydown', alTeclear);
}
