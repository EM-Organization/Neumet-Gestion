import { db } from './supabase.js';
import { userError } from './ui.js';
import { decidirRol, puedeUsarPanel, puedeVerPrecios as rolVePrecios, esAdminEmpresa as rolEsAdminEmpresa, esUsuarioSucursal as rolEsUsuarioSucursal, rotuloRol, ROL_ADMIN } from '../domain/rol.js';

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
// Administrador de empresa (cliente sin sucursal): única regla del panel para «puede gestionar su empresa» (docs/17 §4.3).
export function esAdminEmpresa(){ return rolEsAdminEmpresa(currentRol,currentSucursalId); }
export function esUsuarioSucursal(){ return rolEsUsuarioSucursal(currentRol,currentSucursalId); }
// Equipo Neumet o administrador de empresa: los únicos que reciben precios y costos (el de sucursal no; la base lo niega con 42501).
export function puedeVerPrecios(){ return rolVePrecios(currentRol,currentSucursalId); }

// Hooks: las vistas se enganchan sin que auth.js las importe.
//   onLogin(({cliente,user})=>...)  se ejecuta tras mostrar la app (en orden de registro)
//   onLogout(()=>...)               se ejecuta al cerrar sesión (reset de estado de la vista)
const loginHooks=[], logoutHooks=[];
export function onLogin(fn){ loginHooks.push(fn); }
export function onLogout(fn){ logoutHooks.push(fn); }

// Generación de sesión: sube al entrar otro usuario y al cerrar sesión. Un resultado de una generación anterior se descarta
// (p. ej. la consulta de perfil que volvió después de un SIGNED_OUT no debe mostrar el panel).
let generacion=0;
// Entrada en curso o resuelta de la generación actual: dedupe de login + SIGNED_IN simultáneos (una sola consulta de perfil).
let entrada=null; // {gen, userId, promesa}
// Id del usuario cuyo panel ya se mostró: TOKEN_REFRESHED no repite showApp ni los hooks de login.
let mostrado=null;

function applyClienteMode(){
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display='none'; });
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display=''; });
  // Menú Empresa: solo el administrador de empresa (el de sucursal y el equipo Neumet no lo ven).
  document.querySelectorAll('[data-empresa-only]').forEach(el=>{ el.style.display=esAdminEmpresa()?'':'none'; });
  // Badge dispositivos no aplica a clientes
  document.getElementById('nav-unreg-badge').style.display='none';
  document.getElementById('user-email').textContent=currentClienteNombre||'Cliente';
  document.getElementById('user-role').textContent=rotuloRol(currentRol,currentSucursalId);
}

// Consulta el rol con decidirRol (domain/rol.js). Primero el perfil (cubre usuarios de sucursal, que no figuran en
// clientes.auth_user_id); si no hay perfil de cliente, se usa el vínculo clientes.auth_user_id (cuentas anteriores
// a las sucursales). Devuelve el resultado sin tocar los globals: entrar() los confirma si la generación sigue vigente.
// Un error de consulta no es «sin acceso»: se devuelve {fallo:true} para mostrar «No se pudo cargar».
async function resolverRol(userId){
  const {data:perfil,error:ePerfil}=await db.from('perfiles').select('rol,cliente_id,sucursal_id').eq('user_id',userId).maybeSingle();
  if(ePerfil) return {fallo:true};
  let clientePerfil=null, clienteVinculado=null;
  if(perfil&&perfil.rol==='cliente'&&perfil.cliente_id!=null){
    const {data,error}=await db.from('clientes').select('id,nombre').eq('id',perfil.cliente_id).maybeSingle();
    if(error) return {fallo:true};
    clientePerfil=data;
  }
  if(!perfil||perfil.rol==='cliente'){
    const {data,error}=await db.from('clientes').select('id,nombre').eq('auth_user_id',userId).maybeSingle();
    if(error) return {fallo:true};
    clienteVinculado=data;
  }
  return {fallo:false, ...decidirRol({perfil,clientePerfil,clienteVinculado})};
}

// supabase-js no trae tiempo de espera: sin esto, una red que no responde deja «Cargando» para siempre.
const ESPERA_MS=8000;
function conEspera(p){
  let t;
  const tope=new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error('tiempo de espera agotado')),ESPERA_MS); });
  return Promise.race([p,tope]).finally(()=>clearTimeout(t));
}

// AUTH — detecta rol
// Mientras se resuelve, la pantalla «Cargando» (HTML inicial) es lo único visible: el login solo aparece si se sabe que no hay sesión.
// Sesión ilegible o sin respuesta en ESPERA_MS = sin sesión (login); si el SIGNED_IN o TOKEN_REFRESHED llega después, entra igual.
// Si ni siquiera cargan los módulos, lo muestra la CSS de index.html tras ~10 s.
export async function checkAuth(){
  const gen=generacion;
  let session=null;
  try{ ({data:{session}}=await conEspera(db.auth.getSession())); }catch{ session=null; }
  // Un SIGNED_OUT (o un login) llegó mientras se leía la sesión: esta respuesta ya no corresponde a la pantalla.
  if(gen!==generacion) return;
  if(!session){ showLogin(); return; }
  await entrar(session.user);
}

// Tras resolver el rol: panel para admin/cliente; «Sin acceso» para el resto (sin cargar vistas ni datos).
// Si la consulta del rol falla o no responde no se sabe qué rol es: nunca se muestra el panel, solo el aviso con salida (recargar).
// Dedupe dentro de la misma generación: login y SIGNED_IN a la vez, o TOKEN_REFRESHED, comparten una sola resolución.
function entrar(user){
  if(entrada&&entrada.gen===generacion&&entrada.userId===user.id) return entrada.promesa;
  // Otro usuario sin SIGNED_OUT: el panel del anterior se suelta y se tapa ya, sin esperar a la resolución del nuevo.
  if(mostrado!==null&&mostrado!==user.id){ soltarEstado(); mostrarCargando(); }
  generacion++;
  const gen=generacion;
  const promesa=resolverEntrada(user,gen);
  entrada={gen,userId:user.id,promesa};
  return promesa;
}

async function resolverEntrada(user,gen){
  let r;
  try{ r=await conEspera(resolverRol(user.id)); }
  catch{ r={fallo:true}; }
  // Cerró sesión (o entró otro usuario) mientras se resolvía: este resultado ya no corresponde a la pantalla.
  if(gen!==generacion) return;
  if(r.fallo){ showFalloCarga(); return; }
  currentRol=r.rol; currentSucursalId=r.sucursalId;
  currentClienteId=r.rol==='cliente'?r.clienteId:null;
  currentClienteNombre=r.rol==='cliente'?r.clienteNombre:'';
  if(!panelHabilitado()){ showSinAcceso(); return; }
  if(mostrado!==user.id){ mostrado=user.id; showApp(user); }
}

function showFalloCarga(){
  const c=document.getElementById('cargando-screen');
  c.classList.remove('hidden'); c.classList.add('falla');
  // «Cargando…» y «No se pudo cargar» no deben verse a la vez: la marca .falla ya muestra el aviso.
  c.querySelector('.login-sub').style.display='none';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.add('hidden');
}

// Pantalla «Cargando» mientras se resuelve otro usuario: tapa el panel anterior.
function mostrarCargando(){
  const c=document.getElementById('cargando-screen');
  c.classList.remove('falla','hidden');
  // La CSS anima «Cargando…» y el aviso a los 10 s con relleno: se anula para que la carga nueva vuelva a mostrar solo «Cargando…».
  const sub=c.querySelector('.login-sub'); sub.style.animation='none'; sub.style.display='';
  document.getElementById('cargando-aviso').style.animation='none';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.add('hidden');
}

function ocultarCargando(){
  const c=document.getElementById('cargando-screen');
  c.classList.remove('falla');
  c.querySelector('.login-sub').style.display='';
  c.classList.add('hidden');
}
function showLogin(){
  ocultarCargando();
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.add('hidden');
}
function showSinAcceso(){
  ocultarCargando();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sin-acceso-screen').classList.remove('hidden');
  document.getElementById('sin-acceso-cerrar').focus();
}
function showApp(user){
  ocultarCargando();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-email').textContent=user.email;
  document.getElementById('user-avatar').textContent=user.email[0].toUpperCase();
  if(isClienteMode()) applyClienteMode();
  else document.getElementById('user-role').textContent=rotuloRol(currentRol);
  loginHooks.forEach(fn=>fn({cliente:isClienteMode(),user}));
}

let oyenteRegistrado=false;
export function initAuth(){
  if(oyenteRegistrado) return;
  oyenteRegistrado=true;
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
  // Único oyente de auth. SIGNED_OUT (botón, otra pestaña o token vencido) cierra la sesión; SIGNED_IN y TOKEN_REFRESHED
  // entran si traen usuario (tras el tope de getSession, o al volver a entrar).
  db.auth.onAuthStateChange((evento,session)=>{
    if(evento==='SIGNED_OUT') limpiarSesion();
    else if((evento==='SIGNED_IN'||evento==='TOKEN_REFRESHED')&&session&&session.user) entrar(session.user);
  });
}

// Idempotente: el botón y el evento SIGNED_OUT convergen aquí. Invalida la resolución en curso (generación nueva).
function limpiarSesion(){
  generacion++;
  entrada=null;
  soltarEstado();
  showLogin();
}

// Quita el estado de la sesión anterior: globals, vistas (hooks de logout) y menús por rol.
function soltarEstado(){
  mostrado=null;
  if(currentRol===null) return;
  currentRol=null; currentClienteId=null; currentClienteNombre=''; currentSucursalId=null;
  logoutHooks.forEach(fn=>fn());
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display=''; });
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display='none'; });
  document.querySelectorAll('[data-empresa-only]').forEach(el=>{ el.style.display='none'; });
  document.getElementById('user-role').textContent='—';
}
