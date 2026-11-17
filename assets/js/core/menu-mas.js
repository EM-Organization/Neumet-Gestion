// Menú «Más»: agrupa las acciones secundarias de una fila (Editar, Silenciar, Eliminar...) detrás de un solo botón, para que
// la acción principal quede sola y visible. Patrón de divulgación: el botón lleva aria-expanded, no hay role="menu"
// (cada ítem es un botón normal que se alcanza con Tab o con las flechas). Esc cierra y devuelve el foco al botón; elegir un
// ítem, hacer clic fuera o sacar el foco del menú lo cierra. La lista se posiciona con `position: fixed` porque las tablas
// y tarjetas que la contienen recortan (overflow) lo que sobresale.
import { html } from './html.js';

// items: [{ label, action, args?, aria?, peligro? }]. `aria` aclara sobre qué fila actúa el ítem; `peligro` solo atenúa el
// estilo (el rojo se reserva al hover, como el resto de bajas del panel).
export function menuMas({ etiqueta, items }) {
  return html`<span class="menu-mas" data-menu-mas><button type="button" class="btn ghost stk-btn menu-mas-btn" data-menu-mas-btn aria-expanded="false" aria-label="${etiqueta}">Más</button><span class="menu-mas-lista" role="group" aria-label="${etiqueta}" hidden>${items.map(i => html`<button type="button" class="menu-mas-item${i.peligro ? ' menu-mas-del' : ''}" data-action="${i.action}" data-args="${JSON.stringify(i.args || [])}"${i.aria ? html` aria-label="${i.aria}"` : ''}>${i.label}</button>`)}</span></span>`;
}

let abierto = null; // { raiz, boton, lista } del único menú abierto

function cerrar(devolverFoco) {
  if (!abierto) return;
  const { boton, lista } = abierto;
  abierto = null;
  lista.hidden = true;
  boton.setAttribute('aria-expanded', 'false');
  if (devolverFoco && boton.isConnected) boton.focus();
}

function abrir(raiz, conTeclado) {
  cerrar(false);
  const boton = raiz.querySelector('[data-menu-mas-btn]');
  const lista = raiz.querySelector('.menu-mas-lista');
  lista.hidden = false;
  boton.setAttribute('aria-expanded', 'true');
  abierto = { raiz, boton, lista };
  const r = boton.getBoundingClientRect();
  const w = lista.offsetWidth, h = lista.offsetHeight;
  const izq = Math.max(8, Math.min(r.right - w, document.documentElement.clientWidth - w - 8));
  const abajo = r.bottom + 4;
  lista.style.left = `${izq}px`;
  lista.style.top = `${abajo + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : abajo}px`;
  if (conTeclado) lista.querySelector('.menu-mas-item')?.focus({ preventScroll: true });
}

export function initMenuMas() {
  document.addEventListener('click', e => {
    const boton = e.target.closest('[data-menu-mas-btn]');
    if (boton) {
      const raiz = boton.closest('[data-menu-mas]');
      if (abierto && abierto.raiz === raiz) cerrar(false); else abrir(raiz, e.detail === 0);
      return;
    }
    if (!abierto) return;
    // Elegir un ítem: la acción ya corrió en su propio oyente; el foco vuelve al botón para que un modal que se abra
    // lo recuerde como origen y lo devuelva al cerrarse.
    if (abierto.lista.contains(e.target)) cerrar(true); else cerrar(false);
  });
  document.addEventListener('keydown', e => {
    if (!abierto) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...abierto.lista.querySelectorAll('.menu-mas-item')];
    const i = items.indexOf(document.activeElement);
    if (i === -1 && document.activeElement !== abierto.boton) return;
    e.preventDefault();
    const n = e.key === 'ArrowDown' ? i + 1 : i - 1;
    items[(n + items.length) % items.length].focus({ preventScroll: true });
  });
  // Si el foco sale del menú (Tab) se cierra sin robarlo.
  document.addEventListener('focusin', e => {
    if (abierto && !abierto.raiz.contains(e.target)) cerrar(false);
  });
  const soltar = () => cerrar(false);
  window.addEventListener('resize', soltar);
  window.addEventListener('scroll', soltar, true);
}
