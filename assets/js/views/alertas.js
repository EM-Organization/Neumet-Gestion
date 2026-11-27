// Centro de alertas: la alerta única «Neumático crítico» (v_alertas) con acciones (reconocer, silenciar, resolver, ver
// vehículo). La RLS limita lo visible por rol; las transiciones van por RPC (alerta_reconocer, alerta_silenciar,
// alerta_resolver) que autorizan en la base. El nivel crítico ya no se edita aquí: vive solo en Empresa > Umbrales.
import { tipoLayout } from '../domain/distribucion.js';
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado, miniVehiculo } from '../core/componentes.js';
import { fmtNum, fmtFecha, fmtFechaHora, plural, comaDecimal } from '../domain/formato.js';
import { isClienteMode, esAdmin, esAdminEmpresa } from '../core/auth.js';
import { registerView, reloadActiveView, switchView } from '../core/nav.js';
import { registerActions, runAction } from '../core/actions.js';
import { menuMas } from '../core/menu-mas.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { contextoListo, filtrarFilas, filtrarConsulta, hayFiltroSeccional, sucursalSeleccionada, nombreSucursal } from '../core/seccional.js';
import { enSucursal, AYUDA_TODAS_SUCURSALES } from '../domain/seccional.js';
import { ordenarAlertas, filtrarAlertas } from '../domain/flota.js';
import {
  estadoAlerta, etiquetaEstadoAlerta, contarPorEstadoAlerta, filtrarPorEstadoAlerta, hastaSilencio, validarNota,
  traducirErrorAlerta, DIAS_SILENCIO, CHIP_ESTADO_ALERTA, presentacionAlerta, detalleAlerta, tiempoRelativo,
} from '../domain/alertas.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, modeloMini, agruparPorVehiculo } from '../domain/posicion.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 10000;
const chipEstado = e => chip(CHIP_ESTADO_ALERTA[e][0], etiquetaEstadoAlerta(e), CHIP_ESTADO_ALERTA[e][1]);
// Un solo filtro por estado, con chips de una sola elección. Arranca en «Abiertas»: es lo que hay que atender.
let estadoSel = 'abierta';
const ETIQUETA_FILTRO = { '': 'Todas', abierta: 'Abiertas', reconocida: 'Reconocidas', silenciada: 'Silenciadas' };
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

// Vehículo y posición en una celda de dos líneas: el mini vehículo con la rueda resaltada a la izquierda; a la derecha, el
// vehículo (enlace a su ficha) con su matrícula y, debajo, el nombre de la posición. Una alerta del vehículo entero no
// lleva mini ni posición.
function celdaVehiculo(a, cli) {
  const conRueda = a.posicion !== null && a.posicion !== undefined;
  const mini = conRueda ? miniVehiculo(modeloMini(porVeh.get(a.vehiculo_id), { destacadas: [a.posicion], tipo: tipos.get(a.vehiculo_id) })) : '';
  return html`<div class="pos-mini alert-vp">${mini}<div>
    <button type="button" class="alert-veh" data-action="verVehiculo" data-args="${JSON.stringify(argPosicion(a))}">${etiquetaCoche(a.vehiculo_nombre)}</button>${a.patente ? html` <span class="dash-fleet-pat">${a.patente}</span>` : ''}
    ${conRueda ? html`<div class="alert-pos">${nombrePosicion(a.posicion, tipos.get(a.vehiculo_id))}</div>` : ''}${cli ? html`<div class="flota-cliente">${cli}</div>` : ''}
  </div></div>`;
}

// Argumentos de verVehiculo: el vehículo y, si la alerta es de una rueda, su posición.
const argPosicion = a => (a.posicion === null || a.posicion === undefined ? [a.vehiculo_id] : [a.vehiculo_id, a.posicion]);

// El equipo Neumet no opera dentro de una empresa (docs/17 P1), y una alerta sin id no tiene sobre qué actuar.
const puedeGestionar = a => !esAdmin() && a.alerta_id !== null && a.alerta_id !== undefined;

// Una sola acción visible por fila: Reconocer, y solo si la alerta está abierta (una silenciada no se reconoce). Silenciar,
// resolver y ver el vehículo van en «Más», que solo ofrece lo que el rol puede hacer.
function menuAcciones(a, estado) {
  const items = [];
  if (puedeGestionar(a)) {
    items.push(estado === 'silenciada'
      ? { label: 'Quitar silencio', action: 'alertasQuitarSilencio', args: [a.alerta_id] }
      : { label: `Silenciar ${DIAS_SILENCIO} días`, action: 'alertasSilenciar', args: [a.alerta_id] },
    { label: 'Resolver', action: 'alertasResolver', args: [a.alerta_id] });
  }
  items.push({ label: 'Ver vehículo', action: 'verVehiculo', args: argPosicion(a) });
  return menuMas({ etiqueta: `Más acciones de la alerta de ${etiquetaCoche(a.vehiculo_nombre)}`, items });
}

function fila(a, mostrarCliente) {
  const cli = mostrarCliente ? (clientes.find(c => String(c.cliente_id) === String(a.cliente_id)) || {}).nombre : '';
  const estado = estadoAlerta(a);
  // El tipo lo pinta presentacionAlerta: rojo solo para el límite y siempre con texto y símbolo (docs/14). El umbral no se
  // repite aquí: va una vez, en el párrafo de ayuda de la tabla.
  const tipo = presentacionAlerta(a);
  const dato = comaDecimal(detalleAlerta(a));
  // El estado solo se muestra cuando la alerta no está abierta: la abierta es el caso normal y no necesita rótulo.
  const estadoHtml = estado === 'abierta' ? '' : html`<div class="alerta-estado">${chipEstado(estado)}${estado === 'silenciada' ? html`<div class="flota-cliente">Hasta ${fmtFecha(a.silenciada_hasta)}</div>` : ''}</div>`;
  const reconocer = puedeGestionar(a) && estado === 'abierta'
    ? html`<button type="button" class="btn ghost stk-btn" data-action="alertasReconocer" data-args="${JSON.stringify([a.alerta_id])}">Reconocer</button>`
    : '';
  return html`<tr data-severidad="${a.severidad}" data-tipo="${a.tipo}" data-estado="${estado}" data-vehiculo="${a.vehiculo_id}" data-posicion="${a.posicion ?? ''}">
    <td data-label="Vehículo y posición">${celdaVehiculo(a, cli)}</td>
    <td data-label="Problema"><span class="alerta-tipo">${chip(tipo.color, tipo.etiqueta, tipo.simbolo)}</span>${dato ? html` <span class="alerta-dato">${dato}</span>` : ''}${estadoHtml}</td>
    <td data-label="Abierta hace" title="${fmtFechaHora(a.abierta_at)}">${tiempoRelativo(a.abierta_at)}</td>
    <td data-label="Reconocer">${reconocer}</td>
    <td data-label="Más">${menuAcciones(a, estado)}</td>
  </tr>`;
}

// La fila entera abre la ficha de su vehículo, con la rueda de la alerta preseleccionada. El oyente va en el tbody y no con
// data-action en el <tr>: capturaría también los clics de «Más». Los botones, enlaces, el menú «Más» y los campos hacen lo suyo.
function abrirFila(e) {
  if (e.target.closest('button, a, [data-menu-mas], input')) return;
  const tr = e.target.closest('tr[data-vehiculo]');
  if (!tr) return;
  const pos = tr.dataset.posicion;
  runAction('verVehiculo', pos ? [Number(tr.dataset.vehiculo), Number(pos)] : [Number(tr.dataset.vehiculo)]);
}

export function render() {
  const f = filtros();
  // Los chips cuentan con el filtro de cliente aplicado, pero sin el de estado.
  const base = filtrarAlertas(alertas, { clienteId: f.clienteId });
  const c = contarPorEstadoAlerta(base);
  // «Todas» sigue disponible; cuenta con el filtro de cliente, como los demás chips.
  setHtml($('alert-chips'), joinHtml(['', 'abierta', 'reconocida', 'silenciada'].map(e => {
    const on = e === f.estado;
    const n = e ? c[e] : base.length;
    return html`<button type="button" class="alert-chip ${on ? 'active' : ''}" aria-pressed="${String(on)}" data-action="alertasEstado" data-args="${JSON.stringify([e])}">${ETIQUETA_FILTRO[e]} ${fmtNum(n)}</button>`;
  })));
  const lista = ordenarAlertas(filtrarPorEstadoAlerta(base, f.estado));
  $('alert-count').textContent = plural(lista.length, 'alerta');
  const mostrarCliente = !isClienteMode() && !f.clienteId;
  setHtml($('alert-tbody'), lista.length
    ? joinHtml(lista.map(a => fila(a, mostrarCliente)))
    : filaEstado(5, alertas.length
      ? estadoVacio('Ninguna alerta coincide con el filtro')
      : hayFiltroSeccional() ? estadoVacio(enSucursal('Sin alertas de desgaste límite abiertas', nombreSucursal(sucursalSeleccionada())), AYUDA_TODAS_SUCURSALES)
      : estadoVacio('Sin alertas de desgaste límite abiertas')));
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

// Aviso para el administrador de empresa. El texto va desde aquí porque el HTML todavía trae el de la versión anterior
// (solo «desgaste límite»); al corregir el HTML, esta asignación sobra.
const AVISO_UMBRALES = 'Los umbrales de las alertas se ajustan en Empresa > Umbrales.';
const pintarAviso = () => {
  const aviso = $('alert-umbral-aviso');
  aviso.textContent = AVISO_UMBRALES;
  aviso.hidden = !esAdminEmpresa();
};

export async function load() {
  $('alert-msg').textContent = '';
  setHtml($('alert-tbody'), filaEstado(5, estadoCarga('Cargando alertas…')));
  await contextoListo();
  const [al, res, est, vtp] = await Promise.all([
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').range(from, to),
      { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    isClienteMode() ? Promise.resolve({ data: [], error: null }) : db.from('v_resumen_flota_cliente').select('cliente_id,nombre').order('nombre'),
    // Solo para colorear el mini vehículo: si falla, las ruedas salen sin datos y la lista sigue funcionando.
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
    fetchAll((from, to) => filtrarConsulta(db.from('vehiculos').select('id,tipo_ruedas,distribucion')).order('id').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS * 2 }),
  ]);
  pintarAviso(); // antes del retorno por error: el aviso no depende de que la lista cargue
  if (al.error || res.error) { showToast(userError(al.error || res.error), true); setHtml($('alert-tbody'), filaEstado(5, estadoError('', 'loadAlertas'))); return; }
  alertas = filtrarFilas(al.rows);
  tipos = vtp.error ? new Map() : new Map(vtp.rows.map(v => [v.id, tipoLayout(v)]));
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
    estadoSel = e;
    render();
  },
  // Desde Inicio: abre Alertas en «Abiertas», aunque antes se hubiera elegido otro filtro.
  alertasVerAbiertas() {
    estadoSel = 'abierta';
    switchView('alertas');
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
    $('alerta-sub').textContent = a ? [etiquetaCoche(a.vehiculo_nombre), comaDecimal(detalleAlerta(a))].filter(Boolean).join(' · ') : '';
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
  // Cambiar de cliente vuelve al filtro «Abiertas».
  $('alert-cliente').addEventListener('change', () => { estadoSel = 'abierta'; render(); });
  $('alert-tbody').addEventListener('click', abrirFila);
}

registerView('alertas', 'Alertas', load);
