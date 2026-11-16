// Selector de sucursal del cliente. Un perfil GLOBAL con sucursales elige "Todas / Montevideo / Salto..." y las vistas
// filtran por vehiculos.sucursal_id. Un perfil de SUCURSAL no ve el selector: la RLS ya limita todo a su sucursal.
import { db } from './supabase.js';
import { html, setHtml, joinHtml } from './html.js';
import { onLogin, onLogout, isClienteMode, currentClienteId, esUsuarioSucursal } from './auth.js';
import { reloadActiveView, onEntrarVista } from './nav.js';
import { registerActions } from './actions.js';
import { idsVehiculosDeSucursal, filtrarPorVehiculos, mostrarSelector, selectorEnVista, seleccionAplica } from '../domain/seccional.js';

let sucursales = [];      // [{id, nombre}] visibles para el usuario (RLS)
let vehiculos = [];       // [{id, sucursal_id}]
let seleccion = '';       // '' = todas
let listo = Promise.resolve();
let vista = null;         // vista activa: el selector solo se muestra donde filtra (domain/seccional.js)

const $ = id => document.getElementById(id);

// Oyentes del cambio de sucursal (las islas lo reciben por ctx.onCambioSucursal; las vistas viejas siguen con reloadActiveView).
const oyentes = new Set();
export function onCambioSucursal(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

export const sucursalSeleccionada = () => seleccion;
export const listaSucursales = () => sucursales.slice();
export const nombreSucursal = id => (sucursales.find(s => String(s.id) === String(id)) || {}).nombre || '';
// Solo filtra en las vistas donde el selector se ve (domain/seccional.js: seleccionAplica); en las demás la selección se ignora.
export const hayFiltroSeccional = () => isClienteMode() && seleccionAplica(vista, seleccion);
// Espera a que el contexto (sucursales y vehículos) esté cargado tras el login.
export const contextoListo = () => listo;

// Ids de vehículo de la sucursal elegida (null = sin filtro).
export const idsSeleccionados = () => (hayFiltroSeccional() ? idsVehiculosDeSucursal(vehiculos, seleccion) : null);
export const filtrarFilas = (rows, key = 'vehiculo_id') => filtrarPorVehiculos(rows, idsSeleccionados(), key);
// Aplica el filtro a una consulta de columna sucursal_id (vehiculos, dispositivos).
export const filtrarConsulta = q => (hayFiltroSeccional() ? q.eq('sucursal_id', seleccion) : q);

function render() {
  const wrap = $('sec-selector');
  if (!wrap) return;
  const hay = isClienteMode() && mostrarSelector({ esSeccional: esUsuarioSucursal(), sucursales });
  wrap.style.display = hay && selectorEnVista(vista) ? '' : 'none';
  if (!hay) return;
  // Las opciones se mantienen al día también con el selector oculto (p. ej. tras crear una sucursal en su vista).
  setHtml($('sec-select'), joinHtml([html`<option value="">Todas las sucursales</option>`,
    ...sucursales.map(s => html`<option value="${s.id}">${s.nombre}</option>`)]));
  $('sec-select').value = seleccion;
}

async function cargar(conservar = false) {
  if (!conservar) seleccion = '';
  sucursales = []; vehiculos = [];
  if (!isClienteMode()) { render(); return; }
  const [s, v] = await Promise.all([
    db.from('sucursales').select('id,nombre').eq('cliente_id', currentClienteId).order('nombre'),
    db.from('vehiculos').select('id,sucursal_id').eq('cliente_id', currentClienteId),
  ]);
  // Si falla (p. ej. migración de sucursales sin aplicar) el panel sigue funcionando sin selector.
  sucursales = s.error ? [] : (s.data || []);
  vehiculos = v.error ? [] : (v.data || []);
  // Si la sucursal elegida ya no existe (se eliminó), vuelve a «Todas».
  if (!sucursales.some(x => String(x.id) === String(seleccion))) seleccion = '';
  render();
}

onEntrarVista(v => { vista = v; render(); });

// Recarga sucursales y vehículos tras gestionarlos (alta, baja, movimiento) sin perder la selección vigente.
export function refrescarSucursales() { listo = cargar(true); return listo; }

registerActions({
  seccionalCambiar(valor) {
    seleccion = valor || '';
    // Un oyente de isla que lance no puede impedir la recarga de la vista activa ni a los demás oyentes: cada uno va aislado.
    // console.warn y no console.error: es un fallo de la isla, no del flujo del panel, y no debe ensuciar un flujo que sigue sano.
    oyentes.forEach(fn => { try { fn(seleccion || null); } catch (e) { console.warn('Un oyente de cambio de sucursal falló:', e?.message ?? e); } });
    reloadActiveView();
  },
});

// Debe registrarse ANTES que los onLogin de las vistas (se importa desde ellas): así `listo` ya existe cuando cargan.
onLogin(({ cliente }) => { listo = cliente ? cargar() : Promise.resolve(); });
onLogout(() => { seleccion = ''; sucursales = []; vehiculos = []; listo = Promise.resolve(); render(); });
