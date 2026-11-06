import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode, currentClienteId, onLogin } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';

let dispositivos=[], dispModalMode='create', dispActiveId=null;

export async function loadDispositivos(){
  setStatus(true,'Cargando...');

  // Cargar dispositivos registrados (+ no registrados solo para admin)
  let dispQuery=db.from('dispositivos')
    .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)')
    .order('created_at',{ascending:false});
  if(isClienteMode()) dispQuery=dispQuery.eq('cliente_id',currentClienteId);

  const promises=[dispQuery];
  if(!isClienteMode()) promises.push(db.rpc('get_unregistered_devices'));
  const [{data:dispData,error:dispErr}, unregResult]=await Promise.all(promises);
  const unregData=unregResult?.data||[];

  if(dispErr){ setStatus(false,'Error de conexión'); showToast(userError(dispErr),true); return; }
  dispositivos=dispData||[];
  setStatus(true,'Conectado');

  // Poblar filtro clientes
  const filterSel=document.getElementById('filter-cliente-disp');
  const cmap=new Map();
  dispositivos.forEach(d=>{ if(d.clientes) cmap.set(d.cliente_id,d.clientes.nombre); });
  setHtml(filterSel, joinHtml([html`<option value="">Todos los clientes</option>`, [...cmap.entries()].map(([id,n])=>html`<option value="${id}">${n}</option>`)]));

  // Enriquecer registrados con última medición
  const macs=dispositivos.map(d=>d.mac_address).filter(Boolean);
  let lastMed={};
  if(macs.length){
    const {data:meds}=await db
      .from('mediciones').select('device_id,created_at')
      .in('device_id',macs).order('created_at',{ascending:false});
    (meds||[]).forEach(m=>{ if(!lastMed[m.device_id]) lastMed[m.device_id]=m.created_at; });
  }
  dispositivos.forEach(d=>{ d._lastMed=lastMed[d.mac_address]||null; });

  renderUnregistered(unregData||[]);
  renderDispositivos();
}

function renderUnregistered(list){
  const section=document.getElementById('unreg-section');
  const tbody=document.getElementById('tbody-unreg');
  const countEl=document.getElementById('unreg-count');
  const badge=document.getElementById('nav-unreg-badge');
  // Actualizar badge del nav
  if(list.length){ badge.textContent=list.length; badge.style.display=''; }
  else { badge.style.display='none'; }
  if(!list.length){ section.style.display='none'; return; }
  section.style.display='block';
  countEl.textContent=list.length;
  setHtml(tbody, joinHtml(list.map(d=>{
    const fecha=d.last_seen
      ?new Date(d.last_seen).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      :'—';
    return html`<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:7px;height:7px;border-radius:50%;background:#ff9500;flex-shrink:0"></div>
          <span class="mono-cell" style="font-size:13px;font-weight:600;color:var(--text-primary)">${d.device_id}</span>
        </div>
      </td>
      <td class="mono-cell" style="font-size:12px">${fecha}</td>
      <td>
        <span class="badge orange">● ${d.total_meds} medición${d.total_meds!=1?'es':''}</span>
      </td>
      <td style="text-align:right">
        <button class="btn primary" style="font-size:12px;padding:5px 10px" data-reg-mac="${d.device_id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><path d="M12 5v14M5 12h14"/></svg>
          Registrar
        </button>
      </td>
    </tr>`;
  })));
}

function renderDispositivos(){
  document.getElementById('filter-cliente-disp').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-dispositivos').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-disp').value;
  const tbody=document.getElementById('tbody-dispositivos');
  const filtered=dispositivos.filter(d=>{
    const matchQ=(d.mac_address||'').toLowerCase().includes(q)||(d.nombre||'').toLowerCase().includes(q);
    const matchC=!cid||String(d.cliente_id)===cid;
    return matchQ&&matchC;
  });
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">No hay dispositivos registrados aún</div></div></td></tr>`);
    return;
  }
  setHtml(tbody, joinHtml(filtered.map(d=>{
    const clientNom=d.clientes?d.clientes.nombre:'—';
    const lastMedStr=d._lastMed
      ?new Date(d._lastMed).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      :html`<span style="color:var(--text-tertiary)">Sin mediciones</span>`;
    const estadoBadge=d.activo
      ?html`<span class="badge green">● Activo</span>`
      :html`<span class="badge" style="background:rgba(0,0,0,0.06);color:var(--text-tertiary)">● Inactivo</span>`;
    return html`<tr>
      <td class="id-cell">#${d.id}</td>
      <td><span class="mono-cell" style="font-size:13px;font-weight:500;color:var(--text-primary)">${d.mac_address}</span></td>
      <td>${d.nombre?d.nombre:html`<span style="color:var(--text-tertiary)">—</span>`}</td>
      <td>${clientNom}</td>
      <td class="mono-cell" style="font-size:12px">${lastMedStr}</td>
      <td>${estadoBadge}</td>
      <td><div class="actions">
        <button class="icon-btn" data-da="edit" data-did="${d.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-da="del" data-did="${d.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  })));
  tbody.querySelectorAll('button[data-da]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.did);
      if(btn.dataset.da==='del') removeDispositivo(id); else ACTIONS.openDispositivoModal('edit',id);
    });
  });
}

ACTIONS.registrarDispositivo=function(mac){
  ACTIONS.openDispositivoModal('create', null, mac);
};

ACTIONS.openDispositivoModal=async function(mode, id, prefillMac=null){
  dispModalMode=mode; dispActiveId=id;
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  setHtml(document.getElementById('df-cliente'), joinHtml((data||[]).map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
  const save=document.getElementById('disp-save');

  if(mode==='create'){
    document.getElementById('disp-modal-title').textContent=
      prefillMac ? 'Registrar dispositivo' : 'Nuevo dispositivo';
    document.getElementById('disp-modal-sub').textContent=
      prefillMac ? `MAC detectada: ${prefillMac}` : 'Registrá el medidor y asignalo a un cliente';
    document.getElementById('df-mac').value=prefillMac||'';
    document.getElementById('df-mac').disabled=!!prefillMac; // si viene de "no registrado", la MAC no se edita
    document.getElementById('df-nombre').value='';
    document.getElementById('df-activo').checked=true;
    save.textContent='Registrar dispositivo';
  } else {
    const d=dispositivos.find(d=>d.id===id);
    document.getElementById('disp-modal-title').textContent='Editar dispositivo';
    document.getElementById('disp-modal-sub').textContent=d.mac_address;
    document.getElementById('df-cliente').value=d.cliente_id;
    document.getElementById('df-mac').value=d.mac_address;
    document.getElementById('df-mac').disabled=true;
    document.getElementById('df-nombre').value=d.nombre||'';
    document.getElementById('df-activo').checked=d.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-dispositivo').classList.add('show');
  setTimeout(()=>{
    const focus = prefillMac ? 'df-nombre' : (mode==='create' ? 'df-mac' : 'df-nombre');
    document.getElementById(focus).focus();
  }, 60);
};
ACTIONS.closeDispositivoModal=()=>document.getElementById('modal-dispositivo').classList.remove('show');

ACTIONS.saveDispositivo=async function(){
  const mac=document.getElementById('df-mac').value.trim().toUpperCase();
  const nombre=document.getElementById('df-nombre').value.trim()||null;
  const cliente_id=parseInt(document.getElementById('df-cliente').value);
  const activo=document.getElementById('df-activo').checked;
  if(!mac||!cliente_id){ showToast('Completá MAC y cliente',true); return; }
  // Validar formato MAC básico
  if(!/^([0-9A-F]{2}[:\-]){5}[0-9A-F]{2}$/.test(mac)){
    showToast('Formato de MAC inválido (Ej: AA:BB:CC:DD:EE:FF)',true); return;
  }
  const btn=document.getElementById('disp-save');
  btn.disabled=true; btn.textContent=dispModalMode==='create'?'Creando...':'Guardando...';
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
      const {data,error}=await db.from('dispositivos')
        .update({nombre,cliente_id,activo})
        .eq('id',dispActiveId)
        .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)').single();
      if(error) throw error;
      const idx=dispositivos.findIndex(d=>d.id===dispActiveId);
      if(idx>=0){ data._lastMed=dispositivos[idx]._lastMed; dispositivos[idx]=data; }
      showToast('Dispositivo actualizado');
    }
    ACTIONS.closeDispositivoModal(); loadDispositivos(); // recarga todo incluyendo no registrados
  } catch(e){ showToast(userError(e),true); }
  finally{ btn.disabled=false; btn.textContent=dispModalMode==='create'?'Registrar dispositivo':'Guardar'; }
};

async function removeDispositivo(id){
  const d=dispositivos.find(d=>d.id===id);
  const ok=await confirmDialog('Eliminar dispositivo',`¿Eliminar el dispositivo ${d.mac_address}?`);
  if(!ok) return;
  const {error}=await db.from('dispositivos').delete().eq('id',id);
  if(error){ showToast(userError(error),true); return; }
  dispositivos=dispositivos.filter(d=>d.id!==id);
  showToast('Dispositivo eliminado');
  renderDispositivos();
}

ACTIONS.loadDispositivos=loadDispositivos;
export const load=loadDispositivos;
registerView('dispositivos','Dispositivos',loadDispositivos);
onLogin(({cliente})=>{
  if(cliente) return;
  db.rpc('get_unregistered_devices').then(({data})=>{
    if(data&&data.length){
      const badge=document.getElementById('nav-unreg-badge');
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
  document.getElementById('search-dispositivos').addEventListener('input',renderDispositivos);
  document.getElementById('filter-cliente-disp').addEventListener('change',renderDispositivos);
}
