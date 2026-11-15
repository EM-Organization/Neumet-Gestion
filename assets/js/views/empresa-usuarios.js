import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado } from '../core/componentes.js';
import { currentClienteId, onLogout } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { cuerpoCrearUsuario } from '../domain/seccional.js';
import {
  ESTADO_QUITADO, textoAlcance, ordenarUsuarios, accionesFila, cuerpoQuitar, cuerpoReponer, resultadoAcceso, mensajeCrearUsuarioEmpresa,
} from '../domain/empresa.js';

// Empresa > Usuarios (docs/17 §4.3): el administrador de empresa ve, crea, quita y repone a los usuarios de su empresa.
// La lista sale de la RPC usuarios_empresa_listar; quitar y reponer van por Edge Functions (cierran también la sesión en Auth).
// «Quitar acceso» borra el perfil: el usuario figura como «Quitado» y se puede reponer. La autorización la decide la base.
const $ = id => document.getElementById(id);
let usuarios = [], sucursales = [], miId = null, ocupado = false;
// Por usuario: qué ofrecer tras una respuesta que no dejó la operación hecha (502, 403 recargar_lista, elegir_sucursal...).
const pendientes = new Map();

async function llamarFuncion(nombre, cuerpo) {
  let status = 0, body = null;
  try {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(cuerpo),
    });
    status = res.status;
    body = await res.json();
  } catch { /* red o respuesta que no es JSON: status 0 o cuerpo nulo, se informa abajo */ }
  return { status, body };
}

const err = msg => { const el = $('emp-user-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };

function botonesFila(u) {
  const p = pendientes.get(u.user_id);
  const a = accionesFila(u, { propio: u.user_id === miId, suprimir: p ? p.suprimir : null });
  const out = [];
  if (p && p.ofrecer === 'sucursal') {
    out.push(html`<select class="flota-select" id="emp-suc-${u.user_id}" aria-label="Sucursal donde reponer">${sucursales.map(s => html`<option value="${s.id}">${s.nombre}</option>`)}</select>
      <button type="button" class="btn primary" data-action="empresaReponerEn" data-args="${JSON.stringify([u.user_id, u.acceso_id])}">Reponer en esa sucursal</button>`);
  } else if (p && p.ofrecer === 'reponer') {
    out.push(html`<button type="button" class="btn primary" data-action="empresaReponer" data-args="${JSON.stringify([u.user_id, p.accesoId])}">Reponer acceso</button>`);
  } else if (a.reponer) {
    out.push(html`<button type="button" class="btn primary" data-action="empresaReponer" data-args="${JSON.stringify([u.user_id, u.acceso_id])}">Reponer acceso</button>`);
  }
  // «Quitar» en toda fila quitada, tenga o no la marca de Auth (es informativa; repetir es idempotente).
  if (a.quitar) {
    out.push(html`<button type="button" class="btn ghost danger" data-action="empresaQuitar" data-args="${JSON.stringify([u.user_id, u.estado === ESTADO_QUITADO ? u.acceso_id : null])}">Quitar</button>`);
  }
  if (p && p.ofrecer === 'actualizar') out.push(html`<button type="button" class="btn ghost" data-action="empresaActualizar">Actualizar lista</button>`);
  return joinHtml(out);
}

function render() {
  const tbody = $('tbody-empresa-usuarios');
  if (!usuarios.length) { setHtml(tbody, filaEstado(4, estadoVacio('Sin usuarios', 'Crear el primero con el formulario de abajo.'))); return; }
  setHtml(tbody, joinHtml(ordenarUsuarios(usuarios).map(u => {
    const quitado = u.estado === ESTADO_QUITADO;
    const p = pendientes.get(u.user_id);
    return html`<tr data-user="${u.user_id}" data-estado="${u.estado}">
      <td>${u.email || ('ID ' + String(u.user_id).slice(0, 8))}${u.user_id === miId ? html` <span class="badge gray">Sesión actual</span>` : ''}${p ? html`<div class="salud-muted" role="status">${p.mensaje}</div>` : ''}</td>
      <td>${textoAlcance(u)}</td>
      <td>${quitado ? chip('gray', 'Quitado', '–') : chip('green', 'Vigente', '✓')}</td>
      <td><div class="actions">${botonesFila(u)}</div></td>
    </tr>`;
  })));
}

function renderAlcance() {
  setHtml($('emp-user-sucursal'), joinHtml([html`<option value="">Toda la empresa</option>`,
    ...sucursales.map(s => html`<option value="${s.id}">${s.nombre}</option>`)]));
}

export async function loadEmpresaUsuarios() {
  err('');
  setHtml($('tbody-empresa-usuarios'), filaEstado(4, estadoCarga('Cargando…')));
  const [u, s, ses] = await Promise.all([
    db.rpc('usuarios_empresa_listar'),
    db.from('sucursales').select('id,nombre').eq('cliente_id', currentClienteId).order('nombre'),
    db.auth.getSession(),
  ]);
  if (u.error || s.error) {
    if (u.error) userError(u.error);
    setHtml($('tbody-empresa-usuarios'), filaEstado(4, estadoError('', 'loadEmpresaUsuarios')));
    return;
  }
  usuarios = u.data || []; sucursales = s.data || [];
  miId = (ses && ses.data && ses.data.session && ses.data.session.user && ses.data.session.user.id) || null;
  // Un pendiente solo vale mientras el usuario sigue en la lista.
  for (const k of [...pendientes.keys()]) if (!usuarios.some(x => x.user_id === k)) pendientes.delete(k);
  renderAlcance();
  render();
}

// Una operación sobre un usuario: llama a la función, informa y relee la lista. `ocupado` evita dobles envíos (Enter, doble clic).
async function operar(op, userId, funcion, cuerpo) {
  if (ocupado) return;
  ocupado = true;
  try {
    const { status, body } = await llamarFuncion(funcion, cuerpo);
    const r = resultadoAcceso(op, status, body);
    if (r.ofrecer) pendientes.set(userId, { ofrecer: r.ofrecer, accesoId: r.accesoId, suprimir: r.suprimir, mensaje: r.mensaje }); else pendientes.delete(userId);
    showToast(r.mensaje, !r.ok);
    if (r.recargar) await loadEmpresaUsuarios(); else render();
  } finally { ocupado = false; }
}

ACTIONS.loadEmpresaUsuarios = loadEmpresaUsuarios;
// Actualizar desde una fila: descarta el aviso pendiente de esa fila y decide con el estado real de la base.
ACTIONS.empresaActualizar = () => { pendientes.clear(); return loadEmpresaUsuarios(); };
ACTIONS.empresaQuitar = async function (userId, accesoId) {
  const u = usuarios.find(x => x.user_id === userId);
  // Baja nueva: se confirma. Reintento de una baja ya decidida (fila quitada): sin diálogo.
  if (accesoId === null && !await confirmDialog('Quitar acceso', `¿Quitar el acceso de ${(u && u.email) || 'este usuario'}? Ya no podrá entrar. Se puede reponer después.`, 'Quitar', true)) return;
  await operar('quitar', userId, 'quitar-acceso-usuario', cuerpoQuitar(userId, accesoId));
};
ACTIONS.empresaReponer = (userId, accesoId) => operar('reponer', userId, 'reponer-acceso-usuario', cuerpoReponer(accesoId));
ACTIONS.empresaReponerEn = (userId, accesoId) => {
  const sel = $(`emp-suc-${userId}`);
  return operar('reponer', userId, 'reponer-acceso-usuario', cuerpoReponer(accesoId, sel ? sel.value : null));
};

async function crearUsuario() {
  if (ocupado) return;
  err('');
  const email = $('emp-user-email').value.trim();
  const password = $('emp-user-password').value;
  if (!email) { err('Falta el email del usuario'); return; }
  if (password && password.length < 12) { err('La contraseña debe tener al menos 12 caracteres (o dejarla vacía para enviar una invitación)'); return; }
  ocupado = true;
  const btn = $('emp-user-crear'); btn.disabled = true;
  try {
    const { status, body } = await llamarFuncion('crear-usuario-seccional',
      cuerpoCrearUsuario({ clienteId: currentClienteId, sucursalId: $('emp-user-sucursal').value, email, password }));
    if (!body || !body.ok) { const m = mensajeCrearUsuarioEmpresa(status, body); err(m); showToast(m, true); return; }
    $('emp-user-email').value = ''; $('emp-user-password').value = '';
    showToast(password ? 'Usuario creado' : 'Invitación enviada por email');
  } finally { btn.disabled = false; ocupado = false; }
  await loadEmpresaUsuarios();
}

export const load = loadEmpresaUsuarios;
registerView('empresa-usuarios', 'Usuarios', loadEmpresaUsuarios, { soloEmpresa: true });
onLogout(() => { usuarios = []; sucursales = []; miId = null; pendientes.clear(); });

export function init() {
  // Enter en el formulario crea el usuario (sin buscar el botón).
  $('emp-user-form').addEventListener('submit', e => { e.preventDefault(); crearUsuario(); });
}
