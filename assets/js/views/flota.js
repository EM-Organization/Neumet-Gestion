// Flota con prioridades: vehículos ordenados por severidad (semáforo ok/bajo/crítico) y KPIs de flota.
// Datos: vistas SQL v_estado_neumaticos y v_resumen_flota_cliente (security_invoker: RLS decide qué ve cada rol).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { isClienteMode } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  agruparVehiculos, filtrarVehiculos, kpisFlota, estadoLabel, ESTADO_BADGE,
} from '../domain/flota.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 20000;
let estadoRows = [];
let resumen = [];
let vehiculos = [];

const fmtMm = v => (v === null || v === undefined ? '—' : `${(Math.round(v * 10) / 10).toString().replace('.', ',')} mm`);

function kpiCard(valor, etiqueta, cls = '') {
  return html`<div class="dash-kpi-card ${cls}"><div><div class="dash-kpi-val">${valor ?? '—'}</div><div class="dash-kpi-label">${etiqueta}</div></div></div>`;
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
  const arg = JSON.stringify([v.patente || v.nombre]);
  const clienteNombre = mostrarCliente ? (resumen.find(r => String(r.cliente_id) === String(v.cliente_id)) || {}).nombre : '';
  return html`<div class="dash-fleet-card flota-card ${'sev-' + safeCls(v.semaforo)}" data-vehiculo="${v.vehiculo_id}" data-semaforo="${v.semaforo}">
    <div class="dash-fleet-name">${v.nombre}${v.patente ? html`<span class="dash-fleet-pat">${v.patente}</span>` : ''}
      <span class="badge ${ESTADO_BADGE[v.semaforo] || 'gray'}">${estadoLabel(v.semaforo)}</span></div>
    ${clienteNombre ? html`<div class="flota-cliente">${clienteNombre}</div>` : ''}
    <div class="dash-fleet-stats">
      <span class="flota-n red">${v.n_critico} crít.</span>
      <span class="flota-n orange">${v.n_bajo} bajo</span>
      <span class="flota-n green">${v.n_ok} ok</span>
      ${v.n_sin_datos ? html`<span class="flota-n gray">${v.n_sin_datos} sin datos</span>` : ''}
    </div>
    <div class="flota-meta">
      ${v.min_mm === null ? 'Sin mediciones' : html`Peor: pos. ${v.peor_posicion} · ${fmtMm(v.min_mm)}`}
      ${v.n_sin_medir ? html` · ${v.n_sin_medir} sin medir` : ''}${v.n_irregular ? html` · ${v.n_irregular} irregular` : ''}
      <br>Última medición: ${v.ultima_medicion_at ? relDate(v.ultima_medicion_at) : 'nunca'}
    </div>
    <button class="btn ghost flota-link" data-action="verVehiculoEnLista" data-args="${arg}">Ver vehículo</button>
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
    setHtml($('flota-grid'), html`<div class="flota-vacio">${vehiculos.length ? 'Ningún vehículo coincide con los filtros.' : 'Aún no hay vehículos con neumáticos.'}</div>`);
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
  $('flota-msg').textContent = 'Cargando…';
  const [est, res] = await Promise.all([
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_resumen_flota_cliente').select('*').order('nombre'),
  ]);
  if (est.error || res.error) { $('flota-msg').textContent = ''; showToast(userError(est.error || res.error), true); return; }
  estadoRows = est.rows;
  resumen = res.data || [];
  vehiculos = agruparVehiculos(estadoRows);
  fillClientes();
  $('flota-msg').textContent = est.truncated ? `Se muestran las primeras ${MAX_FILAS} posiciones: la lista está incompleta.` : '';
  render();
}

// Salta a la vista Vehículos con la búsqueda prellenada (patente o nombre).
registerActions({
  verVehiculoEnLista(texto) {
    switchView('vehiculos');
    const inp = $('search-vehiculos');
    if (inp) { inp.value = texto || ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  },
  loadFlota: () => load(),
});

export function init() {
  $('flota-cliente').addEventListener('change', render);
  $('flota-estado').addEventListener('change', render);
  $('flota-q').addEventListener('input', render);
}

registerView('flota', 'Flota', load);
