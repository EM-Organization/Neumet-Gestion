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
// Guarda por operación y objetivo, SOLO en los formularios `crear`, `renombrar:<id>` y `eliminar:<id>`: con Enter repetido cada envío
// lanzaba su propia RPC (la segunda creación daba 23505 tras «Sucursal creada»), así que el doble envío de la MISMA operación se descarta.
// «Mover» NO se guarda: un cambio de select es idempotente y descartar la re-elección dejaba al vehículo en el destino anterior
// (corregir de Montevideo a Salto con la primera RPC en curso, o bajar dos opciones con el teclado). Se serializa por vehículo (ver
// `moverVehiculo`): la siguiente espera a la anterior de ESE vehículo y corre solo el último destino pedido. Operaciones sobre otros
// vehículos o formularios no se esperan: una cola global dejaba todo detrás de una RPC lenta. Las recargas superadas las descarta `cargando`.
const enCurso = new Set();
async function ejecutar(nombre, args, okMsg, alAplicar) {
  err('');
  const { data, error } = await db.rpc(nombre, args);
  if (error) {
    const m = mensajeErrorGestion(error);
    if (m.startsWith('No se pudo')) userError(error);
    await loadSucursales(); // deja el select en el valor real
    err(m); showToast(m, true); // después de la recarga, que limpia el error
    return false;
  }
  if (alAplicar) alAplicar(); // antes de recargar: una recarga descartada no puede dejar la lista contradiciendo lo ya aplicado
  if (okMsg) showToast(okMsg);
  await recargar();
  return data || true;
}
// id de vehículo -> {pendiente}: presente mientras hay un mover de ese vehículo en vuelo; `pendiente` es el último destino pedido ({valor}) o null.
const moviendo = new Map();
async function moverVehiculo(id, valor) {
  const activo = moviendo.get(id);
  if (activo) { activo.pendiente = { valor }; return false; } // gana el último; la corrida activa lo toma al terminar
  const mia = { pendiente: null };
  moviendo.set(id, mia);
  let ok = false;
  try {
    const v = vehPorId(id);
    // El origen NO se relee de `vehiculos` en cada vuelta: la recarga de un mover anterior puede haberse descartado y la lista quedar vieja.
    // Se parte del valor de la lista al empezar y, tras cada RPC exitosa, el origen es el destino que se acaba de aplicar.
    let origen = v ? v.sucursal_id : null;
    let destino = { valor };
    // Tras cerrar sesión `moviendo` se vacía: si esta corrida ya no es la vigente, no ejecuta lo que quedó pendiente con la sesión del siguiente usuario.
    while (destino && v && moviendo.get(id) === mia) {
      if (String(origen ?? '') !== String(destino.valor)) {
        // Sin diálogo: es reversible (basta elegir la sucursal anterior) y el historial no cambia.
        const nuevo = destino.valor === '' ? null : destino.valor;
        // La lista local se actualiza apenas la RPC se aplica: la recarga que sigue puede descartarse (otra más nueva) y `sucursalMover`
        // compararía el «mismo valor» contra un dato viejo, perdiendo la elección siguiente sin RPC ni aviso.
        const alAplicar = () => { const l = vehPorId(id); if (l && moviendo.get(id) === mia) l.sucursal_id = nuevo; };
        const hecho = await ejecutar('vehiculo_mover_sucursal', argsMover(id, destino.valor), avisoMovido(v, textoSucursal(origen, sucursales), textoSucursal(destino.valor, sucursales)), alAplicar);
        if (hecho) { ok = true; origen = nuevo; }
      }
      destino = mia.pendiente;
      mia.pendiente = null;
    }
  } finally { if (moviendo.get(id) === mia) moviendo.delete(id); } // una corrida nueva (tras cerrar sesión) conserva su entrada
  return ok;
}
function rpc(clave, nombre, args, okMsg) {
  if (enCurso.has(clave)) { loadSucursales(); return Promise.resolve(false); } // el control vuelve a su valor real
  enCurso.add(clave);
  const corrida = ejecutar(nombre, args, okMsg);
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
    // Sin mover en vuelo, el mismo valor no hace nada; con uno en vuelo se encola (el valor real aún puede cambiar).
    if (!moviendo.has(vehiculoId) && String(v.sucursal_id ?? '') === String(valor)) return;
    await moverVehiculo(vehiculoId, valor);
  },
};
registerActions(ACCIONES);

registerView('sucursales', 'Sucursales', loadSucursales);
// La entrada del menú (sección Empresa, `data-empresa-only`) la muestra core/auth.js solo al administrador de empresa.
onLogout(() => { sucursales = []; vehiculos = []; enCurso.clear(); moviendo.clear(); });

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
