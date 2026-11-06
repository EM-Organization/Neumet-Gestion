import { db } from './supabase.js';
import { userError } from './ui.js';

// ── MODO CLIENTE ─────────────────────────────────
// null = admin (ve todo), número = cliente (ve solo lo suyo). Exportados como live bindings (solo auth.js los modifica).
export let currentClienteId=null, currentClienteNombre='';
// Seccional del perfil (null = perfil global del cliente o admin). Un perfil de seccional solo recibe de la RLS lo de su seccional.
export let currentSucursalId=null;

export function isClienteMode(){ return currentClienteId!==null; }

// Hooks: las vistas se enganchan sin que auth.js las importe.
//   onLogin(({cliente,user})=>...)  se ejecuta tras mostrar la app (en orden de registro)
//   onLogout(()=>...)               se ejecuta al cerrar sesión (reset de estado de la vista)
const loginHooks=[], logoutHooks=[];
export function onLogin(fn){ loginHooks.push(fn); }
export function onLogout(fn){ logoutHooks.push(fn); }

function applyClienteMode(){
  // Ocultar elementos admin-only
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display='none'; });
  // Mostrar elementos cliente-only
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display=''; });
  // Badge dispositivos no aplica a clientes
  document.getElementById('nav-unreg-badge').style.display='none';
  // Mostrar nombre del cliente en el sidebar
  document.getElementById('user-email').textContent=currentClienteNombre||'Cliente';
  document.getElementById('user-role').textContent=currentSucursalId!==null?'Seccional':'Cliente';
}

// Resuelve admin vs cliente. Primero el perfil (cubre usuarios de seccional, que no figuran en clientes.auth_user_id);
// si no hay perfil de cliente, se usa el vínculo clientes.auth_user_id (cuentas anteriores a las seccionales).
async function resolverRol(userId){
  currentClienteId=null; currentClienteNombre=''; currentSucursalId=null;
  const {data:perfil}=await db.from('perfiles').select('rol,cliente_id,sucursal_id').eq('user_id',userId).maybeSingle();
  if(perfil&&perfil.rol==='cliente'&&perfil.cliente_id!=null){
    const {data:c}=await db.from('clientes').select('id,nombre').eq('id',perfil.cliente_id).maybeSingle();
    if(c){ currentClienteId=c.id; currentClienteNombre=c.nombre; currentSucursalId=perfil.sucursal_id??null; return; }
  }
  const {data:clienteRow}=await db.from('clientes').select('id,nombre').eq('auth_user_id',userId).maybeSingle();
  if(clienteRow){ currentClienteId=clienteRow.id; currentClienteNombre=clienteRow.nombre; }
}

// AUTH — detecta rol
export async function checkAuth(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){ showLogin(); return; }
  await resolverRol(session.user.id);
  showApp(session.user);
}

function showLogin(){
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}
function showApp(user){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-email').textContent=user.email;
  document.getElementById('user-avatar').textContent=user.email[0].toUpperCase();
  if(isClienteMode()) applyClienteMode();
  loginHooks.forEach(fn=>fn({cliente:isClienteMode(),user}));
}

export function initAuth(){
  document.getElementById('login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const email=document.getElementById('login-email').value.trim();
    const pass=document.getElementById('login-password').value;
    const btn=document.getElementById('login-btn');
    const err=document.getElementById('login-error');
    btn.disabled=true; btn.textContent='Iniciando...'; err.classList.remove('show');
    const {data,error}=await db.auth.signInWithPassword({email,password:pass});
    btn.disabled=false; btn.textContent='Iniciar sesión';
    if(error){
      err.textContent=(error.message==='Invalid login credentials'||error.code==='invalid_credentials')?'Email o contraseña incorrectos':userError(error);
      err.classList.add('show'); return;
    }
    await resolverRol(data.user.id);
    showApp(data.user);
  });

  document.getElementById('logout-btn').addEventListener('click',async()=>{
    await db.auth.signOut();
    logoutHooks.forEach(fn=>fn()); currentClienteId=null; currentClienteNombre=''; currentSucursalId=null;
    // Restaurar visibilidad original
    document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display=''; });
    document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display='none'; });
    document.getElementById('user-role').textContent='Administrador';
    showLogin();
  });
  db.auth.onAuthStateChange(ev=>{ if(ev==='SIGNED_OUT') showLogin(); });
}
