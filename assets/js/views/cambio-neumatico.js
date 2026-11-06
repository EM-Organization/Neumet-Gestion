// Cambio de neumático en el taller: el gomero (cliente global o de seccional) o el admin registra, en una sola
// pantalla, qué pasó con el neumático viejo y cuál entró. Toda la escritura pasa por la RPC atómica neumatico_cambiar
// (la autorización se verifica en la base: otro cliente u otra seccional reciben "permiso denegado").
// Acciones: neumatico-cambiar (vehiculoId, posicion), neumatico-rotar-pos (vehiculoId, posA, posB).
// Al terminar emite el evento DOM "neumet:neumatico-cambiado" y recarga la vista activa (flota/vehículo/inicio/alertas).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, confirmDialog } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { reloadActiveView } from '../core/nav.js';
import {
  DESTINOS, MOTIVO_POR_DEFECTO, stockDisponible, etiquetaStock, validarCambio, traducirErrorCambio, validarRotacion
} from '../domain/cambio-neumatico.js';

export const EVENTO_CAMBIO = 'neumet:neumatico-cambiado';
const $ = id => document.getElementById(id);
const val = id => { const el = $(id); return el ? el.value : ''; };
const NEUM_COLS = 'id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado';

let ctx = null; // {veh, neum, stock}
let ocupado = false;

function notificarCambio(detalle) {
  document.dispatchEvent(new CustomEvent(EVENTO_CAMBIO, { detail: detalle }));
  try { reloadActiveView(); } catch (e) { console.error(e); }
}

function radio(name, id, label, checked, change) {
  return html`<label class="cambio-op"><input type="radio" name="${name}" value="${id}" ${checked ? 'checked' : ''}
    data-change="${change}"/> <span>${label}</span></label>`;
}

function estado() {
  const dest = document.querySelector('input[name="cambio-destino"]:checked');
  const orig = document.querySelector('input[name="cambio-origen"]:checked');
  return {
    neum: ctx && ctx.neum, destino: dest ? dest.value : '', motivo: val('cambio-motivo'),
    origen: orig ? orig.value : '', stockId: val('cambio-stock'), stock: ctx ? ctx.stock : [],
    marca: val('cambio-marca'), modelo: val('cambio-modelo'), odometro: val('cambio-odo'),
    odometroActual: ctx && ctx.veh ? ctx.veh.odometro_km : null
  };
}

function actualizar() {
  const f = estado();
  $('cambio-stock-wrap').style.display = f.origen === 'stock' ? '' : 'none';
  $('cambio-nuevo-wrap').style.display = f.origen === 'nuevo' ? '' : 'none';
  $('cambio-motivo-opt').textContent = f.destino === 'baja' ? '(obligatorio)' : '(opcional)';
  const r = validarCambio(f);
  $('cambio-resumen').textContent = r.ok ? r.resumen : 'Completá los datos para ver el resumen';
  $('cambio-error').textContent = '';
  return r;
}

function pintar() {
  const { veh, neum, stock } = ctx;
  const hayStock = stock.length > 0;
  $('cambio-sub').textContent = veh ? `Vehículo ${veh.nombre || ''}`.trim() : 'Registrá el cambio que hizo el taller';
  setHtml($('cambio-actual'), html`<div>Neumático actual en <strong>P${neum.posicion}</strong>:
    <strong>${[neum.marca, neum.modelo].filter(Boolean).join(' ') || 'Sin marca'}</strong>
    · ${neum.estado || 'montado'} · vida ${neum.vida || 0}${veh && veh.odometro_km != null ? html` · vehículo con ${veh.odometro_km} km` : ''}</div>`);
  setHtml($('cambio-destinos'), joinHtml(DESTINOS.map((d, i) => radio('cambio-destino', d.id, d.label, i === 0, 'neumatico-cambiar-resumen'))));
  setHtml($('cambio-origenes'), joinHtml([
    hayStock ? radio('cambio-origen', 'stock', 'Elegir del stock', true, 'neumatico-cambiar-resumen') : '',
    radio('cambio-origen', 'nuevo', 'Ingresar uno nuevo', !hayStock, 'neumatico-cambiar-resumen')
  ]));
  setHtml($('cambio-stock'), joinHtml(stock.map(s => html`<option value="${s.id}">${etiquetaStock(s)}</option>`)));
  $('cambio-motivo').value = MOTIVO_POR_DEFECTO;
  $('cambio-marca').value = ''; $('cambio-modelo').value = ''; $('cambio-odo').value = '';
  $('cambio-confirmar').disabled = false;
  actualizar();
}

async function abrir(vehiculoId, posicion) {
  if (!Number.isInteger(vehiculoId) || !Number.isInteger(posicion)) { showToast('Elegí un neumático para cambiar', true); return; }
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,odometro_km').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vehiculoId).eq('posicion', posicion).maybeSingle()
  ]);
  if (rv.error || rn.error) { console.error(rv.error || rn.error); showToast('No se pudo cargar el neumático: intentá de nuevo', true); return; }
  const neum = rn.data;
  if (!neum) { showToast(`No hay un neumático montado en P${posicion}`, true); return; }
  if (neum.estado === 'baja') { showToast(`El neumático de P${posicion} ya está dado de baja`, true); return; }
  const veh = rv.data || { id: vehiculoId };
  // El stock es del cliente del vehículo; la RLS ya limita qué lotes ve cada perfil (el de seccional no ve ninguno).
  const rs = await db.from('stock_neumaticos').select('id,marca,modelo,cantidad,precio_unidad')
    .eq('cliente_id', neum.cliente_id).gte('cantidad', 1);
  const stock = rs.error ? [] : stockDisponible(rs.data);
  ctx = { veh, neum: { ...neum, vehiculo_id: vehiculoId }, stock };
  pintar();
  $('modal-cambio').classList.add('show');
}

ACTIONS['neumatico-cambiar'] = async function (vehiculoId, posicion) { await abrir(Number(vehiculoId), Number(posicion)); };
ACTIONS['neumatico-cambiar-resumen'] = function () { if (ctx) actualizar(); };
ACTIONS['neumatico-cambiar-cerrar'] = function () { $('modal-cambio').classList.remove('show'); ctx = null; };

ACTIONS['neumatico-cambiar-confirmar'] = async function () {
  if (!ctx || ocupado) return;
  const r = validarCambio(estado());
  if (!r.ok) { $('cambio-error').textContent = r.error; showToast(r.error, true); return; }
  ocupado = true; $('cambio-confirmar').disabled = true;
  try {
    const { data, error } = await db.rpc('neumatico_cambiar', r.params);
    if (error) throw error;
    const posicion = ctx.neum.posicion, vehiculoId = ctx.neum.vehiculo_id;
    ACTIONS['neumatico-cambiar-cerrar']();
    showToast(`Cambio registrado en P${posicion}: el neumático nuevo ya figura montado`);
    notificarCambio({ vehiculoId, posicion, resultado: data });
  } catch (e) {
    console.error(e);
    const msg = traducirErrorCambio(e);
    $('cambio-error').textContent = msg;
    showToast(msg, true);
    $('cambio-confirmar').disabled = false;
  } finally { ocupado = false; }
};

// Rotación desde un botón de posición: reutiliza la RPC atómica neumatico_rotar (ahora con el mismo alcance).
ACTIONS['neumatico-rotar-pos'] = async function (vehiculoId, posA, posB) {
  const vid = Number(vehiculoId);
  const { data, error } = await db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vid);
  if (error) { console.error(error); showToast('No se pudo cargar los neumáticos: intentá de nuevo', true); return; }
  const r = validarRotacion(data || [], vid, posA, posB);
  if (!r.ok) { showToast(r.error, true); return; }
  if (r.intercambio && !(await confirmDialog('Intercambiar neumáticos',
    `La posición P${r.params.p_pos_b} está ocupada: se intercambiarán los neumáticos de P${r.params.p_pos_a} y P${r.params.p_pos_b}.`))) return;
  const { error: e2 } = await db.rpc('neumatico_rotar', { ...r.params, p_odometro_km: null });
  if (e2) {
    console.error(e2);
    showToast(e2.code === '42501' ? 'No tenés permiso para rotar neumáticos de este vehículo' : 'No se pudo registrar la rotación. No se guardó nada', true);
    return;
  }
  showToast(`Rotación registrada: P${r.params.p_pos_a} y P${r.params.p_pos_b}`);
  notificarCambio({ vehiculoId: vid, rotacion: [r.params.p_pos_a, r.params.p_pos_b] });
};

export function init() {}
