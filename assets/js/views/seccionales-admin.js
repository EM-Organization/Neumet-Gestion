import { db } from '../core/supabase.js';
import { html, setHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode } from '../core/auth.js';
import { registerActions } from '../core/actions.js';
import { mensajeErrorSeccional } from '../domain/seccional.js';
import { textoAlcance, ordenarUsuarios, ESTADO_QUITADO } from '../domain/empresa.js';

// Sucursales y usuarios en la ficha de cliente (solo equipo Neumet). Es SOLO LECTURA (docs/17 §4.1, PR 9): crear, renombrar o
// eliminar sucursales, mover vehículos y crear usuarios los hace el administrador de la empresa (Empresa y Sucursales).
// Única escritura que conserva Neumet: asignar un dispositivo (hardware) a una sucursal. Los usuarios salen de la RPC
// usuarios_empresa_listar (email real, sin leer la tabla de usuarios).
const $ = id => document.getElementById(id);
let clienteId = null;
let secs = [], vehs = [], disps = [], usuarios = [];

const err = msg => { const el = $('sec-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
const sinValor = v => v === null || v === undefined;
const nombreDe = id => (secs.find(s => String(s.id) === String(id)) || {}).nombre || '';

function opciones(seleccion, primera) {
  return [html`<option value="" ${sinValor(seleccion) ? 'selected' : ''}>${primera}</option>`,
    ...secs.map(s => html`<option value="${s.id}" ${String(seleccion) === String(s.id) ? 'selected' : ''}>${s.nombre}</option>`)];
}

function renderLista() {
  setHtml($('sec-lista'), secs.length ? html`<table class="sec-tabla"><thead><tr><th>Sucursal</th><th>Vehículos</th><th>Dispositivos</th><th>Usuarios</th></tr></thead><tbody>${
    secs.map(s => html`<tr data-sucursal="${s.id}">
      <td>${s.nombre}</td>
      <td>${vehs.filter(v => String(v.sucursal_id) === String(s.id)).length}</td>
      <td>${disps.filter(d => String(d.sucursal_id) === String(s.id)).length}</td>
      <td>${usuarios.filter(u => u.estado !== ESTADO_QUITADO && String(u.sucursal_id) === String(s.id)).length}</td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Este cliente aún no tiene sucursales: todos sus usuarios ven toda la flota.</div>`);
}

function renderAsignacion() {
  setHtml($('sec-vehiculos'), vehs.length ? html`<table class="sec-tabla"><thead><tr><th>Vehículo</th><th>Sucursal</th></tr></thead><tbody>${
    vehs.map(v => html`<tr data-vehiculo="${v.id}"><td>${v.nombre}${v.patente ? html` <span class="dash-fleet-pat">${v.patente}</span>` : ''}</td>
      <td>${sinValor(v.sucursal_id) ? 'Sin sucursal' : (nombreDe(v.sucursal_id) || 'Sucursal')}</td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin vehículos.</div>`);
  setHtml($('sec-dispositivos'), disps.length ? html`<table class="sec-tabla"><thead><tr><th>Dispositivo</th><th>Sucursal</th></tr></thead><tbody>${
    disps.map(d => html`<tr data-dispositivo="${d.id}"><td>${d.nombre || 'Sin nombre'} <span class="mono-cell">${d.mac_address}</span></td>
      <td><select class="flota-select" data-change="seccionalAsignarDisp" data-args="[${d.id}]" aria-label="Sucursal del dispositivo">${opciones(d.sucursal_id, 'Sin sucursal (solo perfil global)')}</select></td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin dispositivos.</div>`);
}

function renderUsuarios() {
  const lista = ordenarUsuarios(usuarios);
  setHtml($('sec-usuarios'), lista.length ? html`<table class="sec-tabla"><thead><tr><th>Usuario</th><th>Alcance</th><th>Estado</th></tr></thead><tbody>${
    lista.map(u => html`<tr data-user="${u.user_id}"><td>${u.email || ('ID ' + String(u.user_id).slice(0, 8))}</td>
      <td><span class="badge ${sinValor(u.sucursal_id) ? 'blue' : 'orange'}">${textoAlcance(u)}</span></td>
      <td>${u.estado === ESTADO_QUITADO ? 'Acceso quitado' : 'Con acceso'}</td></tr>`)}</tbody></table>`
    : html`<div class="salud-muted">Sin usuarios.</div>`);
}

function render() { renderLista(); renderAsignacion(); renderUsuarios(); }

export async function cargarSeccionalesAdmin(id) {
  if (isClienteMode()) return;
  clienteId = id;
  const card = $('ficha-seccionales');
  if (id == null) { card.style.display = 'none'; return; }
  card.style.display = '';
  err('');
  const [s, v, d, u] = await Promise.all([
    db.from('sucursales').select('id,nombre').eq('cliente_id', id).order('nombre'),
    db.from('vehiculos').select('id,nombre,patente,sucursal_id').eq('cliente_id', id).eq('activo', true).order('nombre'),
    db.from('dispositivos').select('id,mac_address,nombre,sucursal_id').eq('cliente_id', id).order('mac_address'),
    db.rpc('usuarios_empresa_listar', { p_cliente_id: id }),
  ]);
  if (clienteId !== id) return; // el admin cambió de cliente mientras cargaba
  const e = s.error || v.error || d.error;
  if (e) { showToast(userError(e), true); return; }
  secs = s.data || []; vehs = v.data || []; disps = d.data || [];
  // La lista de usuarios es informativa: si falla, el resto de la tarjeta sigue útil.
  usuarios = u.error ? [] : (u.data || []);
  if (u.error) err('No se pudo cargar la lista de usuarios.');
  render();
}

registerActions({
  async seccionalAsignarDisp(id, valor) {
    err('');
    const { error } = await db.from('dispositivos').update({ sucursal_id: valor ? Number(valor) : null }).eq('id', id);
    if (error) { const m = mensajeErrorSeccional(error); if (m.startsWith('No se pudo')) userError(error); err(m); showToast(m, true); return; }
    showToast('Dispositivo asignado');
    await cargarSeccionalesAdmin(clienteId);
  },
});

export function init() { /* todo va por data-action / data-change */ }
