import { db } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../core/config.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, confirmDialog, avatarFor } from '../core/ui.js';
import { onLogin, onLogout } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { validarAlta, cuerpoCrearCliente, mensajeErrorCrearCliente, clientesVisibles, clientStatus, estaEliminado } from '../domain/clientes.js';

const SEL='id,nombre,created_at,auth_user_id,deleted_at, dispositivos(id,mac_address,activo), vehiculos(id)';
let showDeleted = false;
let clients = [], modalMode = 'create', activeId = null;

export async function loadClients(){
  setStatus(true,'Cargando...');
  let q=db.from('clientes').select(SEL);
  if(!showDeleted) q=q.is('deleted_at',null);
  const {data,error}=await q.order('created_at',{ascending:false});
  if(error){ setStatus(false,'Error de conexión'); showToast(userError(error),true); return; }
  clients=data||[]; setStatus(true,'Conectado'); renderClientes();
}

async function createClient_(body){
  const {data:{session}}=await db.auth.getSession();
  let res, result=null;
  try{
    res=await fetch(`${SUPABASE_URL}/functions/v1/crear-cliente`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':SUPABASE_KEY},
      body:JSON.stringify(body)
    });
    result=await res.json();
  }catch(_e){ /* red o respuesta no JSON: se informa abajo */ }
  if(!res||!result||!result.ok){
    const err=new Error(mensajeErrorCrearCliente(res&&res.status,result&&result.error));
    err.userMessage=err.message; throw err;
  }
  return result.cliente;
}

// Baja lógica: la RPC (solo admin) marca deleted_at y desactiva vehículos y dispositivos.
async function deleteClient(id){
  const {error}=await db.rpc('cliente_eliminar_suave',{p_id:id});
  if(error) throw error;
}

function renderClientes(){
  const q=document.getElementById('search-clientes').value;
  const tbody=document.getElementById('tbody-clientes');
  const filtered=clientesVisibles(clients,{showDeleted,query:q});

  // Stats
  const live=clients.filter(c=>!estaEliminado(c));
  document.getElementById('stat-clients').textContent=live.length;
  const totalVehs=live.reduce((s,c)=>s+(c.vehiculos||[]).length,0);
  const totalDisps=live.reduce((s,c)=>s+(c.dispositivos||[]).filter(d=>d.activo).length,0);
  const noDevs=live.filter(c=>!(c.dispositivos||[]).length).length;
  document.getElementById('stat-vehs').textContent=totalVehs;
  document.getElementById('stat-disps').textContent=totalDisps;
  document.getElementById('stat-nodev').textContent=noDevs;

  if(!clients.length||(!filtered.length&&!q)){
    setHtml(tbody, html`<tr><td colspan="5"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><div class="empty-title">Sin clientes todavía</div><div class="empty-sub">Creá tu primer cliente con el botón de arriba</div></div></td></tr>`);
    return;
  }
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="5"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">Probá con otro término</div></div></td></tr>`);
    return;
  }

  setHtml(tbody, joinHtml(filtered.map(c=>{
    const st=clientStatus(c), av=avatarFor(c.id), del=estaEliminado(c);
    const disps=c.dispositivos||[];
    const dispCount=disps.length;
    const dispActivos=disps.filter(d=>d.activo).length;
    const dispHtml=dispCount===0
      ?html`<span style="color:var(--text-tertiary);font-size:13px">—</span>`
      :html`<div style="display:flex;flex-direction:column;gap:3px">
          <span class="badge ${dispActivos>0?'blue':''}">● ${dispCount} dispositivo${dispCount!==1?'s':''}</span>
          ${disps.map(d=>html`<span class="mono-cell" style="font-size:11px;color:var(--text-secondary)">${d.mac_address}</span>`)}
        </div>`;
    return html`<tr style="${del?'opacity:.55':''}" data-deleted="${del?'1':'0'}">
      <td class="id-cell">#${c.id}</td>
      <td><div class="name-cell"><div class="name-av ${av}">${c.nombre[0].toUpperCase()}</div>${c.nombre}</div></td>
      <td>${dispHtml}</td>
      <td><span class="badge ${st.cls}">● ${st.lbl}</span></td>
      <td><div class="actions">
        ${del?html`<span style="font-size:12px;color:var(--text-tertiary)">Eliminado</span>`:html`<button class="icon-btn" data-action="abrirFichaCliente" data-args="[${c.id}]" title="Ficha y umbrales">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </button>
        <button class="icon-btn" data-a="edit" data-id="${c.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-a="del" data-id="${c.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`}
      </div></td>
    </tr>`;
  })));

  tbody.querySelectorAll('button[data-a]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.id);
      if(btn.dataset.a==='del') ACTIONS.removeClient(id); else ACTIONS.openClienteModal('edit',id);
    });
  });
}

ACTIONS.openClienteModal=function(mode,id){
  modalMode=mode; activeId=id;
  const fn=document.getElementById('field-name');
  const fe=document.getElementById('field-email');
  const fp=document.getElementById('field-password');
  const save=document.getElementById('cli-save');
  document.getElementById('f-name').value='';
  document.getElementById('f-email').value='';
  document.getElementById('f-password').value='';
  if(mode==='create'){
    document.getElementById('cli-modal-title').textContent='Nuevo cliente';
    document.getElementById('cli-modal-sub').textContent='Creá el cliente; si no definís contraseña, recibirá una invitación por email';
    save.textContent='Crear cliente';
    fn.style.display='block'; fe.style.display='block'; fp.style.display='block';
  } else {
    const c=clients.find(c=>c.id===id);
    document.getElementById('f-name').value=c.nombre;
    fn.style.display='block'; fe.style.display='none'; fp.style.display='none';
    document.getElementById('cli-modal-title').textContent='Editar cliente';
    document.getElementById('cli-modal-sub').textContent=c.nombre;
    save.textContent='Guardar';
  }
  document.getElementById('modal-cliente').classList.add('show');
  setTimeout(()=>document.getElementById('f-name').focus(),60);
};
ACTIONS.closeClienteModal=()=>document.getElementById('modal-cliente').classList.remove('show');
ACTIONS.togglePassword=()=>{ const i=document.getElementById('f-password'); i.type=i.type==='password'?'text':'password'; };

ACTIONS.saveCliente=async function(){
  const name=document.getElementById('f-name').value.trim();
  const email=document.getElementById('f-email').value.trim();
  const password=document.getElementById('f-password').value;
  const btn=document.getElementById('cli-save');
  btn.disabled=true; btn.textContent=modalMode==='create'?'Creando...':'Guardando...';
  try{
    if(modalMode==='create'){
      const v=validarAlta({nombre:name,email,password});
      if(!v.ok){ showToast(v.error,true); return; }
      const created=await createClient_(cuerpoCrearCliente(v));
      clients.unshift(created);
      showToast(v.password?`${name} creado correctamente`:`${name} creado: se envió una invitación a ${email}`);
    } else {
      if(!name){ showToast('Ingresá un nombre',true); return; }
      const {data,error}=await db.from('clientes').update({nombre:name}).eq('id',activeId).select(SEL).single();
      if(error) throw error;
      const idx=clients.findIndex(c=>c.id===activeId);
      if(idx>=0) clients[idx]=data;
      showToast('Cliente actualizado');
    }
    ACTIONS.closeClienteModal(); renderClientes();
  } catch(e){ showToast(e.userMessage||userError(e),true); }
  finally{ btn.disabled=false; btn.textContent=modalMode==='create'?'Crear cliente':'Guardar'; }
};

ACTIONS.removeClient=async function(id){
  const c=clients.find(c=>c.id===id);
  const ok=await confirmDialog(`Eliminar cliente`,`¿Eliminar a "${c.nombre}"? Se desactivarán sus vehículos y dispositivos; los datos históricos se conservan.`);
  if(!ok) return;
  try{ await deleteClient(id); clients=showDeleted?clients.map(x=>x.id===id?{...x,deleted_at:new Date().toISOString()}:x):clients.filter(c=>c.id!==id); showToast(`${c.nombre} eliminado`); renderClientes(); }
  catch(e){ showToast(userError(e),true); }
};

ACTIONS.loadClients=loadClients;
export const load=loadClients;
registerView('clientes','Clientes',loadClients);
onLogin(({cliente})=>{ if(!cliente) loadClients(); });
onLogout(()=>{ clients=[]; showDeleted=false; });

export function init(){
  document.getElementById('search-clientes').addEventListener('input',renderClientes);
  document.getElementById('chk-clientes-deleted').addEventListener('change',e=>{ showDeleted=e.target.checked; loadClients(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') ACTIONS.closeClienteModal(); });
}
