// Cambiar la distribución de ruedas y el servicio de un vehículo desde su detalle (quien puede operar neumáticos: administrador de empresa
// y usuario de la sucursal del vehículo; el equipo Neumet solo mira). Mismas opciones que al agregar un vehículo.
// La escritura la hace la RPC vehiculo_cambiar_distribucion, que vuelve a validar el permiso y rechaza una distribución con
// menos posiciones que las que tienen neumático montado. El servicio lo escribe vehiculo_fijar_servicio, solo si cambió.
// Tres clics: «Distribución y servicio», elegir, «Guardar» (o Enter).
// Acción: vehiculo-cambiar-distribucion (vehiculoId). Al terminar se redibuja el detalle.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin } from '../core/auth.js';
import { etiquetaCoche } from '../domain/coche.js';
import {
  DISTRIBUCIONES, OTRA_DISTRIBUCION, textoOpcion, distribucionActual, validarCambioDistribucion, traducirErrorDistribucion,
  AYUDA_SERVICIO, validarCambioServicio, traducirErrorServicio
} from '../domain/distribucion.js';

const $ = id => document.getElementById(id);
let ctx = null; // {vehiculoId, servicio: el de la base al abrir ('' = sin definir)}
let ocupado = false;

const mostrarTipo = () => { $('veh-dist-tipo-campo').hidden = $('veh-dist-distribucion').value !== OTRA_DISTRIBUCION; };

async function abrir(vehiculoId) {
  if (!Number.isInteger(vehiculoId)) { showToast('Elegir el vehículo', true); return; }
  // Datos frescos: la distribución que se preselecciona es la de la base, no la del detalle ya dibujado.
  const r = await db.from('vehiculos').select('id,nombre,tipo_ruedas,distribucion,servicio').eq('id', vehiculoId).maybeSingle();
  if (r.error) { console.error(r.error); showToast('No se pudo cargar el vehículo. Reintentar', true); return; }
  if (!r.data) { showToast('El vehículo ya no existe. Actualizar la pantalla', true); return; }
  ctx = { vehiculoId, servicio: r.data.servicio || '' };
  $('veh-dist-sub').textContent = r.data.nombre ? etiquetaCoche(r.data.nombre) : '';
  setHtml($('veh-dist-distribucion'), joinHtml([html`<option value="">Elegir distribución…</option>`,
    DISTRIBUCIONES.map(d => html`<option value="${d.id}">${textoOpcion(d)}</option>`),
    html`<option value="${OTRA_DISTRIBUCION}">Otra distribución</option>`]));
  $('veh-dist-distribucion').value = distribucionActual(r.data);
  $('veh-dist-servicio').value = ctx.servicio;
  $('veh-dist-ruedas').value = String(r.data.tipo_ruedas) === '16' ? '16' : '10';
  mostrarTipo();
  $('veh-dist-error').textContent = '';
  $('veh-dist-guardar').disabled = false;
  $('modal-veh-dist').classList.add('show');
  setTimeout(() => { if (ctx) $('veh-dist-distribucion').focus(); }, 60);
}

ACTIONS['vehiculo-cambiar-distribucion'] = async function (vehiculoId) { if (esAdmin() || ocupado) return; await abrir(Number(vehiculoId)); };
ACTIONS['vehiculo-cambiar-distribucion-cerrar'] = function () { $('modal-veh-dist').classList.remove('show'); ctx = null; };

// Sin console.error: el aviso del diálogo ya dice qué pasó. Devuelve el aviso, o '' si el servicio se guardó.
async function guardarServicio(params) {
  try {
    const res = await db.rpc('vehiculo_fijar_servicio', params);
    return res.error ? traducirErrorServicio(res.error) : '';
  } catch (e) { return traducirErrorServicio(e); }
}

// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
// La distribución va primero; si el servicio falla después, la distribución ya quedó guardada y el diálogo sigue abierto con el aviso.
ACTIONS['vehiculo-cambiar-distribucion-guardar'] = async function () {
  if (!ctx || ocupado || esAdmin()) return;
  const r = validarCambioDistribucion({ vehiculoId: ctx.vehiculoId, distribucion: $('veh-dist-distribucion').value, tipoRuedas: $('veh-dist-ruedas').value });
  const s = validarCambioServicio({ vehiculoId: ctx.vehiculoId, servicio: $('veh-dist-servicio').value });
  const aviso = (!r.ok && r.error) || (!s.ok && s.error) || '';
  if (aviso) { $('veh-dist-error').textContent = aviso; return; }
  ocupado = true; $('veh-dist-guardar').disabled = true;
  const mio = ctx;
  const cambiaServicio = $('veh-dist-servicio').value !== mio.servicio;
  let guardada = false, msg = '';
  try {
    const res = await db.rpc('vehiculo_cambiar_distribucion', r.params);
    if (res.error) throw res.error;
    guardada = true;
    if (cambiaServicio) msg = await guardarServicio(s.params);
  } catch (e) {
    console.error(e);
    msg = traducirErrorDistribucion(e);
  }
  if (!msg) {
    if (ctx === mio) ACTIONS['vehiculo-cambiar-distribucion-cerrar']();
    showToast(cambiaServicio ? 'Distribución y servicio guardados' : 'Distribución cambiada');
  } else {
    if (ctx === mio) { $('veh-dist-error').textContent = msg; $('veh-dist-guardar').disabled = false; }
    showToast(msg, true);
  }
  // `ocupado` sigue activo mientras se redibuja el detalle: así no hay doble envío durante la recarga.
  try { if (guardada && ACTIONS.recargarVehiculoDetalle) await ACTIONS.recargarVehiculoDetalle(); }
  finally { ocupado = false; }
};

export function init() {
  $('veh-dist-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['vehiculo-cambiar-distribucion-guardar'](); });
  // Enter mantenido (autorepetición): solo cuenta la primera pulsación.
  $('veh-dist-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
  $('veh-dist-distribucion').addEventListener('change', () => { mostrarTipo(); $('veh-dist-error').textContent = ''; });
  $('veh-dist-servicio').addEventListener('change', () => { $('veh-dist-error').textContent = ''; });
  $('veh-dist-servicio-ayuda').textContent = AYUDA_SERVICIO;
}
