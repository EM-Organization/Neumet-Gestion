import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode, currentClienteId, currentClienteNombre } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';

let stockItems=[], stockModalMode='create', stockActiveId=null;
let stockAssignMap={}; // stock_id → [{vehiculo_nombre, count}]

export async function loadStockAssignments(){
  // Carga asignaciones de neumaticos con stock_id para el cliente actual
  let q=db.from('neumaticos').select('stock_id,vehiculos(nombre)').not('stock_id','is',null);
  if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
  const {data}=await q;
  stockAssignMap={};
  (data||[]).forEach(n=>{
    if(!n.stock_id) return;
    const vnom=n.vehiculos?.nombre||'Vehículo desconocido';
    if(!stockAssignMap[n.stock_id]) stockAssignMap[n.stock_id]={};
    stockAssignMap[n.stock_id][vnom]=(stockAssignMap[n.stock_id][vnom]||0)+1;
  });
}

export async function loadStock(){
  const tbody=document.getElementById('tbody-stock');
  setHtml(tbody, html`<tr><td colspan="9"><div class="loading-state"><div class="spinner"></div></div></td></tr>`);
  let sq=db.from('stock_neumaticos')
    .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas,clientes(nombre)')
    .order('created_at',{ascending:false});
  if(isClienteMode()) sq=sq.eq('cliente_id',currentClienteId);
  const {data,error}=await sq;
  if(error){ showToast(userError(error),true); return; }
  stockItems=data||[];
  // Poblar filtro clientes
  const sel=document.getElementById('filter-cliente-stock');
  const cmap=new Map();
  stockItems.forEach(s=>{ if(s.clientes) cmap.set(s.cliente_id,s.clientes.nombre); });
  setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`, [...cmap.entries()].map(([id,n])=>html`<option value="${id}">${n}</option>`)]));
  await loadStockAssignments();
  renderStock();
}

function renderStock(){
  document.getElementById('filter-cliente-stock').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-stock').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-stock').value;
  const tbody=document.getElementById('tbody-stock');
  const filtered=stockItems.filter(s=>{
    const mq=(s.marca||'').toLowerCase().includes(q)||(s.modelo||'').toLowerCase().includes(q);
    const mc=!cid||String(s.cliente_id)===cid;
    return mq&&mc;
  });
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="9"><div class="empty-state"><div class="empty-title">Sin neumáticos en stock</div></div></td></tr>`);
    return;
  }
  setHtml(tbody, joinHtml(filtered.map(s=>{
    const assigns=stockAssignMap[s.id]||{};
    const totalAsig=Object.values(assigns).reduce((a,b)=>a+b,0);
    const libre=(s.cantidad||0)-totalAsig;
    const hasAsig=totalAsig>0;
    const asigBadge=hasAsig
      ? html`<button class="stock-asig-btn" data-sid="${s.id}" title="Ver detalle de asignación">
           <span class="badge green">${totalAsig} asig.</span>
           <span style="color:var(--text-secondary);font-size:11px">/ ${s.cantidad} ud.</span>
         </button>`
      : html`<span class="badge" style="background:var(--surface-secondary);color:var(--text-tertiary);border:1px solid var(--border)">0 / ${s.cantidad} ud.</span>`;
    return html`<tr data-srow="${s.id}">
      <td><strong>${s.marca}</strong></td>
      <td>${s.modelo?s.modelo:html`<span style="color:var(--text-tertiary)">—</span>`}</td>
      <td>${s.clientes?s.clientes.nombre:'—'}</td>
      <td>${s.precio_unidad!=null?'$'+parseFloat(s.precio_unidad).toLocaleString('es-AR',{minimumFractionDigits:2}):'—'}</td>
      <td>${s.fecha_compra?new Date(s.fecha_compra+'T00:00:00').toLocaleDateString('es-AR'):'—'}</td>
      <td>${asigBadge}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-size:12px">${s.notas?s.notas:'—'}</td>
      ${isClienteMode()?'':html`<td><div class="actions">
        <button class="icon-btn" data-sa="edit" data-sid="${s.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-sa="del" data-sid="${s.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>`}
    </tr>
    <tr class="stock-asig-detail" data-detail="${s.id}" style="display:none">
      <td colspan="8" style="padding:0">
        <div class="stock-asig-expand">
          <div class="stock-asig-expand-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Asignado a:
          </div>
          ${Object.entries(assigns).map(([vnom,cnt])=>html`
            <div class="stock-asig-row">
              <span class="stock-asig-veh">${vnom}</span>
              <span class="badge blue">${cnt} ud.</span>
            </div>`)}
          ${libre>0?html`<div class="stock-asig-row" style="opacity:.6">
            <span style="color:var(--text-tertiary)">Sin asignar</span>
            <span class="badge" style="background:var(--surface-secondary);color:var(--text-tertiary);border:1px solid var(--border)">${libre} ud.</span>
          </div>`:''}
        </div>
      </td>
    </tr>`;
  })));

  // Botón asignados: toggle detalle
  tbody.querySelectorAll('.stock-asig-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const sid=btn.dataset.sid;
      const detail=tbody.querySelector(`tr[data-detail="${sid}"]`);
      const isOpen=detail.style.display!=='none';
      // Cerrar todos
      tbody.querySelectorAll('.stock-asig-detail').forEach(r=>r.style.display='none');
      tbody.querySelectorAll('.stock-asig-btn').forEach(b=>b.classList.remove('active'));
      if(!isOpen){ detail.style.display=''; btn.classList.add('active'); }
    });
  });

  tbody.querySelectorAll('button[data-sa]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.sid);
      if(btn.dataset.sa==='del') removeStock(id); else ACTIONS.openStockModal('edit',id);
    });
  });
}

ACTIONS.openStockModal=async function(mode,id){
  if(isClienteMode()) return; // el stock es de solo lectura para el cliente
  stockModalMode=mode; stockActiveId=id;
  const sfClienteField=document.getElementById('sf-cliente').closest('.field');
  if(isClienteMode()){
    sfClienteField.style.display='none';
    setHtml(document.getElementById('sf-cliente'), html`<option value="${currentClienteId}">${currentClienteNombre}</option>`);
  } else {
    sfClienteField.style.display='';
    const {data}=await db.from('clientes').select('id,nombre').order('nombre');
    setHtml(document.getElementById('sf-cliente'), joinHtml((data||[]).map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
  }
  if(mode==='create'){
    document.getElementById('stock-modal-title').textContent='Nueva compra de neumáticos';
    document.getElementById('sf-marca').value='';
    document.getElementById('sf-modelo').value='';
    document.getElementById('sf-cantidad').value='1';
    document.getElementById('sf-precio').value='';
    document.getElementById('sf-fecha').value='';
    document.getElementById('sf-notas').value='';
    document.getElementById('stock-save').textContent='Guardar';
  } else {
    const s=stockItems.find(x=>x.id===id);
    document.getElementById('stock-modal-title').textContent='Editar compra';
    document.getElementById('sf-cliente').value=s.cliente_id;
    document.getElementById('sf-marca').value=s.marca||'';
    document.getElementById('sf-modelo').value=s.modelo||'';
    document.getElementById('sf-cantidad').value=s.cantidad||1;
    document.getElementById('sf-precio').value=s.precio_unidad??'';
    document.getElementById('sf-fecha').value=s.fecha_compra||'';
    document.getElementById('sf-notas').value=s.notas||'';
    document.getElementById('stock-save').textContent='Guardar';
  }
  document.getElementById('modal-stock').classList.add('show');
  setTimeout(()=>document.getElementById('sf-marca').focus(),60);
};
ACTIONS.closeStockModal=()=>document.getElementById('modal-stock').classList.remove('show');

ACTIONS.saveStock=async function(){
  if(isClienteMode()) return;
  const marca=document.getElementById('sf-marca').value.trim();
  if(!marca){ showToast('La marca es obligatoria',true); return; }
  const cliente_id=parseInt(document.getElementById('sf-cliente').value);
  const precio=document.getElementById('sf-precio').value;
  const fields={
    cliente_id,
    marca,
    modelo:document.getElementById('sf-modelo').value.trim()||null,
    cantidad:parseInt(document.getElementById('sf-cantidad').value)||1,
    precio_unidad:precio!==''?parseFloat(precio):null,
    fecha_compra:document.getElementById('sf-fecha').value||null,
    notas:document.getElementById('sf-notas').value.trim()||null
  };
  const btn=document.getElementById('stock-save');
  btn.disabled=true; btn.textContent='Guardando...';
  // Buscar el nombre del cliente desde el select del formulario
  const clienteNombre=document.getElementById('sf-cliente').selectedOptions[0]?.text||'';
  try{
    if(stockModalMode==='create'){
      const {data,error}=await db.from('stock_neumaticos').insert(fields)
        .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas').single();
      if(error) throw error;
      stockItems.unshift({...data, clientes:{nombre:clienteNombre}});
    } else {
      const {data,error}=await db.from('stock_neumaticos').update(fields).eq('id',stockActiveId)
        .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas').single();
      if(error) throw error;
      const idx=stockItems.findIndex(x=>x.id===stockActiveId);
      if(idx>=0) stockItems[idx]={...data, clientes:{nombre:clienteNombre}};
    }
    renderStock();
    ACTIONS.closeStockModal();
    showToast('Guardado');
  } catch(e){ showToast(userError(e),true); }
  finally{ btn.disabled=false; btn.textContent='Guardar'; }
};

async function removeStock(id){
  if(isClienteMode()) return;
  const s=stockItems.find(x=>x.id===id);
  const ok=await confirmDialog('Eliminar','¿Eliminar esta entrada del stock?'); if(!ok) return;
  const {error}=await db.from('stock_neumaticos').delete().eq('id',id);
  if(error){ showToast(userError(error),true); return; }
  stockItems=stockItems.filter(x=>x.id!==id);
  renderStock();
  showToast('Eliminado');
}

ACTIONS.loadStock=loadStock;
export const load=loadStock;

export function init(){
  document.getElementById('search-stock').addEventListener('input',renderStock);
  document.getElementById('filter-cliente-stock').addEventListener('change',renderStock);
}
