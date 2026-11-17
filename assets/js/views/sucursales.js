// Sucursales del cliente con perfil global (menú Empresa): crear, renombrar y eliminar sucursales y mover vehículos entre
// ellas. El alta de vehículos vive en la vista Vehículos. Toda escritura pasa por RPC (sucursal_crear, sucursal_renombrar,
// sucursal_eliminar, vehiculo_mover_sucursal): la autorización y el aislamiento por cliente se verifican en la base, no aquí.
import { db } from '../core/supabase.js';
import { html, setHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { currentClienteId, esAdminEmpresa, onLogout } from '../core/auth.js';
import { registerActions } from '../core/actions.js';
import { registerView } from '../core/nav.js';
import { refrescarSucursales } from '../core/seccional.js';
import { etiquetaCoche } from '../domain/coche.js';
import {
  validarNombreSucursal, argsMover, contarPorSucursal, filtrarVehiculos,
  textoSucursal, avisoMovido, confirmacionEliminar, mensajeErrorGestion,
} from '../domain/sucursales.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 100;
let sucursales = [], vehiculos = [];
let cargando = 0; // descarta respuestas de cargas superadas

const err = msg => { const el = $('suc-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
const porId = id => sucursales.find(s => String(s.id) === String(id));
const vehPorId = id => vehiculos.find(v => String(v.id) === String(id));

function opciones(seleccion, primera) {
  return [html`<option value="" ${!seleccion && seleccion !== 0 ? 'selected' : ''}>${primera}</option>`,
    ...sucursales.map(s => html`<option value="${s.id}" ${String(seleccion) === String(s.id) ? 'selected' : ''}>${s.nombre}</option>`)];
}

function renderSucursales() {
  // La recarga de otra operación no debe pisar un nombre escrito y aún sin guardar en otra fila.
  const sinGuardar = new Map();
  for (const s of sucursales) {
    const inp = $(`suc-n-${s.id}`);
    if (inp && inp.value !== inp.defaultValue) sinGuardar.set(String(s.id), inp.value);
  }
  const cuentas = contarPorSucursal(vehiculos);
  setHtml($('suc-lista'), sucursales.length
    ? html`<table class="sec-tabla"><thead><tr><th scope="col">Nombre</th><th scope="col">Vehículos</th><th scope="col"></th></tr></thead><tbody>${
      sucursales.map(s => html`<tr data-sucursal="${s.id}">
        <td><input type="text" id="suc-n-${s.id}" value="${s.nombre}" maxlength="100" aria-label="Nombre de la sucursal"/></td>
        <td data-label="Vehículos">${cuentas.get(String(s.id)) || 0}</td>
        <td class="sec-acciones">
          <button type="button" class="btn ghost" data-action="sucursalRenombrar" data-args="[${s.id}]">Guardar nombre</button>
          <button type="button" class="btn ghost" data-action="sucursalEliminar" data-args="[${s.id}]">Eliminar</button>
        </td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin sucursales. Usar «Agregar sucursal» para crear la primera.</div>`);
  for (const [id, valor] of sinGuardar) { const inp = $(`suc-n-${id}`); if (inp) inp.value = valor; }
}

function renderVehiculos() {
  const todos = filtrarVehiculos(vehiculos, $('suc-buscar').value);
  const filas = todos.slice(0, MAX_FILAS);
  if (!vehiculos.length) { setHtml($('suc-vehiculos'), html`<div class="salud-muted">Sin vehículos registrados</div>`); return; }
  if (!todos.length) { setHtml($('suc-vehiculos'), html`<div class="salud-muted">Ningún vehículo coincide. Revisar la matrícula o el número de coche.</div>`); return; }
  setHtml($('suc-vehiculos'), html`<table class="sec-tabla"><thead><tr><th scope="col">Vehículo</th><th scope="col">Matrícula</th><th scope="col">Sucursal</th></tr></thead><tbody>${
    filas.map(v => html`<tr data-vehiculo="${v.id}"><td>${etiquetaCoche(v.nombre)}${v.activo === false ? ' (inactivo)' : ''}</td>
      <td class="mono-cell" data-label="Matrícula">${v.patente || '—'}</td>
      <td data-label="Sucursal"><select class="flota-select" data-change="sucursalMover" data-args="[${v.id}]" aria-label="Sucursal del vehículo">${opciones(v.sucursal_id, 'Sin sucursal')}</select></td></tr>`)}</tbody></table>${
    todos.length > filas.length ? html`<div class="salud-muted">Se muestran ${filas.length} de ${todos.length}. Usar el buscador para acotar.</div>` : ''}`);
}

function render() { renderSucursales(); renderVehiculos(); }

export async function loadSucursales() {
  if (!esAdminEmpresa()) return;
  const mio = ++cargando;
  err('');
  const [s, v] = await Promise.all([
    db.from('sucursales').select('id,nombre').eq('cliente_id', currentClienteId).order('nombre'),
    db.from('vehiculos').select('id,nombre,numero,patente,sucursal_id,activo').eq('cliente_id', currentClienteId).order('nombre'),
  ]);
  if (mio !== cargando) return;
  const e = s.error || v.error;
  if (e) { showToast(userError(e), true); return; }
  sucursales = s.data || []; vehiculos = v.data || [];
  render();
}

// Recarga la vista y el selector global de sucursales (barra superior).
async function recargar() {
  await Promise.all([loadSucursales(), refrescarSucursales()]);
}

// Ejecuta una RPC; ante error muestra el mensaje y devuelve false. Si sale bien devuelve el resultado (o true).
// La guarda es por operación y objetivo (`crear`, `renombrar:<id>`, `mover:<vehiculoId>`): con Enter repetido cada envío
// lanzaba su propia RPC (la segunda creación daba 23505 tras «Sucursal creada»), así que el doble envío de la MISMA operación
// se descarta. Operaciones distintas no se pierden: se encolan y corren en serie, cada una con su recarga del estado real.
const enCurso = new Set();
let cola = Promise.resolve();
async function ejecutar(nombre, args, okMsg) {
  err('');
  const { data, error } = await db.rpc(nombre, args);
  if (error) {
    const m = mensajeErrorGestion(error);
    if (m.startsWith('No se pudo')) userError(error);
    err(m); showToast(m, true);
    await loadSucursales(); // deja el select en el valor real
    return false;
  }
  if (okMsg) showToast(okMsg);
  await recargar();
  return data || true;
}
function rpc(clave, nombre, args, okMsg) {
  if (enCurso.has(clave)) { loadSucursales(); return Promise.resolve(false); } // el control vuelve a su valor real
  enCurso.add(clave);
  const corrida = cola.then(() => ejecutar(nombre, args, okMsg));
  cola = corrida.catch(() => {});
  return corrida.finally(() => enCurso.delete(clave));
}

const ACCIONES = {
  sucursalesRecargar: () => loadSucursales(),
  async sucursalCrear() {
    const v = validarNombreSucursal($('suc-nombre').value);
    if (!v.ok) { err(v.error); return; }
    if (await rpc('crear', 'sucursal_crear', { p_nombre: v.valor }, 'Sucursal creada')) $('suc-nombre').value = '';
  },
  async sucursalRenombrar(id) {
    const v = validarNombreSucursal($(`suc-n-${id}`).value);
    if (!v.ok) { err(v.error); return; }
    await rpc(`renombrar:${id}`, 'sucursal_renombrar', { p_sucursal_id: Number(id), p_nombre: v.valor }, 'Sucursal actualizada');
  },
  async sucursalEliminar(id) {
    const s = porId(id);
    if (!s) return;
    const n = vehiculos.filter(v => String(v.sucursal_id) === String(id)).length;
    const c = confirmacionEliminar(s.nombre, n);
    // Con vehículos asociados no hay nada que confirmar: se informa y no se llama a la base.
    if (n > 0) { err(c.mensaje); showToast(c.mensaje, true); return; }
    if (!await confirmDialog(c.titulo, c.mensaje, 'Eliminar', true)) return;
    await rpc(`eliminar:${id}`, 'sucursal_eliminar', { p_sucursal_id: Number(id) }, 'Sucursal eliminada');
  },
  async sucursalMover(vehiculoId, valor) {
    const v = vehPorId(vehiculoId);
    if (!v) return;
    if (String(v.sucursal_id ?? '') === String(valor)) return;
    // Sin diálogo: es reversible (basta elegir la sucursal anterior) y el historial no cambia.
    await rpc(`mover:${vehiculoId}`, 'vehiculo_mover_sucursal', argsMover(vehiculoId, valor), avisoMovido(v, textoSucursal(v.sucursal_id, sucursales), textoSucursal(valor, sucursales)));
  },
};
registerActions(ACCIONES);

registerView('sucursales', 'Sucursales', loadSucursales);
// La entrada del menú (sección Empresa, `data-empresa-only`) la muestra core/auth.js solo al administrador de empresa.
onLogout(() => { sucursales = []; vehiculos = []; });

export function init() {
  $('suc-buscar').addEventListener('input', renderVehiculos);
  // Enter en «Agregar sucursal» crea la sucursal; Enter en el nombre de una fila guarda el nombre.
  $('suc-form').addEventListener('submit', e => { e.preventDefault(); ACCIONES.sucursalCrear(); });
  $('suc-lista').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    const tr = e.target.closest('tr[data-sucursal]');
    if (tr) ACCIONES.sucursalRenombrar(tr.dataset.sucursal);
  });
}
