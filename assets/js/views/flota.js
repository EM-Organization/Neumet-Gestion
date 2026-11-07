// Flota con prioridades: vehículos ordenados por severidad (semáforo ok/bajo/crítico) y KPIs de flota.
// Datos: vistas SQL v_estado_neumaticos y v_resumen_flota_cliente (security_invoker: RLS decide qué ve cada rol).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { chipEstado, estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import { fmtNum, fmtMm } from '../domain/formato.js';
import { isClienteMode } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { contextoListo, hayFiltroSeccional, filtrarFilas } from '../core/seccional.js';
import { resumenDesdeFilas } from '../domain/seccional.js';
import {
  agruparVehiculos, filtrarVehiculos, kpisFlota,
} from '../domain/flota.js';
import { etiquetaCoche } from '../domain/coche.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 20000;
let estadoRows = [];
let resumen = [];
let vehiculos = [];

function kpiCard(valor, etiqueta, cls = '') {
  return html`<div class="dash-kpi-card ${cls}"><div><div class="dash-kpi-val">${fmtNum(valor)}</div><div class="dash-kpi-label">${etiqueta}</div></div></div>`;
}

function renderKpis(filtros) {
  const k = kpisFlota(estadoRows, resumen, filtros.clienteId);
  setHtml($('flota-kpis'), joinHtml([
    kpiCard(k.vehiculos, 'Vehículos activos'),
    kpiCard(k.criticos, 'Neumáticos críticos', k.criticos > 0 ? 'alert' : ''),
    kpiCard(k.sin_medir, 'Neumáticos sin medir'),
    kpiCard(k.alertas, 'Alertas activas', k.alertas > 0 ? 'alert' : ''),
  ]));
}

function card(v, mostrarCliente) {
  const arg = JSON.stringify([v.vehiculo_id]);
  const clienteNombre = mostrarCliente ? (resumen.find(r => String(r.cliente_id) === String(v.cliente_id)) || {}).nombre : '';
  return html`<div class="dash-fleet-card flota-card ${'sev-' + safeCls(v.semaforo)}" data-vehiculo="${v.vehiculo_id}" data-semaforo="${v.semaforo}">
    <div class="dash-fleet-name">${etiquetaCoche(v.nombre)}${v.patente ? html`<span class="dash-fleet-pat">${v.patente}</span>` : ''}
      ${chipEstado(v.semaforo)}</div>
    ${clienteNombre ? html`<div class="flota-cliente">${clienteNombre}</div>` : ''}
    <div class="dash-fleet-stats">
      <span class="flota-n ${v.n_critico ? 'red' : ''}">${v.n_critico} crít.</span>
      <span class="flota-n">${v.n_bajo} bajo</span>
      <span class="flota-n">${v.n_ok} ok</span>
      ${v.n_sin_datos ? html`<span class="flota-n">${v.n_sin_datos} sin datos</span>` : ''}
    </div>
    <div class="flota-meta">
      ${v.min_mm === null ? 'Sin mediciones' : html`Más gastado: posición ${v.peor_posicion}, ${fmtMm(v.min_mm)}`}
      ${v.n_sin_medir ? html` · ${v.n_sin_medir} sin medir` : ''}${v.n_irregular ? html` · ${v.n_irregular} con desgaste irregular` : ''}
      <br>Última medición: ${v.ultima_medicion_at ? relDate(v.ultima_medicion_at) : 'nunca'}
    </div>
    <button class="btn ghost flota-link" data-action="verVehiculo" data-args="${arg}">Ver vehículo</button>
  </div>`;
}

function filtros() {
  return {
    clienteId: isClienteMode() ? '' : ($('flota-cliente')?.value || ''),
    estado: $('flota-estado').value,
    q: $('flota-q').value,
  };
}

export function render() {
  const f = filtros();
  renderKpis(f);
  const lista = filtrarVehiculos(vehiculos, f);
  const mostrarCliente = !isClienteMode() && !f.clienteId;
  if (!lista.length) {
    setHtml($('flota-grid'), vehiculos.length
      ? estadoVacio('Ningún vehículo coincide con los filtros')
      : estadoVacio('Sin vehículos con neumáticos', '', { label: 'Ver vehículos', action: 'irA', args: ['vehiculos'], primaria: true }));
    return;
  }
  setHtml($('flota-grid'), joinHtml(lista.map(v => card(v, mostrarCliente))));
}

function fillClientes() {
  const sel = $('flota-cliente');
  if (!sel || isClienteMode()) return;
  const actual = sel.value;
  setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`,
    ...resumen.map(r => html`<option value="${r.cliente_id}">${r.nombre}</option>`)]));
  sel.value = actual;
}

export async function load() {
  $('flota-msg').textContent = '';
  setHtml($('flota-grid'), estadoCarga('Cargando la flota…'));
  await contextoListo();
  const filtrando = hayFiltroSeccional();
  const [est, res, al] = await Promise.all([
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_resumen_flota_cliente').select('*').order('nombre'),
    // Con una sucursal elegida el resumen del servidor (por cliente) no sirve: se recalcula con las alertas filtradas.
    filtrando ? fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').order('tipo').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }) : Promise.resolve({ rows: [], error: null }),
  ]);
  if (est.error || res.error || al.error) { showToast(userError(est.error || res.error || al.error), true); setHtml($('flota-grid'), estadoError('', 'loadFlota')); return; }
  estadoRows = filtrando ? filtrarFilas(est.rows) : est.rows;
  resumen = res.data || [];
  if (filtrando) {
    const alF = filtrarFilas(al.rows);
    const base = resumen[0] || {};
    resumen = [resumenDesdeFilas(estadoRows, alF, { clienteId: base.cliente_id ?? null, nombre: base.nombre || '' })];
  }
  vehiculos = agruparVehiculos(estadoRows);
  fillClientes();
  $('flota-msg').textContent = est.truncated ? `Se muestran las primeras ${MAX_FILAS} posiciones: la lista está incompleta.` : '';
  render();
}

registerActions({ loadFlota: () => load() });

export function init() {
  $('flota-cliente').addEventListener('change', render);
  $('flota-estado').addEventListener('change', render);
  $('flota-q').addEventListener('input', render);
}

registerView('flota', 'Estado de la flota', load);
