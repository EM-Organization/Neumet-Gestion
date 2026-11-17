// Centro de alertas: la alerta única «Neumático crítico» (v_alertas) con acciones (reconocer, silenciar, resolver, ver
// vehículo). La RLS limita lo visible por rol; las transiciones van por RPC (alerta_reconocer, alerta_silenciar,
// alerta_resolver) que autorizan en la base. El nivel crítico ya no se edita aquí: vive solo en Empresa > Umbrales.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado, miniVehiculo } from '../core/componentes.js';
import { fmtNum, fmtFecha, plural } from '../domain/formato.js';
import { isClienteMode, esAdmin, esAdminEmpresa } from '../core/auth.js';
import { registerView, reloadActiveView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { menuMas } from '../core/menu-mas.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { contextoListo, filtrarFilas, filtrarConsulta } from '../core/seccional.js';
import { ordenarAlertas, filtrarAlertas } from '../domain/flota.js';
import {
  estadoAlerta, etiquetaEstadoAlerta, contarPorEstadoAlerta, filtrarPorEstadoAlerta, hastaSilencio, validarNota,
  traducirErrorAlerta, DIAS_SILENCIO, CHIP_ESTADO_ALERTA,
} from '../domain/alertas.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, modeloMini, agruparPorVehiculo } from '../domain/posicion.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 10000;
const chipEstado = e => chip(CHIP_ESTADO_ALERTA[e][0], etiquetaEstadoAlerta(e), CHIP_ESTADO_ALERTA[e][1]);
// Un solo mecanismo de filtro por estado: los chips con su conteo (clic para filtrar, otro clic para quitar el filtro).
let estadoSel = '';
let alertas = [];
let clientes = [];
let tipos = new Map(); // tipo_ruedas por vehículo (chasis y nombre de la posición)
let porVeh = new Map(); // v_estado_neumaticos por vehículo: colores del mini vehículo (sin datos si no cargó)
let pendiente = null; // alerta que se está resolviendo
let ocupado = false;

function filtros() {
  return {
    estado: estadoSel,
    clienteId: isClienteMode() ? '' : ($('alert-cliente')?.value || ''),
  };
}

// Posición de la alerta: mini vehículo con la rueda resaltada y su nombre en texto; «—» si la alerta es del vehículo.
function celdaPosicion(a) {
  if (a.posicion === null || a.posicion === undefined) return '—';
  return html`<div class="pos-mini">${miniVehiculo(modeloMini(porVeh.get(a.vehiculo_id), { destacadas: [a.posicion], tipo: tipos.get(a.vehiculo_id) }))}<span>${nombrePosicion(a.posicion, tipos.get(a.vehiculo_id))}</span></div>`;
}

function acciones(a, estado) {
  const arg = JSON.stringify(a.posicion === null || a.posicion === undefined ? [a.vehiculo_id] : [a.vehiculo_id, a.posicion]);
  const id = JSON.stringify([a.alerta_id]);
  // El equipo Neumet no opera dentro de una empresa (docs/17 P1): ve las alertas sin reconocer, silenciar ni resolver.
  // Reconocer es lo frecuente y queda a la vista; Silenciar y Resolver (más raros) van en «Más».
  const gestion = esAdmin() || a.alerta_id === null || a.alerta_id === undefined ? '' : html`
    ${a.estado === 'reconocida' ? '' : html`<button type="button" class="btn stk-btn stk-primaria" data-action="alertasReconocer" data-args="${id}">Reconocer</button>`}
    ${menuMas({ etiqueta: `Más acciones de la alerta de ${etiquetaCoche(a.vehiculo_nombre)}`, items: [
      estado === 'silenciada'
        ? { label: 'Quitar silencio', action: 'alertasQuitarSilencio', args: [a.alerta_id] }
        : { label: `Silenciar ${DIAS_SILENCIO} días`, action: 'alertasSilenciar', args: [a.alerta_id] },
      { label: 'Resolver', action: 'alertasResolver', args: [a.alerta_id] },
    ] })}`;
  return html`<div class="alert-acciones">${gestion}<button type="button" class="btn ghost stk-btn alert-ver" data-action="verVehiculo" data-args="${arg}">Ver vehículo</button></div>`;
}

function fila(a, mostrarCliente) {
  const cli = mostrarCliente ? (clientes.find(c => String(c.cliente_id) === String(a.cliente_id)) || {}).nombre : '';
  const estado = estadoAlerta(a);
  const silencio = estado === 'silenciada' ? html`<div class="flota-cliente">Hasta ${fmtFecha(a.silenciada_hasta)}</div>` : '';
  return html`<tr data-severidad="${a.severidad}" data-tipo="${a.tipo}" data-estado="${estado}">
    <td data-label="Estado">${chipEstado(estado)}${silencio}</td>
    <td data-label="Mensaje">${a.mensaje}</td>
    <td data-label="Vehículo">${etiquetaCoche(a.vehiculo_nombre)}${a.patente ? html` <span class="dash-fleet-pat">${a.patente}</span>` : ''}${cli ? html`<div class="flota-cliente">${cli}</div>` : ''}</td>
    <td data-label="Posición">${celdaPosicion(a)}</td>
    <td data-label="Última medición">${a.ultima_medicion_at ? relDate(a.ultima_medicion_at) : 'nunca'}</td>
    <td data-label="Acciones">${acciones(a, estado)}</td>
  </tr>`;
}

export function render() {
  const f = filtros();
  // Los chips cuentan con el filtro de cliente aplicado, pero sin el de estado.
  const base = filtrarAlertas(alertas, { clienteId: f.clienteId });
  const c = contarPorEstadoAlerta(base);
  setHtml($('alert-chips'), joinHtml(['abierta', 'reconocida', 'silenciada'].map(e => html`<button type="button" class="alert-chip ${e === f.estado ? 'active' : ''}" aria-pressed="${String(e === f.estado)}" data-action="alertasEstado" data-args="${JSON.stringify([e])}">${chipEstado(e)} ${fmtNum(c[e])}</button>`)));
  const lista = ordenarAlertas(filtrarPorEstadoAlerta(base, f.estado));
  $('alert-count').textContent = plural(lista.length, 'alerta');
  const mostrarCliente = !isClienteMode() && !f.clienteId;
  setHtml($('alert-tbody'), lista.length
    ? joinHtml(lista.map(a => fila(a, mostrarCliente)))
    : filaEstado(6, alertas.length
      ? estadoVacio('Ninguna alerta coincide con el filtro')
      : estadoVacio('Sin alertas críticas abiertas')));
}

function fillFiltros() {
  const sel = $('alert-cliente');
  if (sel && !isClienteMode()) {
    const actual = sel.value;
    setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`,
      ...clientes.map(r => html`<option value="${r.cliente_id}">${r.nombre}</option>`)]));
    sel.value = actual;
  }
}

// Aviso para el administrador de empresa: el nivel crítico se edita solo en Empresa > Umbrales.
const pintarAviso = () => { $('alert-umbral-aviso').hidden = !esAdminEmpresa(); };

export async function load() {
  $('alert-msg').textContent = '';
  setHtml($('alert-tbody'), filaEstado(6, estadoCarga('Cargando alertas…')));
  await contextoListo();
  const [al, res, est, vtp] = await Promise.all([
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    isClienteMode() ? Promise.resolve({ data: [], error: null }) : db.from('v_resumen_flota_cliente').select('cliente_id,nombre').order('nombre'),
    // Solo para colorear el mini vehículo: si falla, las ruedas salen sin datos y la lista sigue funcionando.
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
    fetchAll((from, to) => filtrarConsulta(db.from('vehiculos').select('id,tipo_ruedas')).order('id').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
  ]);
  pintarAviso(); // antes del retorno por error: el aviso no depende de que la lista cargue
  if (al.error || res.error) { showToast(userError(al.error || res.error), true); setHtml($('alert-tbody'), filaEstado(6, estadoError('', 'loadAlertas'))); return; }
  alertas = filtrarFilas(al.rows);
  tipos = vtp.error ? new Map() : new Map(vtp.rows.map(v => [v.id, v.tipo_ruedas]));
  porVeh = est.error ? new Map() : agruparPorVehiculo(est.rows);
  clientes = res.data || [];
  fillFiltros();
  $('alert-msg').textContent = al.truncated ? `Se muestran las primeras ${MAX_FILAS} alertas: la lista está incompleta.` : '';
  render();
}

// Ejecuta una RPC de transición y recarga; los errores se traducen (42501, alerta ya resuelta, datos inválidos).
async function transicion(fn, params, aviso) {
  if (ocupado || esAdmin()) return false;
  ocupado = true;
  try {
    const { error } = await db.rpc(fn, params);
    if (error) throw error;
    showToast(aviso);
    return true;
  } catch (e) {
    console.error(e);
    showToast(traducirErrorAlerta(e), true);
    return false;
  } finally { ocupado = false; }
}

registerActions({
  alertasEstado(e) {
    estadoSel = estadoSel === e ? '' : e;
    render();
  },
  async alertasReconocer(id) {
    if (await transicion('alerta_reconocer', { p_alerta_id: Number(id), p_nota: null }, 'Alerta reconocida')) reloadActiveView();
  },
  async alertasSilenciar(id) {
    if (await transicion('alerta_silenciar', { p_alerta_id: Number(id), p_hasta: hastaSilencio(), p_motivo: null }, `Alerta silenciada ${DIAS_SILENCIO} días`)) reloadActiveView();
  },
  async alertasQuitarSilencio(id) {
    if (await transicion('alerta_silenciar', { p_alerta_id: Number(id), p_hasta: null, p_motivo: null }, 'Silencio quitado')) reloadActiveView();
  },
  alertasResolver(id) {
    if (esAdmin()) return;
    const a = alertas.find(x => String(x.alerta_id) === String(id));
    pendiente = Number(id);
    $('alerta-sub').textContent = a ? [etiquetaCoche(a.vehiculo_nombre), a.mensaje].filter(Boolean).join(' · ') : '';
    $('alerta-nota').value = '';
    $('alerta-error').textContent = '';
    $('alerta-confirmar').disabled = false;
    $('modal-alerta').classList.add('show');
  },
  alertasCerrarResolver() { $('modal-alerta').classList.remove('show'); pendiente = null; },
  async alertasConfirmarResolver() {
    if (pendiente === null || esAdmin()) return;
    const v = validarNota($('alerta-nota').value);
    if (!v.ok) { $('alerta-error').textContent = v.error; return; }
    if (await transicion('alerta_resolver', { p_alerta_id: pendiente, p_nota: v.nota }, 'Alerta resuelta')) {
      $('modal-alerta').classList.remove('show'); pendiente = null; reloadActiveView();
    }
  },
  loadAlertas: () => load(),
});

export function init() {
  $('alert-cliente').addEventListener('change', render);
}

registerView('alertas', 'Alertas', load);
