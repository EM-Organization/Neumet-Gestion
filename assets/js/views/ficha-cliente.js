import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { emailSugeridoApi, validarCuentaApi, mensajeErrorCuentaApi } from '../domain/clientes.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, relDate } from '../core/ui.js';
import { isClienteMode, currentClienteId, onLogin, onLogout } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { CAMPOS_UMBRAL, validarUmbrales, mensajeErrorUmbrales, resumenFlota } from '../domain/umbrales.js';
import { cargarSeccionalesAdmin } from './seccionales-admin.js';
import { contarPorEstado, infoEstado, ESTADOS } from '../domain/salud.js';

// Ficha de cliente: resumen (v_resumen_flota_cliente), salud de sus dispositivos (v_salud_dispositivos) y umbrales
// (columnas de clientes; edición solo admin, el cliente los ve de solo lectura).
const COLS=CAMPOS_UMBRAL.map(c=>c.key).join(',');
const MAX_CUENTAS_API=5;
let activoId=null, lista=[];

const err=(msg)=>{ const el=document.getElementById('ficha-umbral-error'); el.textContent=msg||''; el.classList.toggle('show',!!msg); };

export async function loadFicha(){
  const sel=document.getElementById('ficha-cliente');
  if(isClienteMode()){ activoId=currentClienteId; }
  else {
    
    const {data,error}=await db.from('clientes').select('id,nombre').is('deleted_at',null).order('nombre');
    if(error){ setStatus(false); showToast(userError(error),true); return; }
    lista=data||[];
    setHtml(sel, joinHtml(lista.map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
    if(!lista.some(c=>c.id===activoId)) activoId=lista.length?lista[0].id:null;
    sel.value=activoId===null?'':String(activoId);
  }
  document.getElementById('ficha-selector').style.display=isClienteMode()?'none':'';
  await cargarCliente();
}

async function cargarCliente(){
  err('');
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
  renderResumen((res.data||[])[0]||null);
  renderSalud(salud.data||[]);
  renderUmbrales(c);
  cargarSeccionalesAdmin(id); // ABM de seccionales (solo admin; no hace nada en modo cliente)
  cargarCuentasApi();
}

const kpi=(cls,n,lbl,sub)=>html`<div class="ficha-kpi ${cls}"><div class="ficha-kpi-n">${n}</div><div class="ficha-kpi-l">${lbl}</div>${sub?html`<div class="ficha-kpi-s">${sub}</div>`:''}</div>`;

function renderResumen(r){
  const el=document.getElementById('ficha-kpis');
  if(!r){ setHtml(el, html`<div class="empty-state"><div class="empty-title">Sin datos de flota</div><div class="empty-sub">Todavía no hay vehículos ni mediciones para este cliente</div></div>`); return; }
  const s=resumenFlota(r);
  setHtml(el, joinHtml([
    kpi('',r.n_vehiculos_activos??0,'Vehículos activos'),
    kpi('',r.n_neumaticos_con_datos??0,'Neumáticos con datos'),
    kpi('green',s.ok,'En buen estado',s.conDatos?`${s.pctOk}%`:''),
    kpi('orange',s.bajo,'Desgaste bajo',s.conDatos?`${s.pctBajo}%`:''),
    kpi('red',s.critico,'Críticos',s.conDatos?`${s.pctCritico}%`:''),
    kpi('gray',s.sinDatos,'Sin datos'),
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
  const ro=isClienteMode();
  setHtml(document.getElementById('ficha-umbrales-campos'), joinHtml(CAMPOS_UMBRAL.map(f=>html`<div class="field">
    <label for="fu-${f.key}">${f.lbl}</label>
    <input type="text" inputmode="decimal" id="fu-${f.key}" data-umbral="${f.key}" value="${c[f.key]??''}" ${ro?'disabled':''}/>
    <div class="ficha-ayuda">${f.ayuda}</div>
  </div>`)));
  document.getElementById('ficha-guardar').style.display=ro?'none':'';
}

ACTIONS.fichaClienteChange=v=>{ activoId=v?parseInt(v):null; cargarCliente(); };
ACTIONS.abrirFichaCliente=id=>{ activoId=id; switchView('ficha'); };
ACTIONS.guardarUmbrales=async function(){
  if(isClienteMode()||activoId===null) return;
  const raw={};
  document.querySelectorAll('#ficha-umbrales-campos [data-umbral]').forEach(i=>{ raw[i.dataset.umbral]=i.value; });
  const v=validarUmbrales(raw);
  if(!v.ok){ err(v.error); return; }
  err('');
  const btn=document.getElementById('ficha-guardar');
  btn.disabled=true; btn.textContent='Guardando...';
  try{
    const {data,error}=await db.from('clientes').update(v.valores).eq('id',activoId).select('id,nombre,'+COLS);
    if(error){ err(mensajeErrorUmbrales(error)); return; } // se muestra el error de la BD (p. ej. check retiro < crítico < bajo)
    if(!data||!data.length){ err('No se guardó ningún cambio: no tienes permiso para editar este cliente o ya no existe'); return; }
    renderUmbrales(data[0]);
    showToast('Umbrales actualizados');
    cargarCliente(); // las vistas SQL recalculan estados con los nuevos umbrales
  } finally { btn.disabled=false; btn.textContent='Guardar umbrales'; }
};

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
  const nombre=(lista.find(c=>c.id===id)||{}).nombre||document.getElementById('ficha-nombre').textContent;
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
  btn.disabled=true; btn.textContent='Creando...';
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
  showToast('Cuenta de API creada. Copiá las credenciales: no se volverán a mostrar');
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
  }catch(_e){ showToast('No se pudo copiar: seleccioná y copiá el texto manualmente',true); }
};

ACTIONS.loadFicha=loadFicha;
export const load=loadFicha;
registerView('ficha','Ficha de cliente',loadFicha);
onLogin(()=>{ if(isClienteMode()) activoId=currentClienteId; });
onLogout(()=>{ activoId=null; lista=[]; credenciales=null; });

export function init(){}
