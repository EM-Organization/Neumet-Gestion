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
  // Un diálogo destructivo se declara con data-modal-rol="alertdialog" (los lectores de pantalla lo anuncian con prioridad).
  dlg.setAttribute('role', bd.id === 'modal-confirm' || bd.dataset.modalRol === 'alertdialog' ? 'alertdialog' : 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  if (titulo && titulo.id) dlg.setAttribute('aria-labelledby', titulo.id);
  dlg.setAttribute('tabindex', '-1');
  const previo = document.activeElement;
  abiertos.push({ bd, dlg, previo, firma: firmaDe(previo) });
  const items = focusables(dlg);
  // data-foco-inicial="<id>": en lo destructivo el foco empieza en la salida segura («Cancelar»), no en un campo ni en confirmar.
  const inicial = bd.dataset.focoInicial ? items.find(el => el.id === bd.dataset.focoInicial) : null;
  (inicial || items.find(el => !el.closest('.modal-footer')) || items[0] || dlg).focus();
}

// Si la vista se repintó mientras el modal estaba abierto (p. ej. tras montar un neumático), el botón que lo abrió ya no es el mismo
// nodo: se busca su equivalente por id o por acción + argumentos, para que el foco no caiga en <body>.
const firmaDe = el => (el && el.getAttribute ? { id: el.id || '', accion: el.getAttribute('data-action') || '', args: el.getAttribute('data-args') || '' } : null);
function equivalente(f) {
  if (!f) return null;
  if (f.id) return document.getElementById(f.id);
  if (!f.accion) return null;
  return [...document.querySelectorAll('[data-action]')].find(e => e.getAttribute('data-action') === f.accion && (e.getAttribute('data-args') || '') === f.args && visible(e)) || null;
}

function cerrar(bd) {
  const i = abiertos.findIndex(o => o.bd === bd);
  if (i < 0) return;
  const [{ previo, firma }] = abiertos.splice(i, 1);
  const destino = previo && previo.isConnected ? previo : equivalente(firma);
  if (destino && typeof destino.focus === 'function') destino.focus();
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
