// Cambiar la distribución de ruedas y el servicio de un vehículo desde su detalle (quien puede operar neumáticos: administrador de empresa
// y usuario de la sucursal del vehículo; el equipo Neumet solo mira). Mismas opciones que al agregar un vehículo.
// La escritura la hace la RPC vehiculo_cambiar_distribucion, que vuelve a validar el permiso y rechaza una distribución con
// menos posiciones que las que tienen neumático montado. El servicio lo escribe vehiculo_fijar_servicio, solo si cambió.
// Tres clics: «Distribución y servicio», elegir, «Guardar» (o Enter).
// Acción: vehiculo-cambiar-distribucion (vehiculoId). Al terminar se redibuja el detalle.
import { db } from '../core/supabase.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin } from '../core/auth.js';
import { etiquetaCoche } from '../domain/coche.js';
import {
  OTRA_DISTRIBUCION, distribucionActual, validarCambioDistribucion, traducirErrorDistribucion,
  AYUDA_SERVICIO, validarCambioServicio, traducirErrorServicio
} from '../domain/distribucion.js';
import { pintarDistribucion, valorDistribucion, marcarDistribucion, enfocarDistribucion } from '../core/distribucion-tarjetas.js';

const $ = id => document.getElementById(id);
let ctx = null; // {vehiculoId, distribucion, tipoRuedas, servicio}: lo que mostró el diálogo al abrir; al guardar se compara contra eso.
let ocupado = false;

const mostrarTipo = () => { $('veh-dist-tipo-campo').hidden = valorDistribucion($('veh-dist-distribucion')) !== OTRA_DISTRIBUCION; };

async function abrir(vehiculoId) {
  if (!Number.isInteger(vehiculoId)) { showToast('Elegir el vehículo', true); return; }
  // Datos frescos: la distribución que se preselecciona es la de la base, no la del detalle ya dibujado.
  const r = await db.from('vehiculos').select('id,nombre,tipo_ruedas,distribucion,servicio').eq('id', vehiculoId).maybeSingle();
  if (r.error) { console.error(r.error); showToast('No se pudo cargar el vehículo. Reintentar', true); return; }
  if (!r.data) { showToast('El vehículo ya no existe. Actualizar la pantalla', true); return; }
  $('veh-dist-sub').textContent = r.data.nombre ? etiquetaCoche(r.data.nombre) : '';
  // Sin distribución en la base (nunca elegida, o una cantidad de ruedas que el catálogo no cubre), se preselecciona «Otra» con
  // el tipo de ruedas del vehículo: así guardar solo el servicio no obliga a elegir una distribución.
  marcarDistribucion($('veh-dist-distribucion'), distribucionActual(r.data) || OTRA_DISTRIBUCION);
  $('veh-dist-servicio').value = r.data.servicio || '';
  $('veh-dist-ruedas').value = String(r.data.tipo_ruedas) === '16' ? '16' : '10';
  // Lo que muestra el diálogo al abrir es lo de partida: al guardar se compara contra esto para mandar solo lo que cambió.
  ctx = { vehiculoId, distribucion: valorDistribucion($('veh-dist-distribucion')), tipoRuedas: $('veh-dist-ruedas').value, servicio: $('veh-dist-servicio').value };
  mostrarTipo();
  $('veh-dist-error').textContent = '';
  $('veh-dist-guardar').disabled = false;
  $('modal-veh-dist').classList.add('show');
  setTimeout(() => { if (ctx) enfocarDistribucion($('veh-dist-distribucion')); }, 60);
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

// Aviso de éxito según lo que se guardó: solo el servicio, «Servicio guardado».
function textoGuardado(cambiaDist, cambiaServicio) {
  if (cambiaDist && cambiaServicio) return 'Distribución y servicio guardados';
  return cambiaServicio ? 'Servicio guardado' : 'Distribución cambiada';
}

// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
// Solo se manda lo que cambió: la distribución (vehiculo_cambiar_distribucion) y el servicio (vehiculo_fijar_servicio). Si la
// distribución se guardó y el servicio falla, la distribución ya quedó: el diálogo sigue abierto con el aviso.
ACTIONS['vehiculo-cambiar-distribucion-guardar'] = async function () {
  if (!ctx || ocupado || esAdmin()) return;
  const mio = ctx;
  const distribucion = valorDistribucion($('veh-dist-distribucion')), tipoRuedas = $('veh-dist-ruedas').value, servicio = $('veh-dist-servicio').value;
  const cambiaDist = distribucion !== mio.distribucion || tipoRuedas !== mio.tipoRuedas;
  const cambiaServicio = servicio !== mio.servicio;
  if (!cambiaDist && !cambiaServicio) { ACTIONS['vehiculo-cambiar-distribucion-cerrar'](); return; }
  const r = cambiaDist ? validarCambioDistribucion({ vehiculoId: mio.vehiculoId, distribucion, tipoRuedas }) : { ok: true };
  const s = cambiaServicio ? validarCambioServicio({ vehiculoId: mio.vehiculoId, servicio }) : { ok: true };
  const aviso = (!r.ok && r.error) || (!s.ok && s.error) || '';
  if (aviso) { $('veh-dist-error').textContent = aviso; return; }
  ocupado = true; $('veh-dist-guardar').disabled = true;
  let guardada = false, msg = '';
  try {
    if (cambiaDist) {
      const res = await db.rpc('vehiculo_cambiar_distribucion', r.params);
      if (res.error) throw res.error;
      guardada = true;
      mio.distribucion = distribucion; mio.tipoRuedas = tipoRuedas;
    }
    if (cambiaServicio) {
      msg = await guardarServicio(s.params);
      if (!msg) { guardada = true; mio.servicio = servicio; }
    }
  } catch (e) {
    console.error(e);
    msg = traducirErrorDistribucion(e);
  }
  if (!msg) {
    if (ctx === mio) ACTIONS['vehiculo-cambiar-distribucion-cerrar']();
    showToast(textoGuardado(cambiaDist, cambiaServicio));
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
  pintarDistribucion($('veh-dist-distribucion'));
  $('veh-dist-distribucion').addEventListener('change', () => { mostrarTipo(); $('veh-dist-error').textContent = ''; });
  // Enter sobre una tarjeta envía el formulario una sola vez: se anula el envío implícito del radio y el repetido del teclado no envía.
  $('veh-dist-distribucion').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) $('veh-dist-form').requestSubmit();
  });
  $('veh-dist-servicio').addEventListener('change', () => { $('veh-dist-error').textContent = ''; });
  $('veh-dist-servicio-ayuda').textContent = AYUDA_SERVICIO;
}
