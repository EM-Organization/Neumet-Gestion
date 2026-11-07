import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, confirmDialog } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado } from '../core/componentes.js';
import { fmtNum, fmtFechaHora } from '../domain/formato.js';
import { isClienteMode, currentClienteId, currentClienteNombre, onLogin, onLogout } from '../core/auth.js';
import { contextoListo, hayFiltroSeccional, filtrarConsulta } from '../core/seccional.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { ESTADOS, infoEstado, filtrarSalud, contarPorEstado, textoDias } from '../domain/salud.js';

// Dispositivos: una sola vista con el estado de cada medidor (activo / sin actividad / caído / nunca midió), su última
// actividad y filtros. Lee v_salud_dispositivos (la BD calcula estado y días). El rol cliente la ve en SOLO LECTURA:
// sin alta, edición ni baja (la RLS ya lo impide; aquí además se oculta la UI y se protegen las acciones).
let filas=[], clientes=new Map(), fEstado='', fCliente='', dispModalMode='create', dispActiveId=null;
const SIMBOLO={activo:'✓',sin_actividad:'▲',caido:'✕',nunca:'–'};
const $=id=>document.getElementById(id);

export async function loadDispositivos(){
  await contextoListo();
  setHtml($('tbody-dispositivos'), filaEstado(8, estadoCarga('Cargando…')));

  const cliente=isClienteMode();
  const [{data,error},cl,unreg]=await Promise.all([
    db.from('v_salud_dispositivos')
      .select('dispositivo_id,cliente_id,mac_address,nombre,activo,ultima_actividad_at,total_mediciones,dias_sin_actividad,estado')
      .order('dias_sin_actividad',{ascending:false,nullsFirst:false}),
    cliente?Promise.resolve({data:[{id:currentClienteId,nombre:currentClienteNombre}]})
      :db.from('clientes').select('id,nombre').is('deleted_at',null).order('nombre'),
    cliente?Promise.resolve({data:[]}):db.rpc('get_unregistered_devices')
  ]);
  if(error){ setStatus(false); showToast(userError(error),true); setHtml($('tbody-dispositivos'), filaEstado(8, estadoError('', 'loadDispositivos'))); return; }
  filas=data||[];
  if(hayFiltroSeccional()){ // la vista no trae la seccional: se cruza con los dispositivos de la seccional elegida
    const {data:ds,error:e2}=await filtrarConsulta(db.from('dispositivos').select('id').eq('cliente_id',currentClienteId));
    if(e2){ setStatus(false); showToast(userError(e2),true); setHtml($('tbody-dispositivos'), filaEstado(8, estadoError('', 'loadDispositivos'))); return; }
    const ok=new Set((ds||[]).map(d=>String(d.id)));
    filas=filas.filter(f=>ok.has(String(f.dispositivo_id)));
  }
  setStatus(true);
  clientes=new Map((cl.data||[]).map(c=>[String(c.id),c.nombre]));
  renderFiltros();
  renderUnregistered(unreg.data||[]);
  renderDispositivos();
}

function renderFiltros(){
  const sel=$('filter-cliente-disp');
  const ids=[...new Set(filas.map(f=>String(f.cliente_id)))];
  setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`, ids.map(id=>html`<option value="${id}">${clientes.get(id)||('Cliente #'+id)}</option>`)]));
  if(fCliente&&!ids.includes(fCliente)) fCliente='';
  sel.value=fCliente;
  $('disp-estado').value=fEstado;
  sel.style.display=isClienteMode()?'none':'';
}

function renderResumen(){
  const c=contarPorEstado(filas,fCliente);
  setHtml($('disp-chips'), joinHtml([
    html`<button type="button" class="salud-chip ${fEstado===''?'active':''}" data-action="dispFiltrarEstado" data-args='[""]'><span class="salud-chip-n">${c.total}</span> Todos</button>`,
    ESTADOS.map(e=>{
      const i=infoEstado(e);
      return html`<button type="button" class="salud-chip ${i.cls} ${fEstado===e?'active':''}" data-action="dispFiltrarEstado" data-args='["${e}"]'><span class="salud-chip-n">${c[e]}</span> ${i.lbl}</button>`;
    })
  ]));
}

// MAC que enviaron mediciones pero no tienen cliente: solo administración.
function renderUnregistered(list){
  const section=$('unreg-section');
  const badge=$('nav-unreg-badge');
  if(isClienteMode()||!list.length){ badge.style.display='none'; section.style.display='none'; return; }
  badge.textContent=list.length; badge.style.display='';
  section.style.display='block';
  $('unreg-count').textContent=list.length;
  setHtml($('tbody-unreg'), joinHtml(list.map(d=>{
    const fecha=d.last_seen?fmtFechaHora(d.last_seen):'—';
    return html`<tr>
      <td><span class="mono-cell salud-mac">${d.device_id}</span></td>
      <td class="mono-cell salud-fecha">${fecha}</td>
      <td><span class="badge orange">● ${d.total_meds} medición${d.total_meds!=1?'es':''}</span></td>
      <td style="text-align:right">
        <button type="button" class="btn primary" data-reg-mac="${d.device_id}">Registrar</button>
      </td>
    </tr>`;
  })));
}

function renderDispositivos(){
  renderResumen();
  const cliente=isClienteMode();
  const lista=filtrarSalud(filas,{estado:fEstado,clienteId:fCliente,query:$('search-dispositivos').value});
  const tbody=$('tbody-dispositivos');
  $('disp-count').textContent=filas.length?`${lista.length} de ${filas.length}`:'';
  if(!lista.length){
    setHtml(tbody, filaEstado(8, filas.length
      ? estadoVacio('Ningún dispositivo coincide', 'Cambiar el filtro.')
      : (cliente
        ? estadoVacio('Sin dispositivos registrados')
        : estadoVacio('Sin dispositivos registrados', '', { label: 'Nuevo dispositivo', action: 'openDispositivoModal', args: ['create'], primaria: true }))));
    return;
  }
  setHtml(tbody, joinHtml(lista.map(r=>{
    const i=infoEstado(r.estado);
    return html`<tr data-estado="${r.estado}">
      <td>${chip(i.cls, i.lbl, SIMBOLO[r.estado]||'●')}</td>
      <td><span class="mono-cell salud-mac">${r.mac_address}</span></td>
      <td>${r.nombre?r.nombre:html`<span class="salud-muted">—</span>`}</td>
      ${cliente?'':html`<td>${clientes.get(String(r.cliente_id))||('#'+r.cliente_id)}</td>`}
      <td class="mono-cell salud-fecha">${r.ultima_actividad_at?fmtFechaHora(r.ultima_actividad_at):'Sin mediciones'}</td>
      <td class="salud-num">${textoDias(r)}</td>
      <td class="salud-num">${fmtNum(r.total_mediciones||0)}${r.activo===false?html` <span class="badge gray">Desactivado</span>`:''}</td>
      ${cliente?'':html`<td><div class="actions">
        <button type="button" class="icon-btn" data-action="editarDispositivo" data-args="${JSON.stringify([r.dispositivo_id])}" title="Editar" aria-label="Editar dispositivo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="icon-btn danger" data-action="eliminarDispositivo" data-args="${JSON.stringify([r.dispositivo_id])}" title="Eliminar" aria-label="Eliminar dispositivo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>`}
    </tr>`;
  })));
}

ACTIONS.dispFiltrarEstado=e=>{ fEstado=e||''; $('disp-estado').value=fEstado; renderDispositivos(); };
ACTIONS.dispEstadoChange=v=>{ fEstado=v||''; renderDispositivos(); };
ACTIONS.dispClienteChange=v=>{ fCliente=v||''; renderDispositivos(); };
ACTIONS.editarDispositivo=id=>ACTIONS.openDispositivoModal('edit',id);
ACTIONS.eliminarDispositivo=id=>removeDispositivo(id);

ACTIONS.registrarDispositivo=function(mac){
  ACTIONS.openDispositivoModal('create', null, mac);
};

// Alta/edición/baja: solo administración (la RLS también lo impide al rol cliente).
ACTIONS.openDispositivoModal=async function(mode, id, prefillMac=null){
  if(isClienteMode()) return;
  dispModalMode=mode; dispActiveId=id;
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  setHtml($('df-cliente'), joinHtml((data||[]).map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
  const save=$('disp-save');

  if(mode==='create'){
    $('disp-modal-title').textContent=prefillMac ? 'Registrar dispositivo' : 'Nuevo dispositivo';
    $('disp-modal-sub').textContent=prefillMac ? prefillMac : '';
    $('df-mac').value=prefillMac||'';
    $('df-mac').disabled=!!prefillMac; // si viene de "no registrado", la MAC no se edita
    $('df-nombre').value='';
    $('df-activo').checked=true;
    save.textContent='Registrar dispositivo';
  } else {
    const d=filas.find(f=>f.dispositivo_id===id);
    if(!d) return;
    $('disp-modal-title').textContent='Editar dispositivo';
    $('disp-modal-sub').textContent=d.mac_address;
    $('df-cliente').value=d.cliente_id;
    $('df-mac').value=d.mac_address;
    $('df-mac').disabled=true;
    $('df-nombre').value=d.nombre||'';
    $('df-activo').checked=d.activo;
    save.textContent='Guardar';
  }
  $('modal-dispositivo').classList.add('show');
  setTimeout(()=>{
    const focus = prefillMac ? 'df-nombre' : (mode==='create' ? 'df-mac' : 'df-nombre');
    $(focus).focus();
  }, 60);
};
ACTIONS.closeDispositivoModal=()=>$('modal-dispositivo').classList.remove('show');

ACTIONS.saveDispositivo=async function(){
  if(isClienteMode()) return;
  const mac=$('df-mac').value.trim().toUpperCase();
  const nombre=$('df-nombre').value.trim()||null;
  const cliente_id=parseInt($('df-cliente').value);
  const activo=$('df-activo').checked;
  if(!mac||!cliente_id){ showToast('Falta la MAC o el cliente',true); return; }
  // Validar formato MAC básico
  if(!/^([0-9A-F]{2}[:\-]){5}[0-9A-F]{2}$/.test(mac)){
    showToast('Formato de MAC inválido (AA:BB:CC:DD:EE:FF)',true); return;
  }
  const btn=$('disp-save');
  btn.disabled=true; btn.textContent=dispModalMode==='create'?'Creando…':'Guardando…';
  try{
    if(dispModalMode==='create'){
      // Llama al RPC que: registra el dispositivo, re-vincula mediciones existentes
      // al cliente asignado y crea vehículos nuevos si la patente no existe bajo ese cliente.
      const {data:res,error}=await db.rpc('asignar_dispositivo_a_cliente',{
        p_mac: mac,
        p_cliente_id: cliente_id,
        p_nombre: nombre
      });
      if(error) throw error;
      let msg=`Dispositivo ${mac} registrado`;
      if(res.vehiculos_creados>0) msg+=` · ${res.vehiculos_creados} vehículo${res.vehiculos_creados>1?'s':''} creado${res.vehiculos_creados>1?'s':''}`;
      if(res.mediciones_vinculadas>0) msg+=` · ${res.mediciones_vinculadas} medición${res.mediciones_vinculadas>1?'es':''} vinculadas`;
      showToast(msg);
    } else {
      const {error}=await db.from('dispositivos')
        .update({nombre,cliente_id,activo})
        .eq('id',dispActiveId)
        .select('id').single();
      if(error) throw error;
      showToast('Dispositivo actualizado');
    }
    ACTIONS.closeDispositivoModal(); loadDispositivos(); // recarga todo incluyendo no registrados
  } catch(e){ showToast(userError(e),true); }
  finally{ btn.disabled=false; btn.textContent=dispModalMode==='create'?'Registrar dispositivo':'Guardar'; }
};

async function removeDispositivo(id){
  if(isClienteMode()) return;
  const d=filas.find(f=>f.dispositivo_id===id);
  if(!d) return;
  const ok=await confirmDialog('Eliminar dispositivo',`¿Eliminar el dispositivo ${d.mac_address}?`);
  if(!ok) return;
  const {error}=await db.from('dispositivos').delete().eq('id',id);
  if(error){ showToast(userError(error),true); return; }
  filas=filas.filter(f=>f.dispositivo_id!==id);
  showToast('Dispositivo eliminado');
  renderFiltros();
  renderDispositivos();
}

ACTIONS.loadDispositivos=loadDispositivos;
export const load=loadDispositivos;
registerView('dispositivos','Dispositivos',loadDispositivos);
onLogout(()=>{ filas=[]; clientes=new Map(); fEstado=''; fCliente=''; });
onLogin(({cliente})=>{
  if(cliente) return;
  db.rpc('get_unregistered_devices').then(({data})=>{
    if(data&&data.length){
      const badge=$('nav-unreg-badge');
      badge.textContent=data.length; badge.style.display='';
    }
  });
});

export function init(){
  // Abre el modal desde un dispositivo no registrado (MAC ya conocida)
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-reg-mac]');
    if(b) ACTIONS.registrarDispositivo(b.dataset.regMac);
  });
  $('search-dispositivos').addEventListener('input',renderDispositivos);
}
