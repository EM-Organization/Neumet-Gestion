import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, confirmDialog, avatarFor } from '../core/ui.js';
import { isClienteMode, currentClienteId } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { loadStock } from './stock.js';

let vehiculos=[], vehModalMode='create', vehActiveId=null;

export async function loadVehiculos(){
  setStatus(true,'Cargando...');
  let q=db.from('vehiculos')
    .select('id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,fecha_compra,ultimo_servicio,notas,clientes(nombre)')
    .order('nombre');
  if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
  const {data,error}=await q;
  if(error){ setStatus(false,'Error de conexión'); showToast(userError(error),true); return; }
  vehiculos=data||[];
  setStatus(true,'Conectado');
  // Poblar filtro de clientes
  const filterSel=document.getElementById('filter-cliente-veh');
  const clientSet=new Map();
  vehiculos.forEach(v=>{ if(v.clientes) clientSet.set(v.cliente_id, v.clientes.nombre); });
  setHtml(filterSel, joinHtml([html`<option value="">Todos los clientes</option>`, [...clientSet.entries()].map(([id,n])=>html`<option value="${id}">${n}</option>`)]));
  renderVehiculos();
}

function renderVehiculos(){
  // En modo cliente ocultamos el filtro y columna de cliente
  document.getElementById('filter-cliente-veh').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-vehiculos').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-veh').value;
  const tbody=document.getElementById('tbody-vehiculos');
  let filtered=vehiculos.filter(v=>{
    const matchQ=v.nombre.toLowerCase().includes(q)||(v.patente||'').toLowerCase().includes(q);
    const matchC=!cid||String(v.cliente_id)===cid;
    return matchQ&&matchC;
  });
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">Probá con otro término o filtro</div></div></td></tr>`);
    return;
  }
  setHtml(tbody, joinHtml(filtered.map(v=>{
    const av=avatarFor(v.id);
    const clientNom=v.clientes?v.clientes.nombre:'—';
    const estadoBadge=v.activo
      ?html`<span class="badge green">● Activo</span>`
      :html`<span class="badge" style="background:rgba(0,0,0,0.06);color:var(--text-tertiary)">● Inactivo</span>`;
    return html`<tr>
      <td class="id-cell">#${v.id}</td>
      <td><div class="name-cell"><div class="name-av ${av}">${v.nombre[0].toUpperCase()}</div>${v.nombre}</div></td>
      <td class="mono-cell">${v.patente?v.patente:'—'}</td>
      <td>${clientNom}</td>
      <td><span class="badge blue">${v.tipo_ruedas} WHL</span></td>
      <td>${estadoBadge}</td>
      <td><div class="actions">
        <button class="icon-btn" data-va="neum" data-vid="${v.id}" title="Neumáticos">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
        </button>
        <button class="icon-btn" data-va="edit" data-vid="${v.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-va="del" data-vid="${v.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  })));
  tbody.querySelectorAll('button[data-va]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.vid);
      if(btn.dataset.va==='del') removeVehiculo(id);
      else if(btn.dataset.va==='neum') ACTIONS.openNeumaticosModal(id);
      else ACTIONS.openVehiculoModal('edit',id);
    });
  });
}

ACTIONS.openVehiculoModal=async function(mode,id){
  vehModalMode=mode; vehActiveId=id;
  const save=document.getElementById('veh-save');
  // Poblar select de clientes
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  setHtml(document.getElementById('vf-cliente'), joinHtml((data||[]).map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
  // Ocultar selector de cliente en modo cliente
  document.getElementById('vf-cliente').closest('.field').style.display=isClienteMode()?'none':'';
  if(isClienteMode()) document.getElementById('vf-cliente').value=currentClienteId;

  if(mode==='create'){
    document.getElementById('veh-modal-title').textContent='Nuevo vehículo';
    document.getElementById('veh-modal-sub').textContent='Completá los datos del vehículo';
    document.getElementById('vf-nombre').value='';
    document.getElementById('vf-patente').value='';
    document.getElementById('vf-numero').value='';
    document.getElementById('vf-ruedas').value='10';
    document.getElementById('vf-fecha-compra').value='';
    document.getElementById('vf-ultimo-servicio').value='';
    document.getElementById('vf-notas').value='';
    document.getElementById('vf-activo').checked=true;
    save.textContent='Crear vehículo';
  } else {
    const v=vehiculos.find(v=>v.id===id);
    document.getElementById('veh-modal-title').textContent=`Editar · ${v.nombre}`;
    document.getElementById('veh-modal-sub').textContent='Modificá los datos del vehículo';
    document.getElementById('vf-cliente').value=v.cliente_id;
    document.getElementById('vf-nombre').value=v.nombre;
    document.getElementById('vf-patente').value=v.patente||'';
    document.getElementById('vf-numero').value=v.numero||'';
    document.getElementById('vf-ruedas').value=String(v.tipo_ruedas);
    document.getElementById('vf-fecha-compra').value=v.fecha_compra||'';
    document.getElementById('vf-ultimo-servicio').value=v.ultimo_servicio||'';
    document.getElementById('vf-notas').value=v.notas||'';
    document.getElementById('vf-activo').checked=v.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-vehiculo').classList.add('show');
  setTimeout(()=>document.getElementById('vf-nombre').focus(),60);
};
ACTIONS.closeVehiculoModal=()=>document.getElementById('modal-vehiculo').classList.remove('show');

ACTIONS.saveVehiculo=async function(){
  const nombre=document.getElementById('vf-nombre').value.trim();
  const patente=document.getElementById('vf-patente').value.trim().toUpperCase()||null;
  const numero=document.getElementById('vf-numero').value.trim()||null;
  const cliente_id=parseInt(document.getElementById('vf-cliente').value);
  const tipo_ruedas=parseInt(document.getElementById('vf-ruedas').value);
  const activo=document.getElementById('vf-activo').checked;
  const fecha_compra=document.getElementById('vf-fecha-compra').value||null;
  const ultimo_servicio=document.getElementById('vf-ultimo-servicio').value||null;
  const notas=document.getElementById('vf-notas').value.trim()||null;
  if(!nombre||!cliente_id){ showToast('Completá nombre y cliente',true); return; }
  const btn=document.getElementById('veh-save');
  btn.disabled=true; btn.textContent=vehModalMode==='create'?'Creando...':'Guardando...';
  const fields={nombre,patente,numero,cliente_id,tipo_ruedas,activo,fecha_compra,ultimo_servicio,notas};
  const sel='id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,fecha_compra,ultimo_servicio,notas,clientes(nombre)';
  try{
    if(vehModalMode==='create'){
      const {data,error}=await db.from('vehiculos').insert(fields).select(sel).single();
      if(error) throw error;
      vehiculos.unshift(data);
      showToast(`${nombre} creado`);
    } else {
      const {data,error}=await db.from('vehiculos').update(fields).eq('id',vehActiveId).select(sel).single();
      if(error) throw error;
      const idx=vehiculos.findIndex(v=>v.id===vehActiveId);
      if(idx>=0) vehiculos[idx]=data;
      showToast('Vehículo actualizado');
    }
    ACTIONS.closeVehiculoModal(); renderVehiculos();
  } catch(e){ showToast(userError(e),true); }
  finally{ btn.disabled=false; btn.textContent=vehModalMode==='create'?'Crear vehículo':'Guardar'; }
};

// ── Sub-tabs de Vehículos ──
ACTIONS.switchSubTab=function(tabId){
  const btn=document.querySelector(`.sub-tab[data-subtab="${tabId}"]`);
  document.querySelectorAll('.sub-view').forEach(v=>v.style.display='none');
  document.querySelectorAll('.sub-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(tabId).style.display='';
  if(btn) btn.classList.add('active');
  if(tabId==='sv-stock') loadStock();
};

async function removeVehiculo(id){
  const v=vehiculos.find(v=>v.id===id);
  const ok=await confirmDialog('Eliminar vehículo',`¿Eliminar "${v.nombre}"? Se perderán sus mediciones asociadas.`);
  if(!ok) return;
  const {error}=await db.from('vehiculos').delete().eq('id',id);
  if(error){ showToast(userError(error),true); return; }
  vehiculos=vehiculos.filter(v=>v.id!==id);
  showToast(`${v.nombre} eliminado`);
  renderVehiculos();
}

ACTIONS.loadVehiculos=loadVehiculos;
export const load=loadVehiculos;
registerView('vehiculos','Vehículos',loadVehiculos);

// Lista de vehículos (la usa el modal de neumáticos)
export function getVehiculos(){ return vehiculos; }

export function init(){
  document.getElementById('search-vehiculos').addEventListener('input',renderVehiculos);
  document.getElementById('filter-cliente-veh').addEventListener('change',renderVehiculos);
}
