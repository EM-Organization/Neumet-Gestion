// Componentes de UI compartidos por todas las vistas: chip de estado, estados vacío/carga/error y fila de tabla con estado.
// Reglas: el estado nunca se comunica solo con color (siempre hay texto + símbolo), y todo estado vacío o de error
// explica qué hacer. Los textos van en español claro.
import { html } from './html.js';

// Chip de estado: color + símbolo + texto. cls = green | orange | red | gray (clases .badge de styles.css).
export function chip(cls, texto, simbolo = '●') {
  return html`<span class="badge ${cls}"><span aria-hidden="true">${simbolo}</span> ${texto}</span>`;
}

const ESTADO_NEUMATICO = {
  ok: { cls: 'green', lbl: 'OK', sim: '✓' },
  bajo: { cls: 'orange', lbl: 'Bajo', sim: '▲' },
  critico: { cls: 'red', lbl: 'Crítico', sim: '✕' },
  sin_datos: { cls: 'gray', lbl: 'Sin datos', sim: '–' },
};
// Estado de un neumático o vehículo: ok / bajo / critico / sin_datos (cualquier otro valor se muestra como sin datos).
export function chipEstado(estado) {
  const e = ESTADO_NEUMATICO[estado] || ESTADO_NEUMATICO.sin_datos;
  return chip(e.cls, e.lbl, e.sim);
}

const boton = a => html`<button type="button" class="btn ${a.primaria ? 'primary' : ''}" data-action="${a.action}" data-args="${JSON.stringify(a.args || [])}">${a.label}</button>`;

// Estado vacío: qué pasa + qué hacer. accion = { label, action, args?, primaria? } (opcional).
export function estadoVacio(titulo, ayuda, accion) {
  return html`<div class="empty-state"><div class="empty-title">${titulo}</div>${ayuda ? html`<div class="empty-sub">${ayuda}</div>` : ''}${accion ? html`<div class="empty-action">${boton(accion)}</div>` : ''}</div>`;
}

export function estadoCarga(texto = 'Cargando…') {
  return html`<div class="loading-state" role="status"><div class="spinner" aria-hidden="true"></div>${texto}</div>`;
}

// Estado de error con acción de reintentar: reintentar = nombre de la acción (data-action) que vuelve a cargar la vista.
export function estadoError(mensaje, reintentar) {
  return html`<div class="empty-state error-state" role="alert"><div class="empty-title">No pudimos cargar los datos</div><div class="empty-sub">${mensaje || 'Revisá tu conexión e intentá de nuevo.'}</div>${reintentar ? html`<div class="empty-action">${boton({ label: 'Reintentar', action: reintentar, primaria: true })}</div>` : ''}</div>`;
}

// Fila de tabla que ocupa todas las columnas (vacío, carga o error dentro de un <tbody>).
export function filaEstado(columnas, contenido) {
  return html`<tr><td colspan="${columnas}">${contenido}</td></tr>`;
}
