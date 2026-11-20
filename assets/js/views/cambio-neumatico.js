// Cambio de neumático en el taller: el gomero (cliente global o de sucursal) o el admin registra, en una sola
// pantalla, qué pasó con el neumático viejo y cuál entró. Toda la escritura pasa por la RPC atómica neumatico_cambiar
// (la autorización se verifica en la base: otro cliente u otra sucursal reciben "permiso denegado").
// Acciones: neumatico-cambiar (vehiculoId, posicion), neumatico-rotar-pos (vehiculoId, posA, posB).
// Al terminar emite el evento DOM "neumet:neumatico-cambiado" y recarga la vista activa (flota/vehículo/inicio/alertas).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin, esAdminEmpresa } from '../core/auth.js';
import { etiquetaCoche } from '../domain/coche.js';
import { reloadActiveView } from '../core/nav.js';
import {
  DESTINOS, MOTIVO_POR_DEFECTO, nombrePos, etiquetaVida, stockDisponible, etiquetaStock, validarCambio, traducirErrorCambio, validarRotacion, avisoRotacion
} from '../domain/cambio-neumatico.js';
import { fmtNum } from '../domain/formato.js';
import { cubiertasMontables, etiquetaCubierta, SIN_SUCURSAL } from '../domain/stock-cubiertas.js';

export const EVENTO_CAMBIO = 'neumet:neumatico-cambiado';
const $ = id => document.getElementById(id);
const val = id => { const el = $(id); return el ? el.value : ''; };
const NEUM_COLS = 'id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado,numero_quema';

let ctx = null; // {veh, neum, stock, cubiertas, sucursales, puedeStock}
let ocupado = false;
let rotando = false;

// Espera máxima de la base. Si vence NO se reintenta: la operación pudo haberse aplicado igual y repetirla duplicaría el cambio.
// Se recarga el detalle para que el operario vea el estado real. Configurable para las pruebas.
export const config = { timeoutMs: 20000 };
const TARDE = Symbol('tarde');
function conLimite(promesa) {
  let t;
  const limite = new Promise(res => { t = setTimeout(() => res(TARDE), config.timeoutMs); });
  // La respuesta tardía se descarta: ni éxito ni error se pintan sobre una pantalla que ya siguió adelante.
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(t));
}

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
    numeroQuema: val('cambio-quema'), kmPrevios: val('cambio-km-previos'),
    odometroActual: ctx && ctx.veh ? ctx.veh.odometro_km : null, tipo: ctx && ctx.veh ? ctx.veh.tipo_ruedas : null,
    cubiertaId: val('cambio-cubierta'), cubiertas: ctx ? ctx.cubiertas : [], sucursales: ctx ? ctx.sucursales : [],
    // Solo admin y perfil global gestionan el stock: ahí «Almacenar» devuelve el neumático al stock.
    devolverStock: !!(ctx && ctx.puedeStock), sucursalStock: val('cambio-retorno-suc'), quemaViejo: val('cambio-quema-viejo')
  };
}

function actualizar() {
  const f = estado();
  $('cambio-cubierta-wrap').style.display = f.origen === 'cubierta' ? '' : 'none';
  $('cambio-stock-wrap').style.display = f.origen === 'stock' ? '' : 'none';
  $('cambio-nuevo-wrap').style.display = f.origen === 'nuevo' ? '' : 'none';
  // La cubierta del stock ya trae su quema y sus km.
  $('cambio-quema-km-wrap').style.display = f.origen === 'cubierta' ? 'none' : '';
  const vuelve = f.destino === 'almacenado' && f.devolverStock;
  $('cambio-retorno-wrap').style.display = vuelve ? 'block' : 'none';
  $('cambio-quema-viejo-wrap').style.display = vuelve && ctx && ctx.neum && !ctx.neum.numero_quema ? '' : 'none';
  $('cambio-motivo-opt').textContent = f.destino === 'baja' ? '(obligatorio)' : '(opcional)';
  const r = validarCambio(f);
  $('cambio-resumen').textContent = r.ok ? r.resumen : 'Completar los datos para ver el resumen';
  $('cambio-error').textContent = '';
  return r;
}

function pintar() {
  const { veh, neum, stock, cubiertas, sucursales } = ctx;
  const hayStock = stock.length > 0, hayCubiertas = cubiertas.length > 0;
  $('cambio-sub').textContent = veh && veh.nombre ? etiquetaCoche(veh.nombre) : 'Registro del cambio hecho en el taller';
  setHtml($('cambio-actual'), html`<div>Neumático actual en <strong>${nombrePos(neum.posicion, veh && veh.tipo_ruedas)}</strong>:
    <strong>${[neum.marca, neum.modelo].filter(Boolean).join(' ') || 'Sin marca'}</strong>
    · ${neum.estado || 'montado'} · ${etiquetaVida(neum.vida)}${neum.numero_quema ? html` · quema ${neum.numero_quema}` : ''}${veh && veh.odometro_km != null ? html` · vehículo con ${fmtNum(veh.odometro_km)} km` : ''}</div>`);
  setHtml($('cambio-destinos'), joinHtml(DESTINOS.map((d, i) => radio('cambio-destino', d.id, d.label, i === 0, 'neumatico-cambiar-resumen'))));
  setHtml($('cambio-origenes'), joinHtml([
    hayCubiertas ? radio('cambio-origen', 'cubierta', 'Cubierta del stock', true, 'neumatico-cambiar-resumen') : '',
    hayStock ? radio('cambio-origen', 'stock', 'Lote del stock', !hayCubiertas, 'neumatico-cambiar-resumen') : '',
    radio('cambio-origen', 'nuevo', 'Ingresar uno nuevo', !hayStock && !hayCubiertas, 'neumatico-cambiar-resumen')
  ]));
  setHtml($('cambio-cubierta'), joinHtml(cubiertas.map(c => html`<option value="${c.id}">${etiquetaCubierta(c, sucursales)}</option>`)));
  setHtml($('cambio-retorno-suc'), joinHtml([html`<option value="">${SIN_SUCURSAL}</option>`,
    sucursales.map(x => html`<option value="${x.id}">${x.nombre}</option>`)]));
  $('cambio-quema-viejo').value = '';
  setHtml($('cambio-stock'), joinHtml(stock.map(s => html`<option value="${s.id}">${etiquetaStock(s)}</option>`)));
  $('cambio-motivo').value = MOTIVO_POR_DEFECTO;
  $('cambio-marca').value = ''; $('cambio-modelo').value = ''; $('cambio-odo').value = '';
  $('cambio-quema').value = ''; $('cambio-km-previos').value = '0';
  $('cambio-odo-hint').textContent = veh && veh.odometro_km != null
    ? `Opcional. No puede ser menor al actual (${fmtNum(veh.odometro_km)} km).` : 'Opcional. Lectura actual del vehículo, aparte de los km del neumático.';
  $('cambio-confirmar').disabled = false;
  actualizar();
}

const AVISO_EN_CURSO = 'Esperar a que termine el cambio en curso';

async function abrir(vehiculoId, posicion) {
  // Un cambio en vuelo es de otro neumático: abrir otro modal ahora haría que su respuesta cerrara el equivocado.
  if (ocupado) { showToast(AVISO_EN_CURSO, true); return; }
  if (!Number.isInteger(vehiculoId) || !Number.isInteger(posicion)) { showToast('Elegir el neumático a cambiar', true); return; }
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,odometro_km,tipo_ruedas').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vehiculoId).eq('posicion', posicion).maybeSingle()
  ]);
  if (rv.error || rn.error) { console.error(rv.error || rn.error); showToast('No se pudo cargar el neumático. Reintentar', true); return; }
  const neum = rn.data, veh0 = rv.data || {};
  if (!neum) { showToast(`No hay un neumático montado en ${nombrePos(posicion, veh0.tipo_ruedas)}`, true); return; }
  if (neum.estado === 'baja') { showToast(`El neumático de ${nombrePos(posicion, veh0.tipo_ruedas)} ya está dado de baja`, true); return; }
  const veh = rv.data || { id: vehiculoId };
  // El stock es del cliente del vehículo; la RLS ya limita qué ve cada perfil (el de sucursal no ve ninguno).
  const puedeStock = esAdminEmpresa();
  const [rs, rc, rsu] = await Promise.all([
    db.from('stock_neumaticos').select('id,marca,modelo,cantidad,precio_unidad').eq('cliente_id', neum.cliente_id).gte('cantidad', 1),
    puedeStock
      ? db.from('neumaticos').select('id,numero_quema,marca,modelo,condicion,sucursal_id,vehiculo_id,estado')
        .is('vehiculo_id', null).eq('estado', 'almacenado').eq('cliente_id', neum.cliente_id).order('numero_quema')
      : Promise.resolve({ data: [] }),
    puedeStock ? db.from('sucursales').select('id,nombre').eq('cliente_id', neum.cliente_id).order('nombre') : Promise.resolve({ data: [] })
  ]);
  const stock = rs.error ? [] : stockDisponible(rs.data);
  const cubiertas = rc.error ? [] : cubiertasMontables(rc.data);
  const sucursales = rsu.error ? [] : (rsu.data || []);
  // Un cambio pudo empezar mientras se cargaba este: no se reemplaza el contexto del que está en vuelo.
  if (ocupado) { showToast(AVISO_EN_CURSO, true); return; }
  ctx = { veh, neum: { ...neum, vehiculo_id: vehiculoId }, stock, cubiertas, sucursales, puedeStock };
  pintar();
  $('modal-cambio').classList.add('show');
}

// El equipo Neumet no opera dentro de una empresa (docs/17 P1): la acción no se ofrece en la interfaz y además se rechaza aquí,
// porque un botón ajeno con este data-action (o una vista que no filtre) no debe abrir el modal.
ACTIONS['neumatico-cambiar'] = async function (vehiculoId, posicion) { if (esAdmin()) return; await abrir(Number(vehiculoId), Number(posicion)); };
ACTIONS['neumatico-cambiar-resumen'] = function () { if (ctx) actualizar(); };
ACTIONS['neumatico-cambiar-cerrar'] = function () { $('modal-cambio').classList.remove('show'); ctx = null; };

// Guarda de rol: defensa en profundidad (el botón no se ofrece al equipo Neumet y la RPC lo rechaza); ningún test la cubre.
// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
ACTIONS['neumatico-cambiar-confirmar'] = async function () {
  if (!ctx || ocupado || esAdmin()) return;
  const r = validarCambio(estado());
  if (!r.ok) { $('cambio-error').textContent = r.error; showToast(r.error, true); return; }
  ocupado = true; $('cambio-confirmar').disabled = true;
  const mio = ctx; // la respuesta solo toca el modal del neumático que la originó
  const { posicion, vehiculo_id: vehiculoId } = ctx.neum, ctxTipo = ctx.veh && ctx.veh.tipo_ruedas;
  const coche = ctx.veh && ctx.veh.nombre ? etiquetaCoche(ctx.veh.nombre) : '';
  try {
    const res = await conLimite(db.rpc('neumatico_cambiar', r.params));
    if (res === TARDE) {
      if (ctx === mio) ACTIONS['neumatico-cambiar-cerrar']();
      showToast(`No se pudo confirmar el cambio${coche ? ' en ' + coche : ''}. Revisar el vehículo antes de reintentar`, true);
      try { reloadActiveView(); } catch (e) { console.error(e); }
      return;
    }
    if (res.error) throw res.error;
    if (ctx === mio) ACTIONS['neumatico-cambiar-cerrar']();
    showToast(`Cambio registrado en ${coche ? coche + ', ' : ''}${nombrePos(posicion, ctxTipo)}: el neumático nuevo ya figura montado`);
    document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
    notificarCambio({ vehiculoId, posicion, resultado: res.data });
  } catch (e) {
    console.error(e);
    const msg = traducirErrorCambio(e);
    if (ctx === mio) $('cambio-error').textContent = msg;
    showToast(msg, true);
    if (ctx === mio) $('cambio-confirmar').disabled = false;
  } finally { ocupado = false; }
};

// Rotación desde un botón de posición: reutiliza la RPC atómica neumatico_rotar. Es reversible (rotar de nuevo la deshace),
// por eso no pide confirmación (docs/14 §5 r.5); el aviso nombra el intercambio. Una rotación a la vez (`rotando`).
ACTIONS['neumatico-rotar-pos'] = async function (vehiculoId, posA, posB) {
  if (esAdmin()) return;
  if (rotando) { showToast('Esperar a que termine la rotación', true); return; }
  rotando = true;
  const btn = document.getElementById('vd-rotar-btn');
  if (btn) btn.disabled = true;
  try {
    const vid = Number(vehiculoId);
    const [rn, rv] = await Promise.all([
      db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vid),
      db.from('vehiculos').select('id,nombre,tipo_ruedas').eq('id', vid).maybeSingle()
    ]);
    if (rn.error) { console.error(rn.error); showToast('No se pudieron cargar los neumáticos. Reintentar', true); return; }
    const tipo = rv.data ? rv.data.tipo_ruedas : null;
    const coche = rv.data && rv.data.nombre ? etiquetaCoche(rv.data.nombre) : '';
    const r = validarRotacion(rn.data || [], vid, posA, posB, tipo);
    if (!r.ok) { showToast(r.error, true); return; }
    const res = await conLimite(db.rpc('neumatico_rotar', { ...r.params, p_odometro_km: null }));
    if (res === TARDE) {
      showToast(`No se pudo confirmar la rotación${coche ? ' en ' + coche : ''}. Revisar el vehículo antes de reintentar`, true);
      try { reloadActiveView(); } catch (e) { console.error(e); }
      return;
    }
    if (res.error) {
      console.error(res.error);
      showToast(res.error.code === '42501' ? 'Sin permiso para rotar neumáticos de este vehículo' : 'No se pudo registrar la rotación. No se guardó nada', true);
      return;
    }
    const hubo = res.data && typeof res.data.intercambio === 'boolean' ? res.data.intercambio : !!r.intercambio;
    showToast(`Rotación registrada${coche ? ' en ' + coche : ''}: ${avisoRotacion(r.params.p_pos_a, r.params.p_pos_b, tipo, hubo)}`);
    notificarCambio({ vehiculoId: vid, rotacion: [r.params.p_pos_a, r.params.p_pos_b] });
  } finally { rotando = false; if (btn && btn.isConnected) btn.disabled = false; }
};

export function init() {
  // «Enter» en cualquier campo envía (docs/14 §5 r.3); el clic en «Confirmar cambio» llega también como submit.
  $('cambio-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['neumatico-cambiar-confirmar'](); });
  // Enter mantenido (autorepetición): solo cuenta la primera pulsación.
  $('cambio-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
}
