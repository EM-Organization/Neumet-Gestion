// Eliminar un vehículo (solo el administrador de empresa). Toda la escritura pasa por la RPC atómica vehiculo_eliminar
// (la autorización se verifica en la base: el equipo Neumet, la sucursal y otra empresa reciben «permiso denegado»).
// Si el vehículo tiene neumáticos, el administrador elige: enviarlos al stock o darlos de baja con el vehículo. «Baja» (lo
// irreversible) nunca viene preelegida; sin neumáticos, el diálogo es una confirmación simple.
// Acción: vehiculo-eliminar (vehiculoId). Al terminar vuelve a la lista de Vehículos.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdminEmpresa } from '../core/auth.js';
import { switchView } from '../core/nav.js';
import { etiquetaCoche } from '../domain/coche.js';
import {
  resumenNeumaticos, opcionesDestino, etiquetaDestino, textoResumen, validarEliminar, traducirErrorEliminar
} from '../domain/vehiculo-eliminar.js';

const $ = id => document.getElementById(id);

let ctx = null; // {vehiculoId, nombre, total, sinQuema, opciones}
let ocupado = false;

// Espera máxima de la base. Si vence NO se reintenta: la eliminación pudo haberse aplicado igual y repetirla la
// rechazaría («ya fue eliminado»). Se vuelve a la lista para que el administrador vea el estado real. Configurable para las pruebas.
export const config = { timeoutMs: 20000 };
const TARDE = Symbol('tarde');
function conLimite(promesa) {
  let t;
  const limite = new Promise(res => { t = setTimeout(() => res(TARDE), config.timeoutMs); });
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(t));
}

function destinoElegido() {
  const r = document.querySelector('input[name="veh-elim-destino"]:checked');
  return r ? r.value : '';
}

function radio(id, label, checked, disabled, aviso) {
  return html`<label class="cambio-op"><input type="radio" name="veh-elim-destino" value="${id}" ${checked ? 'checked' : ''}
    ${disabled ? 'disabled aria-describedby="veh-elim-aviso"' : ''} data-change="vehiculo-eliminar-resumen"/> <span>${label}${disabled ? html`<small class="veh-elim-motivo"> (no disponible: ${aviso})</small>` : ''}</span></label>`;
}

// Estado de «eliminando»: botón con progreso y deshabilitado (no se puede enviar dos veces ni leer como colgado).
function enCurso(si) {
  const b = $('veh-elim-confirmar');
  b.disabled = si;
  b.textContent = si ? 'Eliminando…' : 'Eliminar vehículo';
  if (si) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
}

function actualizar() {
  const { total } = ctx;
  const d = destinoElegido();
  $('veh-elim-resumen').textContent = total === 0 || d ? textoResumen({ total, destino: d }) : '';
  $('veh-elim-error').textContent = '';
}

function pintar() {
  const { nombre, total, opciones } = ctx;
  $('veh-elim-title').textContent = nombre ? `¿Eliminar ${etiquetaCoche(nombre)}?` : '¿Eliminar vehículo?';
  $('veh-elim-intro').textContent = total === 0
    ? 'El vehículo dejará de verse en la lista. Esta acción no se puede deshacer.'
    : `El vehículo tiene ${total === 1 ? '1 neumático' : `${total} neumáticos`}. Elegir qué hacer con ${total === 1 ? 'él' : 'ellos'}. Esta acción no se puede deshacer.`;
  $('veh-elim-grupo').hidden = total === 0;
  setHtml($('veh-elim-destinos'), total === 0 ? joinHtml([]) : joinHtml([
    radio('stock', etiquetaDestino('stock', total), opciones.porDefecto === 'stock', !opciones.stockPosible, opciones.avisoStock),
    radio('baja', etiquetaDestino('baja', total), false, false)
  ]));
  $('veh-elim-aviso').textContent = opciones.avisoStock;
  enCurso(false);
  actualizar();
}

async function abrir(vehiculoId) {
  if (ocupado) { showToast('Esperar a que termine la eliminación en curso', true); return; }
  if (!Number.isInteger(vehiculoId)) { showToast('Elegir el vehículo a eliminar', true); return; }
  // Datos frescos de la base (no los del detalle): lo que se cuenta aquí es lo que el administrador va a confirmar.
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select('id,estado,numero_quema').eq('vehiculo_id', vehiculoId)
  ]);
  if (rv.error || rn.error) { console.error(rv.error || rn.error); showToast('No se pudo cargar el vehículo. Reintentar', true); return; }
  if (!rv.data) { showToast('El vehículo ya no existe. Actualizar la pantalla', true); return; }
  if (ocupado) { showToast('Esperar a que termine la eliminación en curso', true); return; }
  const { total, sinQuema } = resumenNeumaticos(rn.data);
  ctx = { vehiculoId, nombre: rv.data.nombre, total, sinQuema, opciones: opcionesDestino({ total, sinQuema }) };
  pintar();
  $('modal-veh-eliminar').classList.add('show');
  // El foco inicial lo pone modal-a11y (data-foco-inicial="veh-elim-cancelar"): en lo destructivo empieza en la salida
  // segura. Enfocar aquí lo haría guardar otro elemento como «el que abrió» y el foco caería en <body> al cerrar.
}

// El equipo Neumet y los usuarios de sucursal no ven el botón; aquí además se rechaza (un data-action ajeno no abre el diálogo).
ACTIONS['vehiculo-eliminar'] = async function (vehiculoId) { if (!esAdminEmpresa()) return; await abrir(Number(vehiculoId)); };
ACTIONS['vehiculo-eliminar-resumen'] = function () { if (ctx) actualizar(); };
ACTIONS['vehiculo-eliminar-cerrar'] = function () { $('modal-veh-eliminar').classList.remove('show'); ctx = null; };

// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
ACTIONS['vehiculo-eliminar-confirmar'] = async function () {
  if (!ctx || ocupado || !esAdminEmpresa()) return;
  const r = validarEliminar({ vehiculoId: ctx.vehiculoId, total: ctx.total, sinQuema: ctx.sinQuema, destino: destinoElegido() });
  if (!r.ok) { $('veh-elim-error').textContent = r.error; showToast(r.error, true); return; }
  ocupado = true; enCurso(true);
  const mio = ctx; // la respuesta solo toca el diálogo del vehículo que la originó
  const coche = mio.nombre ? etiquetaCoche(mio.nombre) : '';
  try {
    const res = await conLimite(db.rpc('vehiculo_eliminar', r.params));
    if (res === TARDE) {
      if (ctx === mio) ACTIONS['vehiculo-eliminar-cerrar']();
      showToast(`No se pudo confirmar la eliminación${coche ? ' de ' + coche : ''}. Revisar la lista de vehículos antes de reintentar`, true);
      switchView('vehiculos');
      return;
    }
    if (res.error) throw res.error;
    if (ctx === mio) ACTIONS['vehiculo-eliminar-cerrar']();
    showToast(`${coche || 'Vehículo'} eliminado. ${r.resumen}`);
    // Siempre: aun con destino «baja» los neumáticos dejan el catálogo de la búsqueda global (los montados del vehículo).
    document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
    switchView('vehiculos');
  } catch (e) {
    console.error(e);
    const msg = traducirErrorEliminar(e);
    // Ya eliminado (otra pestaña u otro intento): el estado real es la lista, no este diálogo.
    if (e && e.code === 'P0002') {
      if (ctx === mio) ACTIONS['vehiculo-eliminar-cerrar']();
      showToast(msg, true);
      switchView('vehiculos');
      return;
    }
    if (ctx === mio) $('veh-elim-error').textContent = msg;
    showToast(msg, true);
    if (ctx === mio) enCurso(false);
  } finally { ocupado = false; }
};

export function init() {
  // «Enter» envía (docs/14 §5 r.3); el clic en «Eliminar vehículo» llega también como submit.
  $('veh-elim-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['vehiculo-eliminar-confirmar'](); });
  // Enter mantenido (autorepetición): solo cuenta la primera pulsación.
  $('veh-elim-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
}
