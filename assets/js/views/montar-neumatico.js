// Montar y retirar neumáticos sin reemplazo desde el detalle del vehículo. Un coche creado sin neumáticos se carga
// posición por posición («Cargar neumáticos»); «Retirar neumático» deja la posición libre y corrige un montaje equivocado.
// Toda la escritura pasa por las RPC atómicas neumatico_montar y neumatico_desmontar (la autorización se verifica en la
// base: otro cliente u otra sucursal reciben «permiso denegado»).
// Acciones: neumatico-montar (vehiculoId, posicion opcional), neumatico-retirar (vehiculoId, posicion).
// Al terminar emite el evento DOM «neumet:neumatico-cambiado» y recarga la vista activa, igual que el cambio de neumático.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin, isClienteMode, currentSucursalId } from '../core/auth.js';
import { reloadActiveView } from '../core/nav.js';
import { etiquetaCoche } from '../domain/coche.js';
import { fmtNum, plural } from '../domain/formato.js';
import { etiquetaCondicion, nombreUbicacion, SIN_SUCURSAL } from '../domain/stock-cubiertas.js';
import {
  DESTINOS_RETIRO, MAX_LISTA, posicionesLibres, siguienteLibre, etiquetaPosicion, cubiertasParaMontar,
  validarMontaje, validarRetiro, traducirErrorMontaje, traducirErrorRetiro,
} from '../domain/montaje.js';
import { POS_AUXILIO } from '../domain/vehiculo-diagrama.js';
import { EVENTO_CAMBIO } from './cambio-neumatico.js';

const $ = id => document.getElementById(id);
const val = id => { const el = $(id); return el ? el.value : ''; };
const nombrePos = pos => (Number(pos) === POS_AUXILIO ? 'el auxilio' : `P${pos}`);
const puedeUsarStock = () => esAdmin() || (isClienteMode() && currentSucursalId === null);

let mont = null; // {veh, ocupadas, libres, cubiertas, sucursales, puedeStock, origen, cubiertaId, montados}
let ret = null;  // {veh, neum, sucursales, puedeStock}
let ocupado = false;

function notificarCambio(detalle) {
  document.dispatchEvent(new CustomEvent(EVENTO_CAMBIO, { detail: detalle }));
  try { reloadActiveView(); } catch (e) { console.error(e); }
}

// ── Montar ──────────────────────────────────────────────────────────────────────────────────────────────────────
function estadoMontar() {
  return {
    vehiculoId: mont.veh.id, posicion: val('mont-pos'), libres: mont.libres, origen: mont.origen,
    cubiertaId: mont.cubiertaId, cubiertas: mont.cubiertas,
    marca: val('mont-marca'), modelo: val('mont-modelo'), quema: val('mont-quema'), kmPrevios: val('mont-km-previos'),
    fechaCompra: val('mont-fecha'), precio: val('mont-precio'), vida: val('mont-vida'),
    odometro: val('mont-odo'), odometroActual: mont.veh.odometro_km,
  };
}

function pintarLista() {
  const filtradas = cubiertasParaMontar(mont.cubiertas, val('mont-buscar'));
  const vistas = filtradas.slice(0, MAX_LISTA);
  if (mont.cubiertaId !== null && !filtradas.some(c => String(c.id) === String(mont.cubiertaId))) mont.cubiertaId = null;
  if (!vistas.length) {
    setHtml($('mont-lista'), html`<div class="mont-vacio">${mont.cubiertas.length ? 'Ninguna cubierta coincide. Cambiar la búsqueda.' : 'Sin cubiertas en stock. Usar «Cubierta nueva».'}</div>`);
    return;
  }
  setHtml($('mont-lista'), html`${vistas.map(c => html`<label class="mont-fila"><input type="radio" name="mont-cubierta" value="${c.id}" ${String(mont.cubiertaId) === String(c.id) ? 'checked' : ''} data-change="neumatico-montar-cubierta"/>
    <span class="mont-quema">${c.numero_quema || 'Sin quema'}</span>
    <span class="mont-desc">${[c.marca, c.modelo].filter(Boolean).join(' ') || 'Sin marca'}</span>
    <span class="mont-meta">${etiquetaCondicion(c.condicion)} · ${nombreUbicacion(c.sucursal_id, mont.sucursales)}</span></label>`)}${
    filtradas.length > vistas.length ? html`<div class="mont-vacio">Se muestran ${vistas.length} de ${filtradas.length}. Usar el buscador para acotar.</div>` : ''}`);
}

function actualizarMontar() {
  const stock = mont.origen === 'stock';
  $('mont-panel-stock').hidden = !stock;
  $('mont-panel-nuevo').hidden = stock;
  for (const [id, on] of [['mont-tab-stock', stock], ['mont-tab-nuevo', !stock]]) {
    const t = $(id); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
  }
  const r = validarMontaje(estadoMontar());
  $('mont-resumen').textContent = r.ok ? r.resumen : 'Completar los datos para ver el resumen';
  $('mont-error').textContent = '';
  return r;
}

function pintarPosiciones(posicion) {
  setHtml($('mont-pos'), joinHtml(mont.libres.map(p => html`<option value="${p.posicion}">${etiquetaPosicion(p)}</option>`)));
  $('mont-pos').value = String(posicion);
  $('mont-sub').textContent = `${etiquetaCoche(mont.veh.nombre)} · ${plural(mont.libres.length, 'posición libre', 'posiciones libres')}`;
}

function limpiarFormulario() {
  mont.cubiertaId = null;
  for (const id of ['mont-buscar', 'mont-marca', 'mont-modelo', 'mont-quema', 'mont-fecha', 'mont-precio', 'mont-odo']) $(id).value = '';
  $('mont-km-previos').value = '0'; $('mont-vida').value = '0';
  const odo = mont.veh.odometro_km;
  $('mont-odo-hint').textContent = odo !== null && odo !== undefined
    ? `Opcional. No puede ser menor al actual (${fmtNum(odo)} km).` : 'Opcional. Lectura actual del vehículo, aparte de los km del neumático.';
}

async function abrirMontar(vehiculoId, posicion) {
  if (!Number.isInteger(vehiculoId)) { showToast('Elegir el vehículo', true); return; }
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,tipo_ruedas,odometro_km').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select('id,posicion,estado').eq('vehiculo_id', vehiculoId),
  ]);
  if (rv.error || rn.error || !rv.data) { console.error(rv.error || rn.error); showToast('No se pudo cargar el vehículo. Reintentar', true); return; }
  const veh = rv.data;
  const ocupadas = (rn.data || []).filter(n => n.estado === 'montado').map(n => n.posicion);
  const libres = posicionesLibres(ocupadas, veh.tipo_ruedas);
  if (!libres.length) { showToast('Todas las posiciones tienen un neumático montado'); return; }
  const puedeStock = puedeUsarStock();
  const [rc, rs] = await Promise.all([
    puedeStock
      ? db.from('neumaticos').select('id,numero_quema,marca,modelo,condicion,sucursal_id,vehiculo_id,estado')
        .is('vehiculo_id', null).eq('cliente_id', veh.cliente_id).order('numero_quema')
      : Promise.resolve({ data: [] }),
    puedeStock ? db.from('sucursales').select('id,nombre').eq('cliente_id', veh.cliente_id).order('nombre') : Promise.resolve({ data: [] }),
  ]);
  const cubiertas = rc.error ? [] : (rc.data || []);
  mont = { veh, ocupadas, libres, cubiertas, sucursales: rs.error ? [] : (rs.data || []), puedeStock, origen: 'nuevo', cubiertaId: null, montados: 0 };
  mont.origen = puedeStock && cubiertas.length ? 'stock' : 'nuevo';
  $('mont-tab-stock').hidden = !puedeStock;
  $('mont-aviso').textContent = '';
  $('mont-cerrar').textContent = 'Cancelar';
  $('mont-confirmar').disabled = false;
  const inicial = libres.find(p => p.posicion === Number(posicion)) || libres[0];
  pintarPosiciones(inicial.posicion);
  limpiarFormulario();
  pintarLista();
  actualizarMontar();
  $('modal-montar').classList.add('show');
}

function cerrarMontar() {
  $('modal-montar').classList.remove('show');
  mont = null;
}

async function confirmarMontar() {
  if (!mont || ocupado) return;
  const r = validarMontaje(estadoMontar());
  if (!r.ok) { $('mont-error').textContent = r.error; showToast(r.error, true); return; }
  ocupado = true; $('mont-confirmar').disabled = true;
  try {
    const { data, error } = await db.rpc('neumatico_montar', r.params);
    if (error) throw error;
    const pos = r.params.p_posicion;
    const vehiculoId = mont.veh.id;
    mont.montados += 1;
    mont.ocupadas.push(pos);
    if (r.params.p_cubierta_id) mont.cubiertas = mont.cubiertas.filter(c => c.id !== r.params.p_cubierta_id);
    if (data && data.odometro_km !== null && data.odometro_km !== undefined) mont.veh.odometro_km = data.odometro_km;
    mont.libres = posicionesLibres(mont.ocupadas, mont.veh.tipo_ruedas);
    showToast(`Neumático montado en ${nombrePos(pos)}`);
    document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
    notificarCambio({ vehiculoId, posicion: pos, montaje: data });
    // Sigue con la siguiente posición libre sin cerrar el flujo; al no quedar ninguna, se cierra.
    const sig = siguienteLibre(mont.libres, pos);
    if (!sig) { cerrarMontar(); showToast('Todas las posiciones tienen un neumático montado'); return; }
    pintarPosiciones(sig.posicion);
    limpiarFormulario();
    pintarLista();
    $('mont-aviso').textContent = `Montado en ${nombrePos(pos)}. Siguiente posición libre: ${etiquetaPosicion(sig)}.`;
    $('mont-cerrar').textContent = 'Terminar';
    actualizarMontar();
    const primero = mont.origen === 'stock' ? $('mont-buscar') : $('mont-marca');
    if (primero) primero.focus();
  } catch (e) {
    console.error(e);
    const msg = traducirErrorMontaje(e);
    $('mont-error').textContent = msg;
    showToast(msg, true);
  } finally { ocupado = false; if ($('mont-confirmar')) $('mont-confirmar').disabled = false; }
}

// ── Retirar ─────────────────────────────────────────────────────────────────────────────────────────────────────
function estadoRetirar() {
  const d = document.querySelector('input[name="ret-destino"]:checked');
  return {
    vehiculoId: ret.veh.id, posicion: ret.neum.posicion, neum: ret.neum, destino: d ? d.value : '', motivo: val('ret-motivo'),
    sucursalStock: val('ret-suc'), quema: val('ret-quema'), odometro: val('ret-odo'), odometroActual: ret.veh.odometro_km,
    puedeStock: ret.puedeStock,
  };
}

function actualizarRetirar() {
  const f = estadoRetirar();
  const stock = f.destino === 'almacenado';
  $('ret-stock-wrap').style.display = stock ? 'block' : 'none';
  $('ret-quema-wrap').style.display = stock && !ret.neum.numero_quema ? '' : 'none';
  $('ret-motivo-opt').textContent = f.destino === 'baja' ? '(obligatorio)' : '(opcional)';
  const r = validarRetiro(f);
  $('ret-resumen').textContent = r.ok ? r.resumen : 'Completar los datos para ver el resumen';
  $('ret-error').textContent = '';
  return r;
}

async function abrirRetirar(vehiculoId, posicion) {
  if (!Number.isInteger(vehiculoId) || !Number.isInteger(posicion)) { showToast('Elegir el neumático a retirar', true); return; }
  const puedeStock = puedeUsarStock();
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,odometro_km').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select('id,vehiculo_id,posicion,marca,modelo,idneumatico,vida,estado,numero_quema').eq('vehiculo_id', vehiculoId).eq('posicion', posicion).maybeSingle(),
  ]);
  if (rv.error || rn.error || !rv.data) { console.error(rv.error || rn.error); showToast('No se pudo cargar el neumático. Reintentar', true); return; }
  const neum = rn.data;
  if (!neum || neum.estado !== 'montado') { showToast(`No hay un neumático montado en ${nombrePos(posicion)}`, true); return; }
  const rs = puedeStock ? await db.from('sucursales').select('id,nombre').eq('cliente_id', rv.data.cliente_id).order('nombre') : { data: [] };
  ret = { veh: rv.data, neum, sucursales: rs.error ? [] : (rs.data || []), puedeStock };
  const destinos = DESTINOS_RETIRO.filter(d => puedeStock || d.id !== 'almacenado');
  $('ret-sub').textContent = etiquetaCoche(rv.data.nombre);
  setHtml($('ret-actual'), html`<div>Neumático en <strong>${posicion === POS_AUXILIO ? 'auxilio' : `P${posicion}`}</strong>:
    <strong>${[neum.marca, neum.modelo].filter(Boolean).join(' ') || 'Sin marca'}</strong>${neum.numero_quema ? html` · quema ${neum.numero_quema}` : ''}${neum.vida ? html` · recauchutado ${neum.vida}` : ''}</div>`);
  setHtml($('ret-destinos'), joinHtml(destinos.map((d, i) => html`<label class="cambio-op"><input type="radio" name="ret-destino" value="${d.id}" ${i === 0 ? 'checked' : ''}
    data-change="neumatico-retirar-resumen"/> <span>${d.label}</span></label>`)));
  setHtml($('ret-suc'), joinHtml([html`<option value="">${SIN_SUCURSAL}</option>`, ret.sucursales.map(s => html`<option value="${s.id}">${s.nombre}</option>`)]));
  for (const id of ['ret-motivo', 'ret-quema', 'ret-odo']) $(id).value = '';
  const odo = rv.data.odometro_km;
  $('ret-odo-hint').textContent = odo !== null && odo !== undefined ? `Opcional. No puede ser menor al actual (${fmtNum(odo)} km).` : 'Opcional. Lectura actual del vehículo.';
  $('ret-confirmar').disabled = false;
  actualizarRetirar();
  $('modal-retirar').classList.add('show');
}

function cerrarRetirar() { $('modal-retirar').classList.remove('show'); ret = null; }

async function confirmarRetirar() {
  if (!ret || ocupado) return;
  const r = validarRetiro(estadoRetirar());
  if (!r.ok) { $('ret-error').textContent = r.error; showToast(r.error, true); return; }
  ocupado = true; $('ret-confirmar').disabled = true;
  try {
    const { data, error } = await db.rpc('neumatico_desmontar', r.params);
    if (error) throw error;
    const pos = r.params.p_posicion, vehiculoId = r.params.p_vehiculo_id;
    cerrarRetirar();
    showToast(`Neumático retirado de ${nombrePos(pos)}`);
    document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
    notificarCambio({ vehiculoId, posicion: pos, retiro: data });
  } catch (e) {
    console.error(e);
    const msg = traducirErrorRetiro(e);
    $('ret-error').textContent = msg;
    showToast(msg, true);
    if ($('ret-confirmar')) $('ret-confirmar').disabled = false;
  } finally { ocupado = false; }
}

// ── Acciones ────────────────────────────────────────────────────────────────────────────────────────────────────
ACTIONS['neumatico-montar'] = async function (vehiculoId, posicion) {
  await abrirMontar(Number(vehiculoId), posicion === undefined || posicion === null ? null : Number(posicion));
};
ACTIONS['neumatico-montar-cerrar'] = function () { cerrarMontar(); };
ACTIONS['neumatico-montar-resumen'] = function () { if (mont) actualizarMontar(); };
ACTIONS['neumatico-montar-pos'] = function () { if (mont) actualizarMontar(); };
ACTIONS['neumatico-montar-cubierta'] = function (id) { if (mont) { mont.cubiertaId = Number(id); actualizarMontar(); } };
ACTIONS['neumatico-montar-tab'] = function (origen) {
  if (!mont || (origen === 'stock' && !mont.puedeStock)) return;
  mont.origen = origen === 'stock' ? 'stock' : 'nuevo';
  actualizarMontar();
};
ACTIONS['neumatico-montar-confirmar'] = confirmarMontar;

ACTIONS['neumatico-retirar'] = async function (vehiculoId, posicion) { await abrirRetirar(Number(vehiculoId), Number(posicion)); };
ACTIONS['neumatico-retirar-cerrar'] = function () { cerrarRetirar(); };
ACTIONS['neumatico-retirar-resumen'] = function () { if (ret) actualizarRetirar(); };
ACTIONS['neumatico-retirar-confirmar'] = confirmarRetirar;

export function init() {
  // El buscador filtra mientras se escribe (data-change solo dispara al salir del campo).
  $('mont-buscar').addEventListener('input', () => { if (mont) { pintarLista(); actualizarMontar(); } });
  // Pestañas: flechas izquierda y derecha cambian de origen (patrón de tabs).
  $('modal-montar').addEventListener('keydown', e => {
    if (!mont || !mont.puedeStock || !e.target.closest || !e.target.closest('[role="tab"]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    ACTIONS['neumatico-montar-tab'](mont.origen === 'stock' ? 'nuevo' : 'stock');
    $(mont.origen === 'stock' ? 'mont-tab-stock' : 'mont-tab-nuevo').focus();
  });
}
