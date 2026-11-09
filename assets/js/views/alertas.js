// Centro de alertas: la alerta única «Neumático crítico» (v_alertas) con acciones (reconocer, silenciar, resolver, ver
// vehículo) y, para el cliente global, el nivel crítico editable. La RLS limita lo visible por rol; las transiciones
// van por RPC (alerta_reconocer, alerta_silenciar, alerta_resolver, alerta_configurar) que autorizan en la base.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado, miniVehiculo } from '../core/componentes.js';
import { fmtNum, fmtFecha, plural } from '../domain/formato.js';
import { isClienteMode, currentRol, currentSucursalId } from '../core/auth.js';
import { registerView, reloadActiveView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { contextoListo, filtrarFilas, filtrarConsulta } from '../core/seccional.js';
import { ordenarAlertas, filtrarAlertas } from '../domain/flota.js';
import {
  estadoAlerta, etiquetaEstadoAlerta, contarPorEstadoAlerta, filtrarPorEstadoAlerta, hastaSilencio, validarNota,
  validarUmbralCritico, validarHisteresis, traducirErrorAlerta, DIAS_SILENCIO,
} from '../domain/alertas.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, modeloMini, agruparPorVehiculo } from '../domain/posicion.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 10000;
const ESTADO_CHIP = { abierta: ['red', '✕'], reconocida: ['orange', '✓'], silenciada: ['gray', '–'] };
const chipEstado = e => chip(ESTADO_CHIP[e][0], etiquetaEstadoAlerta(e), ESTADO_CHIP[e][1]);
let alertas = [];
let clientes = [];
let tipos = new Map(); // tipo_ruedas por vehículo (chasis y nombre de la posición)
let porVeh = new Map(); // v_estado_neumaticos por vehículo: colores del mini vehículo (sin datos si no cargó)
let umbrales = null; // fila de clientes del perfil global (nivel crítico editable)
let pendiente = null; // alerta que se está resolviendo
let ocupado = false;

function filtros() {
  return {
    estado: $('alert-estado').value,
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
  const gestion = a.alerta_id === null || a.alerta_id === undefined ? '' : html`
    ${a.estado === 'reconocida' ? '' : html`<button class="btn ghost" data-action="alertasReconocer" data-args="${id}">Reconocer</button>`}
    ${estado === 'silenciada'
      ? html`<button class="btn ghost" data-action="alertasQuitarSilencio" data-args="${id}">Quitar silencio</button>`
      : html`<button class="btn ghost" data-action="alertasSilenciar" data-args="${id}">Silenciar ${DIAS_SILENCIO} días</button>`}
    <button class="btn ghost" data-action="alertasResolver" data-args="${id}">Resolver</button>`;
  return html`<div class="alert-acciones"><button class="btn ghost" data-action="verVehiculo" data-args="${arg}">Ver vehículo</button>${gestion}</div>`;
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
  setHtml($('alert-chips'), joinHtml(['abierta', 'reconocida', 'silenciada'].map(e => html`<button type="button" class="alert-chip ${e === f.estado ? 'active' : ''}" data-action="alertasEstado" data-args="${JSON.stringify([e])}">${chipEstado(e)} ${fmtNum(c[e])}</button>`)));
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

// Nivel crítico: solo el perfil de cliente global lo edita (el de sucursal y el admin no ven este bloque; el admin
// usa la ficha del cliente).
const puedeConfigurar = () => isClienteMode() && currentRol === 'cliente' && (currentSucursalId === null || currentSucursalId === undefined);
function pintarConfig() {
  const card = $('alert-config');
  card.hidden = !(puedeConfigurar() && umbrales);
  if (card.hidden) return;
  $('alert-umbral').value = String(umbrales.umbral_critico_mm).replace('.', ',');
  $('alert-histeresis').value = String(umbrales.alerta_histeresis_mm ?? '').replace('.', ',');
  $('alert-config-error').textContent = '';
}

export async function load() {
  $('alert-msg').textContent = '';
  setHtml($('alert-tbody'), filaEstado(6, estadoCarga('Cargando alertas…')));
  await contextoListo();
  const [al, res, est, vtp, cfg] = await Promise.all([
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    isClienteMode() ? Promise.resolve({ data: [], error: null }) : db.from('v_resumen_flota_cliente').select('cliente_id,nombre').order('nombre'),
    // Solo para colorear el mini vehículo: si falla, las ruedas salen sin datos y la lista sigue funcionando.
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
    fetchAll((from, to) => filtrarConsulta(db.from('vehiculos').select('id,tipo_ruedas')).order('id').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
    puedeConfigurar() ? db.from('clientes').select('id,umbral_critico_mm,umbral_bajo_mm,umbral_retiro_mm,alerta_histeresis_mm').limit(1) : Promise.resolve({ data: [], error: null }),
  ]);
  if (al.error || res.error) { showToast(userError(al.error || res.error), true); setHtml($('alert-tbody'), filaEstado(6, estadoError('', 'loadAlertas'))); return; }
  alertas = filtrarFilas(al.rows);
  tipos = vtp.error ? new Map() : new Map(vtp.rows.map(v => [v.id, v.tipo_ruedas]));
  porVeh = est.error ? new Map() : agruparPorVehiculo(est.rows);
  clientes = res.data || [];
  umbrales = cfg.error ? null : ((cfg.data || [])[0] || null);
  pintarConfig();
  fillFiltros();
  $('alert-msg').textContent = al.truncated ? `Se muestran las primeras ${MAX_FILAS} alertas: la lista está incompleta.` : '';
  render();
}

// Ejecuta una RPC de transición y recarga; los errores se traducen (42501, alerta ya resuelta, datos inválidos).
async function transicion(fn, params, aviso) {
  if (ocupado) return false;
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
    const sel = $('alert-estado');
    sel.value = sel.value === e ? '' : e;
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
    if (pendiente === null) return;
    const v = validarNota($('alerta-nota').value);
    if (!v.ok) { $('alerta-error').textContent = v.error; return; }
    if (await transicion('alerta_resolver', { p_alerta_id: pendiente, p_nota: v.nota }, 'Alerta resuelta')) {
      $('modal-alerta').classList.remove('show'); pendiente = null; reloadActiveView();
    }
  },
  async alertasGuardarConfig() {
    if (!umbrales) return;
    const u = validarUmbralCritico($('alert-umbral').value, { retiro: umbrales.umbral_retiro_mm, bajo: umbrales.umbral_bajo_mm });
    const h = validarHisteresis($('alert-histeresis').value);
    const err = !u.ok ? u.error : (!h.ok ? h.error : '');
    $('alert-config-error').textContent = err;
    if (err) return;
    $('alert-config-guardar').disabled = true;
    const ok = await transicion('alerta_configurar', { p_cliente_id: null, p_umbral_critico_mm: u.valor, p_histeresis_mm: h.valor }, 'Nivel crítico actualizado');
    $('alert-config-guardar').disabled = false;
    if (ok) reloadActiveView();
  },
  loadAlertas: () => load(),
});

export function init() {
  ['alert-estado', 'alert-cliente'].forEach(id => $(id).addEventListener('change', render));
}

registerView('alertas', 'Alertas', load);
