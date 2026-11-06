// Centro de alertas: lista desde v_alertas filtrable por severidad, tipo y cliente (RLS limita lo visible por rol).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado } from '../core/componentes.js';
import { fmtNum, plural } from '../domain/formato.js';
import { isClienteMode } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  ordenarAlertas, filtrarAlertas, contarPorSeveridad, tiposPresentes,
  severidadLabel, tipoLabel, SEVERIDAD_BADGE,
} from '../domain/flota.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 10000;
const SEV_SIMBOLO = { 3: '✕', 2: '▲', 1: 'i' };
const chipSeveridad = s => chip(SEVERIDAD_BADGE[s] || 'gray', severidadLabel(s), SEV_SIMBOLO[s] || 'i');
let alertas = [];
let clientes = [];

function filtros() {
  return {
    severidad: $('alert-severidad').value,
    tipo: $('alert-tipo').value,
    clienteId: isClienteMode() ? '' : ($('alert-cliente')?.value || ''),
  };
}

function fila(a, mostrarCliente) {
  const arg = JSON.stringify([a.patente || a.vehiculo_nombre || '']);
  const cli = mostrarCliente ? (clientes.find(c => String(c.cliente_id) === String(a.cliente_id)) || {}).nombre : '';
  return html`<tr data-severidad="${a.severidad}" data-tipo="${a.tipo}">
    <td>${chipSeveridad(a.severidad)}</td>
    <td>${tipoLabel(a.tipo)}</td>
    <td>${a.mensaje}</td>
    <td>${a.vehiculo_nombre}${a.patente ? html` <span class="dash-fleet-pat">${a.patente}</span>` : ''}${cli ? html`<div class="flota-cliente">${cli}</div>` : ''}</td>
    <td>${a.posicion ?? '—'}</td>
    <td>${a.ultima_medicion_at ? relDate(a.ultima_medicion_at) : 'nunca'}</td>
    <td><button class="btn ghost" data-action="verVehiculoEnLista" data-args="${arg}">Ver vehículo</button></td>
  </tr>`;
}

export function render() {
  const f = filtros();
  // Los chips cuentan con los filtros de tipo/cliente aplicados, pero sin el de severidad.
  const base = filtrarAlertas(alertas, { tipo: f.tipo, clienteId: f.clienteId });
  const c = contarPorSeveridad(base);
  setHtml($('alert-chips'), joinHtml([3, 2, 1].map(s => html`<button type="button" class="alert-chip ${String(s) === f.severidad ? 'active' : ''}" data-action="alertasSeveridad" data-args="${JSON.stringify([String(s)])}">${chipSeveridad(s)} ${fmtNum(c[s])}</button>`)));
  const lista = ordenarAlertas(filtrarAlertas(alertas, f));
  $('alert-count').textContent = plural(lista.length, 'alerta');
  const mostrarCliente = !isClienteMode() && !f.clienteId;
  setHtml($('alert-tbody'), lista.length
    ? joinHtml(lista.map(a => fila(a, mostrarCliente)))
    : filaEstado(7, alertas.length
      ? estadoVacio('Ninguna alerta coincide con los filtros', 'Probá quitando algún filtro.')
      : estadoVacio('No hay alertas activas', 'Buena noticia: ningún neumático ni vehículo requiere atención por ahora.')));
}

function fillFiltros() {
  const prev = $('alert-tipo').value;
  setHtml($('alert-tipo'), joinHtml([html`<option value="">Todos los tipos</option>`,
    ...tiposPresentes(alertas).map(t => html`<option value="${t}">${tipoLabel(t)}</option>`)]));
  $('alert-tipo').value = prev;
  const sel = $('alert-cliente');
  if (sel && !isClienteMode()) {
    const actual = sel.value;
    setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`,
      ...clientes.map(r => html`<option value="${r.cliente_id}">${r.nombre}</option>`)]));
    sel.value = actual;
  }
}

export async function load() {
  $('alert-msg').textContent = '';
  setHtml($('alert-tbody'), filaEstado(7, estadoCarga('Cargando alertas…')));
  const [al, res] = await Promise.all([
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').order('tipo').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    isClienteMode() ? Promise.resolve({ data: [], error: null }) : db.from('v_resumen_flota_cliente').select('cliente_id,nombre').order('nombre'),
  ]);
  if (al.error || res.error) { showToast(userError(al.error || res.error), true); setHtml($('alert-tbody'), filaEstado(7, estadoError('', 'loadAlertas'))); return; }
  alertas = al.rows;
  clientes = res.data || [];
  fillFiltros();
  $('alert-msg').textContent = al.truncated ? `Se muestran las primeras ${MAX_FILAS} alertas: la lista está incompleta.` : '';
  render();
}

registerActions({
  // Chip de severidad: alterna el filtro (clic de nuevo = quitar).
  alertasSeveridad(sev) {
    const sel = $('alert-severidad');
    sel.value = sel.value === sev ? '' : sev;
    render();
  },
  loadAlertas: () => load(),
});

export function init() {
  ['alert-severidad', 'alert-tipo', 'alert-cliente'].forEach(id => $(id).addEventListener('change', render));
}

registerView('alertas', 'Alertas', load);
