// Mediciones: modo "dispositivo" (elegir un medidor y una sesión de medición) y cambio de modo de la vista.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode, currentClienteId } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { med } from './mediciones-state.js';
import { medDrawTruck, medUpdateCounters } from './mediciones-camion.js';

// ── MEDICIONES TABS ──
export function medSwitchMode(mode){
  med.mode=mode;
  document.querySelectorAll('.med-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));

  const isVeh=mode==='vehiculo';
  document.getElementById('med-panel-vehiculo').style.display   = isVeh?'block':'none';
  document.getElementById('med-panel-dispositivo').style.display= isVeh?'none':'block';
  document.getElementById('med-counters-card').style.display    = 'none';
  document.getElementById('med-sessions-card').style.display    = isVeh?'none':'flex';
  document.getElementById('med-truck-card').style.display       = 'none';
  document.getElementById('med-empty').style.display            = 'flex';
  document.getElementById('med-tire-detail').style.display      = 'none';
  document.getElementById('med-loading').style.display          = 'none';
  document.getElementById('med-empty-title').textContent        = isVeh?'Elegir un vehículo':'Elegir una sesión';
  document.getElementById('med-empty-sub').textContent          = isVeh?'Después, elegir un neumático para ver sus mediciones':'Elegir un dispositivo y una sesión para ver el estado del camión';
  med.tireData={}; med.selPos=null;
  if(!isVeh) medDeviceLoadDevices();
}

async function medDeviceLoadDevices(){
  setHtml(document.getElementById('med-device-list'), html`<div class="loading-state"><div class="spinner"></div></div>`);

  // MACs con mediciones (filtrar por cliente si aplica)
  let macQuery=db.from('mediciones').select('device_id').not('device_id','is',null);
  if(isClienteMode()) macQuery=macQuery.eq('cliente_id',currentClienteId);
  const {data:macRows}=await macQuery;
  const allMacs=[...new Set((macRows||[]).map(m=>m.device_id))].sort();

  // Dispositivos registrados (filtrar por cliente si aplica)
  let regQuery=db.from('dispositivos').select('mac_address,nombre,clientes(nombre)');
  if(isClienteMode()) regQuery=regQuery.eq('cliente_id',currentClienteId);
  const {data:regDevs}=await regQuery;
  const regMap={};
  (regDevs||[]).forEach(d=>{ regMap[d.mac_address]=d; });

  med.allDevices=allMacs.map(mac=>({
    mac,
    nombre: regMap[mac]?.nombre||null,
    cliente: regMap[mac]?.clientes?.nombre||null,
    registered: !!regMap[mac]
  }));

  medDeviceRenderList();
}

function medDeviceRenderList(){
  const q=(document.getElementById('med-device-search').value||'').toLowerCase();
  const container=document.getElementById('med-device-list');
  const filtered=med.allDevices.filter(d=>
    d.mac.toLowerCase().includes(q)||
    (d.nombre||'').toLowerCase().includes(q)||
    (d.cliente||'').toLowerCase().includes(q)
  );
  if(!filtered.length){
    setHtml(container, html`<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-tertiary)">Sin dispositivos</div>`);
    return;
  }
  setHtml(container, joinHtml(filtered.map(d=>html`
    <div class="device-item ${med.selDevice===d.mac?'active':''}" data-mac="${d.mac}">
      <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-primary)">${d.mac}</div>
      ${d.nombre?html`<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">${d.nombre}${d.cliente?' · '+d.cliente:''}</div>`:''}
      ${!d.registered?html`<div style="font-size:10px;color:var(--warning);margin-top:1px">● No registrado</div>`:''}
    </div>`)));
}

export function initDispositivoMode(){
  document.querySelectorAll('.med-tab').forEach(tab=>{
    tab.addEventListener('click',()=>medSwitchMode(tab.dataset.mode));
  });
  document.getElementById('med-device-search').addEventListener('input',medDeviceRenderList);
  document.getElementById('med-device-list')?.addEventListener('click',e=>{
    const it=e.target.closest('[data-mac]');
    if(it) ACTIONS.medDeviceSelect(it.dataset.mac);
  });
}

ACTIONS.medDeviceSelect=async function(mac){
  med.selDevice=mac; medDeviceRenderList();
  document.getElementById('med-sessions-sub').textContent=mac;
  setHtml(document.getElementById('med-sessions-list'), html`<div class="loading-state"><div class="spinner"></div>Cargando sesiones…</div>`);
  document.getElementById('med-sessions-card').style.display='flex';

  const {data,error}=await db
    .from('mediciones')
    .select('posicion,mm1,mm2,mm3,promedio,created_at,vehiculo_id,patente_raw,numero_raw,vehiculos(nombre,patente,tipo_ruedas)')
    .eq('device_id',mac)
    .order('created_at',{ascending:false})
    .limit(2000);

  if(error){ showToast(userError(error),true); return; }

  // Agrupar por (vehiculo_id + segundo) — todos los inserts de un POST tienen el mismo timestamp
  const map={};
  (data||[]).forEach(m=>{
    const sec=new Date(m.created_at).toISOString().slice(0,19);
    const patchKey=m.vehiculo_id??m.patente_raw??m.numero_raw??'sin-veh';
    const key=`${patchKey}-${sec}`;
    if(!map[key]) map[key]={key,firstDate:m.created_at,sec,vehiculo_id:m.vehiculo_id,vehiculo:m.vehiculos,patente_raw:m.patente_raw,numero_raw:m.numero_raw,meds:[]};
    map[key].meds.push(m);
  });
  // Solo mostrar sesiones con todas las ruedas del vehículo
  med.deviceSessions=Object.values(map)
    .filter(s=>{
      const expected=s.vehiculo?.tipo_ruedas;
      if(!expected) return true;
      const positions=new Set(s.meds.map(m=>m.posicion)).size;
      return positions>=expected;
    })
    .sort((a,b)=>new Date(b.firstDate)-new Date(a.firstDate));
  med.selSession=null;
  medDeviceRenderSessions();
};

function medDeviceRenderSessions(){
  const container=document.getElementById('med-sessions-list');
  if(!med.deviceSessions.length){
    setHtml(container, html`<div style="padding:32px;text-align:center;font-size:13px;color:var(--text-tertiary)">Sin sesiones registradas</div>`);
    return;
  }
  setHtml(container, joinHtml(med.deviceSessions.map((s,i)=>{
    const isActive=med.selSession===i;
    const fecha=new Date(s.firstDate).toLocaleString('es-AR',{
      day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'
    });
    const posiciones=new Set(s.meds.map(m=>m.posicion)).size;
    const avgs=s.meds.map(m=>m.promedio!=null?parseFloat(m.promedio):null).filter(v=>v!=null);
    const prom=avgs.length?(avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(1):null;
    const veh=s.vehiculo;
    const rawLabel=s.patente_raw||s.numero_raw||null;
    const vehNom=veh
      ?`${veh.nombre}${veh.patente?' · '+veh.patente:''}`
      :rawLabel?html`<span style="color:var(--warning)">Sin asignar · ${rawLabel}</span>`:'Sin matrícula';
    const dotColor=isActive?'var(--accent-dark)':'var(--text-tertiary)';
    return html`<div class="session-item ${isActive?'active':''}" data-action="medDeviceSessionSelect" data-args="[${i}]">
      <div class="session-dot" style="background:${dotColor}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:${isActive?'600':'500'};color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vehNom}</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">
          ${fecha} &nbsp;·&nbsp; ${posiciones} rueda${posiciones!==1?'s':''}${prom?html` &nbsp;·&nbsp; prom. <b>${prom}mm</b>`:''}
        </div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;color:var(--text-tertiary);flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
  })));
}

ACTIONS.medDeviceSessionSelect=function(i){
  med.selSession=i;
  medDeviceRenderSessions();
  const session=med.deviceSessions[i];
  if(!session) return;

  // Tomar el tipo_ruedas del vehículo (o inferirlo de las posiciones)
  const tipoRuedas=session.vehiculo?.tipo_ruedas;
  const maxPos=Math.max(...session.meds.map(m=>parseInt(m.posicion)));
  med.tipoRuedas=String(tipoRuedas||(maxPos>10?16:10));

  // Construir med.tireData con la medición MÁS RECIENTE por posición de esta sesión
  med.tireData={}; med.selPos=null;
  session.meds.forEach(m=>{
    const p=parseInt(m.posicion);
    if(!med.tireData[p]) med.tireData[p]=[];
    med.tireData[p].push(m);
  });

  document.getElementById('med-truck-card').style.display='block';
  document.getElementById('med-counters-card').style.display='block';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  medDrawTruck();
  medUpdateCounters();
};
