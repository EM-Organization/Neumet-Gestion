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

function desmontarIsla(nombre) {
  turnos.set(nombre, (turnos.get(nombre) ?? 0) + 1); // cancela un montaje que aún esté esperando
  const m = montadas.get(nombre);
  if (!m) return;
  montadas.delete(nombre);
  try { m.mod.desmontar(nombre); } finally {
    m.limpiezas.splice(0).forEach((baja) => baja());
    m.host.remove();
    m.ocultos.forEach((el) => { el.hidden = false; });
    if (m.creada) m.vista.remove();
  }
}

async function montarIsla(nombre) {
  const turno = (turnos.get(nombre) ?? 0) + 1;
  turnos.set(nombre, turno);
  const vigente = () => turnos.get(nombre) === turno && vistaActiva() === nombre;

  let mod;
  try { mod = await cargarModulo(); } catch (e) {
    // Sin build (smoke y visuales sirven el repositorio) o sin red: se sigue con la vista vieja; no es un error de la vista.
    console.warn('Panel nuevo no disponible; se muestra la vista actual.', e?.message ?? e);
    return false;
  }
  if (!vigente()) return false;
  if (mod.API_ISLAS !== API_ISLAS) {
    if (!avisadoDeVersion) { avisadoDeVersion = true; showToast('Hay una versión nueva del panel. Recargar la página para usarla.', true); }
    return false;
  }

  const { vista, creada } = vistaDe(nombre);
  const host = document.createElement('div');
  host.dataset.islaHost = nombre;
  vista.appendChild(host);
  const limpiezas = [];
  let montada = false;
  try { montada = await mod.montar(nombre, host, crearCtx(limpiezas)); } finally {
    if (!montada) { limpiezas.splice(0).forEach((baja) => baja()); host.remove(); if (creada) vista.remove(); }
  }
  if (!montada) return false;
  if (!vigente()) { // el usuario salió mientras se cargaban las hojas de estilo
    mod.desmontar(nombre); limpiezas.splice(0).forEach((baja) => baja()); host.remove(); if (creada) vista.remove();
    return false;
  }
  // La vista vieja (si la hay) se oculta mientras la isla está montada y se restaura al desmontar.
  const ocultos = [...vista.children].filter((el) => el !== host && !el.hidden);
  ocultos.forEach((el) => { el.hidden = true; });
  montadas.set(nombre, { mod, vista, creada, host, ocultos, limpiezas });
  return true;
}

// Registra una pantalla migrada. `viejo` (opcional) es el load de la vista vieja: se usa si la bandera está apagada para el rol
// o si el front nuevo no se pudo cargar. Acepta las mismas opciones de registerView (menu, soloAdmin, soloEmpresa).
export function registrarIsla(nombre, etiqueta, { viejo = null, ...opciones } = {}) {
  const cargar = async () => {
    if (montadas.has(nombre)) return; // recarga de la vista activa (p. ej. cambio de sucursal): la isla reacciona por ctx.onCambioSucursal
    const ok = await montarIsla(nombre);
    if (!ok && viejo && vistaActiva() === nombre) await viejo();
  };
  return registerView(nombre, etiqueta, cargar, opciones);
}

export const islaMontada = (nombre) => montadas.has(nombre);

onSalirVista((anterior) => desmontarIsla(anterior));
onLogin(({ user }) => { usuario = { id: user.id, email: user.email }; });
onLogout(() => { usuario = null; [...montadas.keys()].forEach(desmontarIsla); });
