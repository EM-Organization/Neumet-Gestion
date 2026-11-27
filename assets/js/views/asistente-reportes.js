// Asistente de reportes (docs/24 §2 y §6): un campo para preguntar sobre la flota, la respuesta con su fuente y los reportes listos (1 clic).
//
// Diseño de concurrencia (docs/13 §1.b). Arreglo: una pregunta a la vez y un contador de generación.
// - Doble envío (doble Enter, Enter + clic, dos clics en un reporte listo): `enCurso` ignora los envíos mientras hay una
//   pregunta en vuelo; además el campo y los botones quedan deshabilitados. `e.repeat` (Enter mantenido) no envía.
// - Cambio de cliente con una respuesta en vuelo: `clienteCambio()` sube `generacion`, aborta la petición, vacía la
//   conversación y libera `enCurso`. Una respuesta que llega con una generación vieja se descarta sin pintar ni mostrar errores.
// - Fallo a mitad: la pregunta queda «Sin respuesta», no entra a los turnos que se envían y «Volver a intentar» la reenvía.
// - Respuesta que nunca llega: AbortController a los 60 s, mismo manejo que un error de red.
// - Volver a Reportes: el load() reinicia el selector de cliente; `reiniciar()` vacía la conversación y descarta lo en
//   vuelo (misma guarda de generación), pero no toca lo escrito en el campo. Con cliente de empresa, `refrescar()` solo
//   ajusta lo habilitado y no toca nada más.
// - Operaciones simultáneas: el chat no escribe en la base (solo llama a la función), y la vista de Reportes de abajo
//   no comparte estado con él.
import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { isClienteMode } from '../core/auth.js';
import { puedeVerCostos } from './costos.js';
import { safeFilename } from '../domain/reportes.js';
import {
  REPORTES_LISTOS, TEXTO_ELEGIR_CLIENTE, normalizarRespuesta, mensajeError, preguntaReporte,
  reportesVisibles, recortarHistorial, turnosCompletados, textoFuente, tablaACsv,
} from '../domain/asistente.js';

const $ = id => document.getElementById(id);
const TIEMPO_MAXIMO_MS = 60000;
const TEXTO_CONSULTANDO = 'Consultando datos';
// El ejemplo del campo no nombra costos cuando el perfil no los ve (sucursal): una pregunta que no puede hacer confunde.
const EJEMPLO_CON_COSTOS = 'Por ejemplo: costo por km por marca';
// Ambos ejemplos entran en dos líneas del campo a 390 px (el campo tiene dos filas).
const EJEMPLO_SIN_COSTOS = 'Por ejemplo: cubiertas para cambiar';

let conversacion = [];   // {pregunta, respuesta: {bloques, fuentes, ...} | null, fallida}; solo de la sesión, nunca en localStorage
let enCurso = false;
let generacion = 0;
let controlador = null;  // AbortController de la pregunta en vuelo
let estadoTexto = '';    // lo que dice #asis-estado además de «Elegir un cliente.»
let reintento = null;    // entrada fallida que «Volver a intentar» reenvía
let tablas = [];         // tablas de la última pintura: data-asis-csv="<n>" apunta a tablas[n]

// El administrador interno elige cliente en el selector de Reportes; los usuarios de cliente siempre pueden preguntar.
const puedePreguntar = () => isClienteMode() || !!$('rep-cliente').value;
const clienteId = () => (isClienteMode() ? null : Number($('rep-cliente').value));

function hoyIso() {
  const d = new Date();
  const dos = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Pedido a la Edge Function asistente-reportes (contrato C2). Nunca lanza: un fallo de red o de sesión queda como status 0 o 401.
async function pedir(cuerpo, signal) {
  let status = 0, body = null;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return { status: 401, body: null };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/asistente-reportes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(cuerpo),
      signal,
    });
    status = res.status;
    body = await res.json();
  } catch { /* red, corte por tiempo o respuesta que no es JSON: se informa como error */ }
  return { status, body };
}

function pintarControles() {
  const habilitado = puedePreguntar() && !enCurso;
  $('asis-pregunta').disabled = !habilitado;
  $('asis-enviar').disabled = !habilitado;
  $('asis-pregunta').placeholder = puedeVerCostos() ? EJEMPLO_CON_COSTOS : EJEMPLO_SIN_COSTOS;
  document.querySelectorAll('#asis-listos button').forEach(b => { b.disabled = !habilitado; });
}

function pintarListos() {
  const ids = reportesVisibles(puedeVerCostos());
  const botones = ids.map(id => {
    const reporte = REPORTES_LISTOS.find(r => r.id === id);
    return html`<button type="button" class="btn" data-reporte="${id}">${reporte.titulo}</button>`;
  });
  setHtml($('asis-listos'), joinHtml(botones));
}

function pintarEstado() {
  const mensaje = puedePreguntar() ? estadoTexto : TEXTO_ELEGIR_CLIENTE;
  const boton = reintento ? html` <button type="button" class="btn ghost" data-asis-reintentar>Volver a intentar</button>` : '';
  setHtml($('asis-estado'), html`<span>${mensaje}</span>${boton}`);
}

function pintarRespuesta({ bloques, fuentes }) {
  const cuerpo = bloques.map(b => {
    if (b.tipo === 'parrafo') return html`<p>${b.texto}</p>`;
    const n = tablas.length;
    tablas.push(b);
    return html`<div class="asis-tabla"><table class="ciclo-tabla"><thead><tr>${b.columnas.map(c => html`<th scope="col">${c}</th>`)}</tr></thead><tbody>${b.filas.map(f => html`<tr>${f.map(c => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div><button type="button" class="btn ghost" data-asis-csv="${n}">Descargar CSV</button>`;
  });
  const pies = fuentes.map(f => html`<p class="asis-fuente">${textoFuente(f)}</p>`);
  return html`<div class="asis-respuesta">${joinHtml(cuerpo)}${joinHtml(pies)}</div>`;
}

function pintarHistorial() {
  tablas = [];
  const turnos = conversacion.map(e => html`<p class="asis-pregunta-hecha">${e.pregunta}${e.fallida ? html` <span class="asis-sin-respuesta">Sin respuesta</span>` : ''}</p>${e.respuesta ? pintarRespuesta(e.respuesta) : ''}`);
  setHtml($('asis-historial'), joinHtml(turnos));
}

// Los botones de reportes se crean antes de habilitarlos: pintarControles los recorre después.
function pintarTodo() {
  pintarListos();
  pintarControles();
  pintarEstado();
  pintarHistorial();
}

function descargarCsv(n) {
  const t = tablas[n];
  if (!t) return;
  download(tablaACsv(t.columnas, t.filas), safeFilename(['neumet-asistente', new Date().toISOString().slice(0, 10)], 'csv'));
}

async function preguntar(texto) {
  const pregunta = String(texto ?? '').trim();
  if (!pregunta || enCurso || !puedePreguntar()) return;
  const gen = generacion;
  const historial = recortarHistorial(turnosCompletados(conversacion));
  const entrada = { pregunta, respuesta: null, fallida: false };
  conversacion.push(entrada);
  enCurso = true;
  reintento = null;
  estadoTexto = TEXTO_CONSULTANDO;
  $('asis-pregunta').value = '';
  pintarTodo();

  controlador = new AbortController();
  const corte = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS);
  const { status, body } = await pedir({ pregunta, historial, cliente_id: clienteId() }, controlador.signal).finally(() => clearTimeout(corte));

  // Cambió el cliente mientras se esperaba: esta respuesta ya no corresponde a la pantalla (clienteCambio la descartó).
  if (gen !== generacion) return;
  enCurso = false;
  controlador = null;
  const respuesta = status === 200 ? normalizarRespuesta(body) : null;
  if (respuesta) {
    entrada.respuesta = respuesta;
    estadoTexto = '';
  } else {
    // Un 200 sin forma usable cuenta como fallo de red: se pide reintentar, como en cualquier otro error no clasificado.
    const error = mensajeError(status === 200 ? 0 : status, body && body.error);
    entrada.fallida = true;
    estadoTexto = error.texto;
    reintento = error.reintentar ? entrada : null;
  }
  pintarTodo();
  if (!$('asis-pregunta').disabled) $('asis-pregunta').focus();
}

function reintentar() {
  if (!reintento || enCurso) return;
  const fallida = reintento;
  conversacion = conversacion.filter(e => e !== fallida);
  reintento = null;
  preguntar(fallida.pregunta);
}

// Enter envía; Shift+Enter deja el salto de línea. Enter mantenido (e.repeat) no envía otra vez.
function alTeclear(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  if (e.repeat) return;
  preguntar($('asis-pregunta').value);
}

function alPulsar(e) {
  const reporte = e.target.closest('[data-reporte]');
  if (reporte) { preguntar(preguntaReporte(reporte.dataset.reporte, hoyIso())); return; }
  const csv = e.target.closest('[data-asis-csv]');
  if (csv) { descargarCsv(Number(csv.dataset.asisCsv)); return; }
  if (e.target.closest('[data-asis-reintentar]')) reintentar();
}

// Vacía la conversación y descarta lo que esté en vuelo, sin tocar el campo.
function descartarConversacion() {
  generacion++;
  if (controlador) controlador.abort();
  controlador = null;
  enCurso = false;
  conversacion = [];
  reintento = null;
  estadoTexto = '';
  pintarTodo();
}

// Lo llama ACTIONS.repClienteChange: el cliente cambió, así que lo que había en vuelo, la conversación y lo escrito ya no sirven.
export function clienteCambio() {
  descartarConversacion();
  $('asis-pregunta').value = '';
}

// Lo llama el load() de Reportes cuando reinicia el selector de cliente (al volver a la vista): la conversación de la
// visita anterior no corresponde al cliente que ahora queda elegido. Lo escrito en el campo se conserva.
export function reiniciar() {
  descartarConversacion();
}

// Lo llama el load() de Reportes en la vista de cliente de empresa: ajusta lo habilitado y los textos, sin tocar el campo ni la conversación.
export function refrescar() {
  pintarTodo();
}

export function init() {
  $('asis-form').addEventListener('submit', e => { e.preventDefault(); preguntar($('asis-pregunta').value); });
  $('asis-pregunta').addEventListener('keydown', alTeclear);
  $('rep-asistente').addEventListener('click', alPulsar);
}
