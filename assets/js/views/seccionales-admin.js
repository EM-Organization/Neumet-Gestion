import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode } from '../core/auth.js';
import { registerActions } from '../core/actions.js';
import {
  validarNombreSeccional, mensajeErrorSeccional, cuerpoCrearUsuario, mensajeErrorCrearUsuario,
} from '../domain/seccional.js';

// ABM de sucursales en la ficha de cliente (solo admin): crear/renombrar/eliminar sucursales, asignar vehículos y
// dispositivos, y crear usuarios (de sucursal o globales) con la función crear-usuario-seccional.
const $ = id => document.getElementById(id);
let clienteId = null;
let secs = [], vehs = [], disps = [], perfiles = [];

const err = msg => { const el = $('sec-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
const sinValor = v => v === null || v === undefined;
const nombreDe = id => (secs.find(s => String(s.id) === String(id)) || {}).nombre || '';

function opciones(seleccion, primera) {
  return [html`<option value="" ${sinValor(seleccion) ? 'selected' : ''}>${primera}</option>`,
    ...secs.map(s => html`<option value="${s.id}" ${String(seleccion) === String(s.id) ? 'selected' : ''}>${s.nombre}</option>`)];
}

function renderLista() {
  setHtml($('sec-lista'), secs.length ? html`<table class="sec-tabla"><thead><tr><th>Sucursal</th><th>Vehículos</th><th>Dispositivos</th><th>Usuarios</th><th></th></tr></thead><tbody>${
    secs.map(s => html`<tr data-sucursal="${s.id}">
      <td><input type="text" id="sec-n-${s.id}" value="${s.nombre}" maxlength="100" aria-label="Nombre de la sucursal"/></td>
      <td>${vehs.filter(v => String(v.sucursal_id) === String(s.id)).length}</td>
      <td>${disps.filter(d => String(d.sucursal_id) === String(s.id)).length}</td>
      <td>${perfiles.filter(p => String(p.sucursal_id) === String(s.id)).length}</td>
      <td class="sec-acciones">
        <button class="btn ghost" data-action="seccionalRenombrar" data-args="[${s.id}]">Guardar nombre</button>
        <button class="btn ghost danger" data-action="seccionalEliminar" data-args="[${s.id}]">Eliminar</button>
      </td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Este cliente aún no tiene sucursales: todos sus usuarios ven toda la flota.</div>`);
}

function renderAsignacion() {
  setHtml($('sec-vehiculos'), vehs.length ? html`<table class="sec-tabla"><thead><tr><th>Vehículo</th><th>Sucursal</th></tr></thead><tbody>${
    vehs.map(v => html`<tr data-vehiculo="${v.id}"><td>${v.nombre}${v.patente ? html` <span class="dash-fleet-pat">${v.patente}</span>` : ''}</td>
      <td><select class="flota-select" data-change="seccionalAsignarVeh" data-args="[${v.id}]" aria-label="Sucursal del vehículo">${opciones(v.sucursal_id, 'Sin sucursal (solo perfil global)')}</select></td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin vehículos.</div>`);
  setHtml($('sec-dispositivos'), disps.length ? html`<table class="sec-tabla"><thead><tr><th>Dispositivo</th><th>Sucursal</th></tr></thead><tbody>${
    disps.map(d => html`<tr data-dispositivo="${d.id}"><td>${d.nombre || 'Sin nombre'} <span class="mono-cell">${d.mac_address}</span></td>
      <td><select class="flota-select" data-change="seccionalAsignarDisp" data-args="[${d.id}]" aria-label="Sucursal del dispositivo">${opciones(d.sucursal_id, 'Sin sucursal (solo perfil global)')}</select></td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin dispositivos.</div>`);
}

function renderUsuarios() {
  setHtml($('sec-usuarios'), perfiles.length ? html`<table class="sec-tabla"><thead><tr><th>Usuario</th><th>Alcance</th></tr></thead><tbody>${
    perfiles.map(p => html`<tr><td>${p.email || ('ID ' + String(p.user_id).slice(0, 8))}</td>
      <td>${sinValor(p.sucursal_id) ? html`<span class="badge blue">Global (todas)</span>` : html`<span class="badge orange">${nombreDe(p.sucursal_id) || 'Sucursal'}</span>`}</td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin usuarios.</div>`);
  setHtml($('sec-user-sucursal'), joinHtml([html`<option value="">Global (ve todas las sucursales)</option>`,
    ...secs.map(s => html`<option value="${s.id}">${s.nombre}</option>`)]));
}

function render() { renderLista(); renderAsignacion(); renderUsuarios(); }

export async function cargarSeccionalesAdmin(id) {
  if (isClienteMode()) return;
  clienteId = id;
  const card = $('ficha-seccionales');
  if (id == null) { card.style.display = 'none'; return; }
  card.style.display = '';
  err('');
  const [s, v, d, p] = await Promise.all([
    db.from('sucursales').select('id,nombre').eq('cliente_id', id).order('nombre'),
    db.from('vehiculos').select('id,nombre,patente,sucursal_id').eq('cliente_id', id).eq('activo', true).order('nombre'),
    db.from('dispositivos').select('id,mac_address,nombre,sucursal_id').eq('cliente_id', id).order('mac_address'),
    db.from('perfiles').select('user_id,email,sucursal_id').eq('cliente_id', id).eq('rol', 'cliente').order('created_at'),
  ]);
  if (clienteId !== id) return; // el admin cambió de cliente mientras cargaba
  const e = s.error || v.error || d.error || p.error;
  if (e) { showToast(userError(e), true); return; }
  secs = s.data || []; vehs = v.data || []; disps = d.data || []; perfiles = p.data || [];
  render();
}

const recargar = () => cargarSeccionalesAdmin(clienteId);

async function guardar(fn, okMsg) {
  err('');
  const { error } = await fn();
  if (error) { const m = mensajeErrorSeccional(error); if (m.startsWith('No se pudo')) userError(error); err(m); showToast(m, true); return false; }
  if (okMsg) showToast(okMsg);
  await recargar();
  return true;
}

async function crearUsuario() {
  err('');
  const email = $('sec-user-email').value.trim();
  const password = $('sec-user-password').value;
  if (!email) { err('Falta el email del usuario'); return; }
  if (password && password.length < 12) { err('La contraseña debe tener al menos 12 caracteres (o déjala vacía para enviar una invitación)'); return; }
  const btn = $('sec-user-crear');
  btn.disabled = true;
  let res, result = null;
  try {
    const { data: { session } } = await db.auth.getSession();
    res = await fetch(`${SUPABASE_URL}/functions/v1/crear-usuario-seccional`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(cuerpoCrearUsuario({ clienteId, sucursalId: $('sec-user-sucursal').value, email, password })),
    });
    result = await res.json();
  } catch { /* red o respuesta no JSON: se informa abajo */ }
  finally { btn.disabled = false; }
  if (!res || !result || !result.ok) {
    const m = mensajeErrorCrearUsuario(res && res.status, result && result.error);
    err(m); showToast(m, true); return;
  }
  $('sec-user-email').value = ''; $('sec-user-password').value = '';
  showToast(password ? 'Usuario creado' : 'Invitación enviada por email');
  await recargar();
}

registerActions({
  async seccionalCrear() {
    const v = validarNombreSeccional($('sec-nombre').value);
    if (!v.ok) { err(v.error); return; }
    if (await guardar(() => db.from('sucursales').insert({ cliente_id: clienteId, nombre: v.valor }), 'Sucursal creada')) $('sec-nombre').value = '';
  },
  async seccionalRenombrar(id) {
    const v = validarNombreSeccional($(`sec-n-${id}`).value);
    if (!v.ok) { err(v.error); return; }
    await guardar(() => db.from('sucursales').update({ nombre: v.valor }).eq('id', id), 'Sucursal actualizada');
  },
  async seccionalEliminar(id) {
    if (!await confirmDialog('Eliminar sucursal', `¿Eliminar la sucursal "${nombreDe(id)}"? Solo es posible si no tiene vehículos, dispositivos ni usuarios.`)) return;
    await guardar(() => db.from('sucursales').delete().eq('id', id), 'Sucursal eliminada');
  },
  async seccionalAsignarVeh(id, valor) {
    await guardar(() => db.from('vehiculos').update({ sucursal_id: valor ? Number(valor) : null }).eq('id', id), 'Vehículo asignado');
  },
  async seccionalAsignarDisp(id, valor) {
    await guardar(() => db.from('dispositivos').update({ sucursal_id: valor ? Number(valor) : null }).eq('id', id), 'Dispositivo asignado');
  },
  seccionalCrearUsuario: crearUsuario,
});

export function init() { /* todo va por data-action / data-change */ }
