import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { emailSugeridoApi, validarCuentaApi, mensajeErrorCuentaApi } from '../domain/clientes.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, relDate } from '../core/ui.js';
import { isClienteMode, currentClienteId, onLogin, onLogout } from '../core/auth.js';
import { registerView, switchView, setTitulo } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { CAMPOS_UMBRAL, resumenFlota } from '../domain/umbrales.js';
import { cargarSeccionalesAdmin } from './seccionales-admin.js';
import { contarPorEstado, infoEstado, ESTADOS } from '../domain/salud.js';

// Ficha de cliente: resumen (v_resumen_flota_cliente), salud de sus dispositivos (v_salud_dispositivos) y umbrales
// (columnas de clientes). Los umbrales son de solo lectura: los edita el administrador de la empresa (Empresa > Umbrales, docs/17 PR 9).
const COLS=CAMPOS_UMBRAL.map(c=>c.key).join(',');
const MAX_CUENTAS_API=5;
let activoId=null;


// La ficha se abre desde Clientes (abrirFichaCliente): sin cliente elegido se vuelve a la lista.
export async function loadFicha(){
  if(isClienteMode()) activoId=currentClienteId;
  if(activoId===null){ switchView('clientes'); return; }
  document.getElementById('ficha-volver').style.display=isClienteMode()?'none':'';
  await cargarCliente();
}

async function cargarCliente(){
  if(activoId===null){
    document.getElementById('ficha-nombre').textContent='Sin clientes';
    setHtml(document.getElementById('ficha-kpis'), html`<div class="empty-state"><div class="empty-title">No hay clientes para mostrar</div></div>`);
    cargarSeccionalesAdmin(null);
    return;
  }
  const id=activoId;
  const [res,cli,salud]=await Promise.all([
    db.from('v_resumen_flota_cliente').select('*').eq('cliente_id',id),
    db.from('clientes').select('id,nombre,'+COLS).eq('id',id),
    db.from('v_salud_dispositivos').select('dispositivo_id,cliente_id,estado').eq('cliente_id',id)
  ]);
  if(id!==activoId) return; // el usuario cambió de cliente mientras cargaba
  const e=res.error||cli.error||salud.error;
  if(e){ setStatus(false); showToast(userError(e),true); return; }
  setStatus(true);
  const c=(cli.data||[])[0]||{};
  document.getElementById('ficha-nombre').textContent=c.nombre||'Cliente';
  setTitulo(c.nombre||'Cliente', isClienteMode()?null:'clientes');
  renderResumen((res.data||[])[0]||null);
  renderSalud(salud.data||[]);
  renderUmbrales(c);
  cargarSeccionalesAdmin(id); // sucursales y usuarios en solo lectura (equipo Neumet; no hace nada en modo cliente)
  cargarCuentasApi();
}

const kpi=(cls,n,lbl,sub)=>html`<div class="ficha-kpi ${cls}"><div class="ficha-kpi-n">${n}</div><div class="ficha-kpi-l">${lbl}</div>${sub?html`<div class="ficha-kpi-s">${sub}</div>`:''}</div>`;

function renderResumen(r){
  const el=document.getElementById('ficha-kpis');
  if(!r){ setHtml(el, html`<div class="empty-state"><div class="empty-title">Sin datos de flota</div><div class="empty-sub">Sin vehículos ni mediciones registrados</div></div>`); return; }
  const s=resumenFlota(r);
  setHtml(el, joinHtml([
    kpi('',r.n_vehiculos_activos??0,'Vehículos activos'),
    kpi('',r.n_neumaticos_con_datos??0,'Neumáticos con datos'),
    kpi('green',s.nuevo+s.pocoDesgaste,'En buen estado',s.conDatos?`${s.pctNuevo+s.pctPocoDesgaste}%`:''),
    kpi('orange',s.mayorDesgaste,'Mayor desgaste',s.conDatos?`${s.pctMayorDesgaste}%`:''),
    kpi('red',s.limite,'Desgaste límite',s.conDatos?`${s.pctLimite}%`:''),
    kpi('gray',s.desconocido,'Desconocido'),
    kpi(s.alertas?'red':'',s.alertas,'Alertas activas',`${r.n_alertas_sev3??0} graves · ${r.n_alertas_sev2??0} medias · ${r.n_alertas_sev1??0} leves`),
    kpi('', r.ultima_medicion_at?relDate(r.ultima_medicion_at):'—','Última medición')
  ]));
}

function renderSalud(rows){
  const c=contarPorEstado(rows);
  setHtml(document.getElementById('ficha-salud'), c.total
    ?joinHtml(ESTADOS.map(e=>{ const i=infoEstado(e); return html`<span class="badge ${i.cls}">● ${c[e]} ${i.lbl}</span>`; }))
    :html`<span class="salud-muted">Sin dispositivos registrados</span>`);
}

function renderUmbrales(c){
  setHtml(document.getElementById('ficha-umbrales-campos'), joinHtml(CAMPOS_UMBRAL.map(f=>html`<div class="field">
    <label for="fu-${f.key}">${f.lbl}</label>
    <input type="text" inputmode="decimal" id="fu-${f.key}" data-umbral="${f.key}" value="${c[f.key]??''}" disabled/>
    <div class="ficha-ayuda">${f.ayuda}</div>
  </div>`)));
}

ACTIONS.abrirFichaCliente=id=>{ activoId=id; switchView('ficha'); };
// ── Cuenta de API (solo admin) ──
let credenciales=null;
const apiErr=(msg)=>{ const el=document.getElementById('ficha-api-error'); el.textContent=msg||''; el.classList.toggle('show',!!msg); };

function ocultarCredenciales(){
  credenciales=null;
  document.getElementById('ficha-api-cred').style.display='none';
  document.getElementById('ficha-api-cred-email').textContent='';
  document.getElementById('ficha-api-cred-pass').textContent='';
}

async function cargarCuentasApi(){
  if(isClienteMode()||activoId===null) return;
  const id=activoId, el=document.getElementById('ficha-api-lista');
  ocultarCredenciales(); apiErr('');
  const sesion=await db.auth.getSession();
  const adminEmail=sesion&&sesion.data&&sesion.data.session&&sesion.data.session.user?sesion.data.session.user.email:'';
  const nombre=document.getElementById('ficha-nombre').textContent;
  document.getElementById('ficha-api-email').value=emailSugeridoApi(nombre,adminEmail);
  const {data,error}=await db.rpc('cuentas_api_listar',{p_cliente_id:id});
  if(id!==activoId) return;
  if(error){ setHtml(el, html`<div class="ficha-ayuda">No se pudo cargar la lista de cuentas de API</div>`); return; }
  const rows=data||[];
  setHtml(el, rows.length
    ?joinHtml(rows.map(r=>html`<div class="ficha-ayuda" data-api-cuenta="${r.user_id}">${r.email} · creada ${relDate(r.created_at)}</div>`))
    :html`<div class="ficha-ayuda">Este cliente aún no tiene cuentas de API</div>`);
  document.getElementById('ficha-api-crear').disabled=rows.length>=MAX_CUENTAS_API;
}

ACTIONS.crearCuentaApi=async function(){
  if(isClienteMode()||activoId===null) return;
  const v=validarCuentaApi({email:document.getElementById('ficha-api-email').value});
  if(!v.ok){ apiErr(v.error); return; }
  apiErr(''); ocultarCredenciales();
  const btn=document.getElementById('ficha-api-crear'), id=activoId;
  btn.disabled=true; btn.textContent='Creando…';
  let res=null, out=null;
  try{
    const {data:{session}}=await db.auth.getSession();
    res=await fetch(`${SUPABASE_URL}/functions/v1/crear-cuenta-api`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':SUPABASE_KEY},
      body:JSON.stringify({cliente_id:id,email:v.email})
    });
    out=await res.json();
  }catch(_e){ /* red o respuesta no JSON: se informa abajo */ }
  btn.textContent='Crear cuenta de API';
  if(!res||!out||!out.ok){ btn.disabled=false; apiErr(mensajeErrorCuentaApi(res&&res.status,out&&out.error)); return; }
  // Las credenciales viven solo en memoria y en el DOM hasta que se cambie de cliente/vista.
  credenciales={email:out.cuenta.email,password:out.password||''};
  document.getElementById('ficha-api-cred-email').textContent=credenciales.email;
  document.getElementById('ficha-api-cred-pass').textContent=credenciales.password||'(la que indicaste)';
  document.getElementById('ficha-api-cred').style.display='';
  showToast('Cuenta de API creada. Copiar las credenciales: no se vuelven a mostrar');
  const {data}=await db.rpc('cuentas_api_listar',{p_cliente_id:id});
  if(id===activoId&&Array.isArray(data)){
    setHtml(document.getElementById('ficha-api-lista'), joinHtml(data.map(r=>html`<div class="ficha-ayuda" data-api-cuenta="${r.user_id}">${r.email} · creada ${relDate(r.created_at)}</div>`)));
    btn.disabled=data.length>=MAX_CUENTAS_API;
  } else btn.disabled=false;
};

ACTIONS.copiarCredencialesApi=async function(){
  if(!credenciales) return;
  try{
    await navigator.clipboard.writeText(`Email: ${credenciales.email}\nContraseña: ${credenciales.password}`);
    showToast('Credenciales copiadas');
  }catch(_e){ showToast('No se pudo copiar. Seleccionar y copiar el texto a mano',true); }
};

ACTIONS.loadFicha=loadFicha;
export const load=loadFicha;
registerView('ficha','Ficha de cliente',loadFicha,{menu:'clientes',soloAdmin:true});
ACTIONS.volverAClientes=()=>switchView('clientes');
onLogin(()=>{ if(isClienteMode()) activoId=currentClienteId; });
onLogout(()=>{ activoId=null; credenciales=null; });

export function init(){}
