// Islas del front nuevo (F11, docs/19 §5.2): una pantalla migrada a Svelte se monta dentro del shell viejo.
// Cada pantalla se registra con registrarIsla(); su `load` importa /panel/islas.js (solo existe tras el build), arma el `ctx`
// versionado y monta la isla sobre `div#view-<nombre>`. Al salir de la vista, al cerrar sesión o si la bandera está apagada,
// el panel viejo queda exactamente como estaba. Este módulo no importa `views/*` ni nada de `src/`.
import { db } from './supabase.js';
import { registerView, switchView, hayVista, onSalirVista, vistaActiva } from './nav.js';
import { currentRol, currentClienteId, currentSucursalId, esAdmin, esAdminEmpresa, puedeVerPrecios, onLogin, onLogout } from './auth.js';
import { onCambioSucursal, sucursalSeleccionada } from './seccional.js';
import { showToast } from './ui.js';

// Versión del contrato `ctx`. Debe coincidir con API_ISLAS de src/registro.js: si no, la isla no se monta y se pide recargar
// (cubre el desfase de caché entre un panel viejo ya cargado y un islas.js nuevo; recarga forzada: docs/11 §7).
export const API_ISLAS = 1;

let usuario = null; // {id, email} de la sesión; lo fija el hook de login
let modulo = null;  // promesa del import dinámico (una sola por página; se descarta si falla para reintentar)
let avisadoDeVersion = false;
const montadas = new Map(); // nombre -> {mod, vista, creada, ocultos, limpiezas}
const turnos = new Map();   // nombre -> contador: invalida un montaje en vuelo si el usuario ya salió de la vista
const colas = new Map();    // nombre -> promesa del último montaje pedido: los montajes de una misma isla se encadenan

function cargarModulo() {
  modulo ??= import('/panel/islas.js').catch((e) => { modulo = null; throw e; });
  return modulo;
}

// ctx de UNA montada. Los valores de sesión son getters (siempre actuales); las suscripciones quedan registradas para
// soltarse al desmontar aunque la isla se olvide de hacerlo.
function crearCtx(limpiezas) {
  return Object.freeze({
    api: API_ISLAS,
    // El MISMO cliente del panel viejo: dos clientes dan «Multiple GoTrueClient» y se pisan los refrescos de sesión.
    db,
    get usuario() { return usuario; },
    get rol() { return currentRol; },
    get clienteId() { return currentClienteId; },
    get sucursalId() { return currentSucursalId; },
    get sucursalElegida() { return sucursalSeleccionada() || null; },
    get esAdmin() { return esAdmin(); },
    get esAdminEmpresa() { return esAdminEmpresa(); },
    get puedeVerPrecios() { return puedeVerPrecios(); },
    navegar(vista, ...args) {
      if (args.length) { console.error('navegar: los argumentos no existen en API_ISLAS=1'); return false; }
      if (!hayVista(vista)) { console.error('Vista desconocida: ' + vista); return false; }
      switchView(vista);
      return true;
    },
    showToast,
    onCambioSucursal(fn) {
      const baja = onCambioSucursal(fn);
      limpiezas.push(baja);
      return baja;
    },
  });
}

// Ocultar la vista vieja: `hidden` solo no alcanza, styles.css no tiene una regla global [hidden] y reglas como
// `.page-header { display: flex }` ganan al display:none del atributo. data-isla-oculto lo respalda con una regla acotada
// (assets/css/styles.css) que no afecta a nada que no haya ocultado una isla: con las banderas apagadas el panel no cambia.
function ocultarVieja(el) { el.hidden = true; el.dataset.islaOculto = ''; }
function mostrarVieja(el) { el.hidden = false; delete el.dataset.islaOculto; }

function vistaDe(nombre) {
  const existente = document.getElementById('view-' + nombre);
  if (existente) return { vista: existente, creada: false };
  // Pantalla que no tiene contenedor en adminpanel/index.html: se crea al montar y se retira al desmontar, para que con la
  // bandera apagada el DOM del panel viejo no cambie.
  const vista = document.createElement('div');
  vista.className = 'view active';
  vista.id = 'view-' + nombre;
  document.querySelector('#contenido .content')?.appendChild(vista);
  return { vista, creada: true };
}

// mod.desmontar de una isla puede lanzar (un componente que falla al destruirse): nunca debe saltarse la limpieza del DOM ni salir como
// excepción de un hook de navegación o de cierre de sesión (donde nadie la atendería). Se anota con console.warn y se sigue.
function desmontarModulo(mod, nombre) {
  try { mod.desmontar(nombre); } catch (e) { console.warn(`La isla ${nombre} falló al desmontarse; se limpia igual.`, e?.message ?? e); }
}

function desmontarIsla(nombre) {
  turnos.set(nombre, (turnos.get(nombre) ?? 0) + 1); // cancela un montaje que aún esté esperando
  const m = montadas.get(nombre);
  if (!m) return;
  montadas.delete(nombre);
  desmontarModulo(m.mod, nombre);
  m.limpiezas.splice(0).forEach((baja) => baja());
  m.host.remove();
  m.ocultos.forEach(mostrarVieja);
  if (m.creada) m.vista.remove();
}

// Los montajes de una misma isla corren de a uno: `mod.montar` desmonta por nombre la instancia anterior, así que dos en vuelo
// a la vez se pisaban (el superado desmontaba y retiraba la isla de quien sí seguía vigente). El superado termina y limpia lo suyo
// antes de que arranque el siguiente. Devuelve true (montada), false (no disponible: usar la vista vieja) o null (superado o cancelado).
function montarIsla(nombre) {
  const turno = (turnos.get(nombre) ?? 0) + 1;
  turnos.set(nombre, turno);
  const previa = (colas.get(nombre) ?? Promise.resolve()).catch(() => {});
  const p = previa.then(() => montarSerial(nombre, turno));
  colas.set(nombre, p);
  const soltar = () => { if (colas.get(nombre) === p) colas.delete(nombre); };
  p.then(soltar, soltar);
  return p;
}

async function montarSerial(nombre, turno) {
  const vigente = () => turnos.get(nombre) === turno && vistaActiva() === nombre;
  // Un montaje superado (otro pedido, salida de la vista o cierre de sesión) nunca debe disparar la vista vieja: null, no false.
  const sinMontar = () => (vigente() ? false : null);

  let mod;
  try { mod = await cargarModulo(); } catch (e) {
    // Sin build (smoke y visuales sirven el repositorio) o sin red: se sigue con la vista vieja; no es un error de la vista.
    console.warn('Panel nuevo no disponible; se muestra la vista actual.', e?.message ?? e);
    return sinMontar();
  }
  if (!vigente()) return null;
  if (mod.API_ISLAS !== API_ISLAS) {
    if (!avisadoDeVersion) { avisadoDeVersion = true; showToast('Hay una versión nueva del panel. Recargar la página para usarla.', true); }
    return sinMontar();
  }

  const { vista, creada } = vistaDe(nombre);
  const host = document.createElement('div');
  host.dataset.islaHost = nombre;
  vista.appendChild(host);
  const limpiezas = [];
  let montada = false;
  try { montada = await mod.montar(nombre, host, crearCtx(limpiezas)); } catch (e) {
    // La isla falló al montar: no se deja la vista vacía ni un rechazo sin atender; se cae a la vista vieja (false) y se anota
    // con console.warn (no es un error del flujo del panel). Si ya hay otro montaje en cola, este es null y no toca nada.
    console.warn(`La isla ${nombre} no se pudo montar; se muestra la vista actual.`, e?.message ?? e);
    // Si el componente alcanzó a montarse antes de fallar, sigue vivo en el registro del paquete: se desmonta por nombre
    // (no hace nada si no había nada montado).
    desmontarModulo(mod, nombre);
  } finally {
    if (!montada) { limpiezas.splice(0).forEach((baja) => baja()); host.remove(); if (creada) vista.remove(); }
  }
  if (!montada) return sinMontar();
  if (!vigente()) { // salió de la vista, o pidieron otro montaje, mientras se cargaban las hojas de estilo
    desmontarModulo(mod, nombre); limpiezas.splice(0).forEach((baja) => baja()); host.remove(); if (creada) vista.remove();
    return null;
  }
  // La vista vieja (si la hay) se oculta mientras la isla está montada y se restaura al desmontar.
  const ocultos = [...vista.children].filter((el) => el !== host && !el.hidden);
  ocultos.forEach(ocultarVieja);
  montadas.set(nombre, { mod, vista, creada, host, ocultos, limpiezas });
  return true;
}

// Registra una pantalla migrada. `viejo` (opcional) es el load de la vista vieja: se usa si la bandera está apagada para el rol
// o si el front nuevo no se pudo cargar. Acepta las mismas opciones de registerView (menu, soloAdmin, soloEmpresa).
export function registrarIsla(nombre, etiqueta, { viejo = null, ...opciones } = {}) {
  const cargar = async () => {
    if (montadas.has(nombre)) return; // recarga de la vista activa (p. ej. cambio de sucursal): la isla reacciona por ctx.onCambioSucursal
    const ok = await montarIsla(nombre);
    if (ok === false && viejo && vistaActiva() === nombre) await viejo();
  };
  return registerView(nombre, etiqueta, cargar, opciones);
}

export const islaMontada = (nombre) => montadas.has(nombre);

onSalirVista((anterior) => desmontarIsla(anterior));
onLogin(({ user }) => { usuario = { id: user.id, email: user.email }; });
onLogout(() => {
  usuario = null;
  // Un montaje en vuelo no está en `montadas`: sin subir su turno terminaría montándose con la sesión ya cerrada.
  for (const nombre of [...turnos.keys()]) turnos.set(nombre, turnos.get(nombre) + 1);
  [...montadas.keys()].forEach(desmontarIsla);
});
