// Selector de distribución con pictogramas: tarjetas de radio dentro de un <fieldset>. Lo usan el alta de vehículos y el
// cambio de distribución. Los radios sustituyen al select: `valorDistribucion` da lo mismo que daba el select (el código,
// «otra» o '' si no hay ninguna marcada). No se usa `fieldset.elements.distribucion`: en un fieldset es un HTMLCollection y
// devuelve el primer radio, no el marcado.
import { html, joinHtml, setHtml } from './html.js';
import { DISTRIBUCIONES, OTRA_DISTRIBUCION, textoOpcion, pictogramaDistribucion } from '../domain/distribucion.js';

const ALTO_RUEDA = 10; // solo dibujo: el ancho de la rueda viene del dominio

const eje = e => {
  const xs = e.ruedas.map(r => r.x);
  return html`<g data-eje="${e.direccion ? 'direccion' : 'resto'}"><line x1="${Math.min(...xs)}" x2="${Math.max(...xs)}" y1="${e.y}" y2="${e.y}"/>${joinHtml(
    e.ruedas.map(r => html`<rect x="${r.x - r.ancho / 2}" y="${e.y - ALTO_RUEDA / 2}" width="${r.ancho}" height="${ALTO_RUEDA}" rx="1.5"/>`)
  )}</g>`;
};

const dibujo = d => {
  const g = pictogramaDistribucion(d.id);
  return html`<svg class="dist-dibujo" viewBox="0 0 ${g.ancho} ${g.alto}" aria-hidden="true" focusable="false">${joinHtml(g.ejes.map(eje))}</svg>`;
};

const opcion = d => html`<label class="dist-op"><input type="radio" name="distribucion" value="${d.id}"/>${dibujo(d)}<span>${textoOpcion(d)}</span></label>`;

// «Otra» no tiene dibujo: el hueco queda con el mismo tamaño para que las tarjetas se alineen.
const otra = html`<label class="dist-op"><input type="radio" name="distribucion" value="${OTRA_DISTRIBUCION}"/><span class="dist-sin-dibujo" aria-hidden="true"></span><span>Otra distribución</span></label>`;

// Pinta las tarjetas en el contenedor `.dist-opciones` del grupo. El catálogo es fijo: se pinta una vez, al iniciar la vista.
export function pintarDistribucion(grupo) {
  setHtml(grupo.querySelector('.dist-opciones'), joinHtml([DISTRIBUCIONES.map(opcion), otra]));
}

// Valor elegido: el código del catálogo, «otra», o '' si no hay ninguna marcada.
export function valorDistribucion(grupo) {
  const marcada = grupo.querySelector('input[name="distribucion"]:checked');
  return marcada ? marcada.value : '';
}

// Marca la tarjeta de `valor`; con '' no queda ninguna (igual que el select sin opción elegida).
export function marcarDistribucion(grupo, valor) {
  grupo.querySelectorAll('input[name="distribucion"]').forEach(r => { r.checked = r.value === valor; });
}

// El foco va a la tarjeta marcada, o a la primera si no hay ninguna (un fieldset no recibe foco).
export function enfocarDistribucion(grupo) {
  const r = grupo.querySelector('input[name="distribucion"]:checked') || grupo.querySelector('input[name="distribucion"]');
  if (r) r.focus();
}
