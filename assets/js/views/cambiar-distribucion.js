// Cambiar la distribución de ruedas de un vehículo desde su detalle (quien puede operar neumáticos: administrador de empresa
// y usuario de la sucursal del vehículo; el equipo Neumet solo mira). Mismas opciones que al agregar un vehículo.
// La escritura la hace la RPC vehiculo_cambiar_distribucion, que vuelve a validar el permiso y rechaza una distribución con
// menos posiciones que las que tienen neumático montado. Tres clics: «Cambiar distribución», elegir, «Guardar» (o Enter).
// Acción: vehiculo-cambiar-distribucion (vehiculoId). Al terminar se redibuja el detalle.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin } from '../core/auth.js';
import { etiquetaCoche } from '../domain/coche.js';
import {
  DISTRIBUCIONES, OTRA_DISTRIBUCION, textoOpcion, distribucionActual, validarCambioDistribucion, traducirErrorDistribucion
} from '../domain/distribucion.js';

const $ = id => document.getElementById(id);
let ctx = null; // {vehiculoId}
let ocupado = false;

const mostrarTipo = () => { $('veh-dist-tipo-campo').hidden = $('veh-dist-distribucion').value !== OTRA_DISTRIBUCION; };

async function abrir(vehiculoId) {
  if (!Number.isInteger(vehiculoId)) { showToast('Elegir el vehículo', true); return; }
  // Datos frescos: la distribución que se preselecciona es la de la base, no la del detalle ya dibujado.
  const r = await db.from('vehiculos').select('id,nombre,tipo_ruedas,distribucion').eq('id', vehiculoId).maybeSingle();
  if (r.error) { console.error(r.error); showToast('No se pudo cargar el vehículo. Reintentar', true); return; }
  if (!r.data) { showToast('El vehículo ya no existe. Actualizar la pantalla', true); return; }
  ctx = { vehiculoId };
  $('veh-dist-sub').textContent = r.data.nombre ? etiquetaCoche(r.data.nombre) : '';
  setHtml($('veh-dist-distribucion'), joinHtml([html`<option value="">Elegir distribución…</option>`,
    DISTRIBUCIONES.map(d => html`<option value="${d.id}">${textoOpcion(d)}</option>`),
    html`<option value="${OTRA_DISTRIBUCION}">Otra distribución</option>`]));
  $('veh-dist-distribucion').value = distribucionActual(r.data);
  $('veh-dist-ruedas').value = String(r.data.tipo_ruedas) === '16' ? '16' : '10';
  mostrarTipo();
  $('veh-dist-error').textContent = '';
  $('veh-dist-guardar').disabled = false;
  $('modal-veh-dist').classList.add('show');
  setTimeout(() => { if (ctx) $('veh-dist-distribucion').focus(); }, 60);
}

ACTIONS['vehiculo-cambiar-distribucion'] = async function (vehiculoId) { if (esAdmin() || ocupado) return; await abrir(Number(vehiculoId)); };
ACTIONS['vehiculo-cambiar-distribucion-cerrar'] = function () { $('modal-veh-dist').classList.remove('show'); ctx = null; };

// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
ACTIONS['vehiculo-cambiar-distribucion-guardar'] = async function () {
  if (!ctx || ocupado || esAdmin()) return;
  const r = validarCambioDistribucion({ vehiculoId: ctx.vehiculoId, distribucion: $('veh-dist-distribucion').value, tipoRuedas: $('veh-dist-ruedas').value });
  if (!r.ok) { $('veh-dist-error').textContent = r.error; return; }
  ocupado = true; $('veh-dist-guardar').disabled = true;
  const mio = ctx;
  try {
    const res = await db.rpc('vehiculo_cambiar_distribucion', r.params);
    if (res.error) throw res.error;
    if (ctx === mio) ACTIONS['vehiculo-cambiar-distribucion-cerrar']();
    showToast('Distribución cambiada');
    if (ACTIONS.recargarVehiculoDetalle) await ACTIONS.recargarVehiculoDetalle();
  } catch (e) {
    console.error(e);
    const msg = traducirErrorDistribucion(e);
    if (ctx === mio) { $('veh-dist-error').textContent = msg; $('veh-dist-guardar').disabled = false; }
    showToast(msg, true);
  } finally { ocupado = false; }
};

export function init() {
  $('veh-dist-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['vehiculo-cambiar-distribucion-guardar'](); });
  // Enter mantenido (autorepetición): solo cuenta la primera pulsación.
  $('veh-dist-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
  $('veh-dist-distribucion').addEventListener('change', () => { mostrarTipo(); $('veh-dist-error').textContent = ''; });
}
