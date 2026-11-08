import { db } from './supabase.js';
import { userError } from './ui.js';
import { decidirRol, puedeUsarPanel, ROL_ADMIN, ROL_SIN_ACCESO } from '../domain/rol.js';

// ── MODO CLIENTE ─────────────────────────────────
// null = admin (ve todo), número = cliente (ve solo lo suyo). Exportados como live bindings (solo auth.js los modifica).
export let currentClienteId=null, currentClienteNombre='';
// Sucursal del perfil (null = perfil global del cliente o admin). Un perfil de sucursal solo recibe de la RLS lo de su sucursal.
export let currentSucursalId=null;

// Rol resuelto de la sesión: 'admin' | 'cliente' | 'sin_acceso' (null = sin sesión). Solo auth.js lo modifica.
export let currentRol=null;

export function isClienteMode(){ return currentClienteId!==null; }
// Defensa en profundidad: nav.js y los loaders la consultan, sin confiar en que la pantalla correcta esté visible.
export function panelHabilitado(){ return puedeUsarPanel(currentRol); }
export function esAdmin(){ return currentRol===ROL_ADMIN; }

// Hooks: las vistas se enganchan sin que auth.js las importe.
//   onLogin(({cliente,user})=>...)  se ejecuta tras mostrar la app (en orden de registro)
//   onLogout(()=>...)               se ejecuta al cerrar sesión (reset de estado de la vista)
const loginHooks=[], logoutHooks=[];
export function onLogin(fn){ loginHooks.push(fn); }
export function onLogout(fn){ logoutHooks.push(fn); }

function applyClienteMode(){
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display='none'; });
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display=''; });
  // Badge dispositivos no aplica a clientes
  document.getElementById('nav-unreg-badge').style.display='none';
  document.getElementById('user-email').textContent=currentClienteNombre||'Cliente';
  document.getElementById('user-role').textContent=currentSucursalId!==null?'Sucursal':'Cliente';
}

// Resuelve el rol con decidirRol (domain/rol.js). Primero el perfil (cubre usuarios de sucursal, que no figuran en
// clientes.auth_user_id); si no hay perfil de cliente, se usa el vínculo clientes.auth_user_id (cuentas anteriores
// a las sucursales). Sin ninguno, o ante un error de consulta, la sesión queda «sin acceso» (falla cerrado).
async function resolverRol(userId){
  currentRol=ROL_SIN_ACCESO; currentClienteId=null; currentClienteNombre=''; currentSucursalId=null;
  const {data:perfil,error:ePerfil}=await db.from('perfiles').select('rol,cliente_id,sucursal_id').eq('user_id',userId).maybeSingle();
  if(ePerfil) return;
  let clientePerfil=null, clienteVinculado=null;
  if(perfil&&perfil.rol==='cliente'&&perfil.cliente_id!=null){
    ({data:clientePerfil}=await db.from('clientes').select('id,nombre').eq('id',perfil.cliente_id).maybeSingle());
  }
  if(!perfil||perfil.rol==='cliente'){
    ({data:clienteVinculado}=await db.from('clientes').select('id,nombre').eq('auth_user_id',userId).maybeSingle());
  }
  const r=decidirRol({perfil,clientePerfil,clienteVinculado});
  currentRol=r.rol; currentSucursalId=r.sucursalId;
  if(r.rol==='cliente'){ currentClienteId=r.clienteId; currentClienteNombre=r.clienteNombre; }
}

// AUTH — detecta rol
export async function checkAuth(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){ showLogin(); return; }
  await entrar(session.user);
}

// Tras resolver el rol: panel para admin/cliente; «Sin acceso» para el resto (sin cargar vistas ni datos).
async function entrar(user){
  await resolverRol(user.id);
  if(panelHabilitado()) showApp(user); else showSinAcceso();
}

function showLogin(){
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.add('hidden');
}
function showSinAcceso(){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.remove('hidden');
  document.getElementById('sin-acceso-cerrar').focus();
}
function showApp(user){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-email').textContent=user.email;
  document.getElementById('user-avatar').textContent=user.email[0].toUpperCase();
  if(isClienteMode()) applyClienteMode();
  else document.getElementById('user-role').textContent='Administrador';
  loginHooks.forEach(fn=>fn({cliente:isClienteMode(),user}));
}

export function initAuth(){
  document.getElementById('login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const email=document.getElementById('login-email').value.trim();
    const pass=document.getElementById('login-password').value;
    const btn=document.getElementById('login-btn');
    const err=document.getElementById('login-error');
    btn.disabled=true; btn.textContent='Iniciando…'; err.classList.remove('show');
    const {data,error}=await db.auth.signInWithPassword({email,password:pass});
    btn.disabled=false; btn.textContent='Iniciar sesión';
    if(error){
      err.textContent=(error.message==='Invalid login credentials'||error.code==='invalid_credentials')?'Email o contraseña incorrectos':userError(error);
      err.classList.add('show'); return;
    }
    await entrar(data.user);
  });

  const cerrarSesion=async()=>{ await db.auth.signOut(); limpiarSesion(); };
  document.getElementById('logout-btn').addEventListener('click',cerrarSesion);
  document.getElementById('sin-acceso-cerrar').addEventListener('click',cerrarSesion);
  // SIGNED_OUT también llega al cerrar sesión en otra pestaña o al expirar el token: mismo estado final que el botón.
  db.auth.onAuthStateChange(ev=>{ if(ev==='SIGNED_OUT') limpiarSesion(); });
}

// Idempotente: el botón y el evento SIGNED_OUT convergen aquí y los hooks de logout corren una sola vez.
function limpiarSesion(){
  if(currentRol!==null){
    currentRol=null; currentClienteId=null; currentClienteNombre=''; currentSucursalId=null;
    logoutHooks.forEach(fn=>fn());
    document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display=''; });
    document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display='none'; });
    document.getElementById('user-role').textContent='—';
  }
  showLogin();
}
