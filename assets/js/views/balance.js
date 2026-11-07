import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, confirmDialog } from '../core/ui.js';
import { safeCls } from '../core/html.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { renderBalanceChart } from './balance-chart.js';
import { fmtNum } from '../domain/formato.js';

let gastos=[], gastoModalMode='create', gastoActiveId=null;
let balanceClients=[];

const fmt=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:0}).format(n);

export async function loadBalance(){
  
  const [{data:cData},{data:gData}]=await Promise.all([
    db.from('clientes').select('id,nombre,precio_mensual,created_at').order('nombre'),
    db.from('gastos').select('*').order('created_at',{ascending:false})
  ]);
  setStatus(true);
  balanceClients=cData||[];
  gastos=gData||[];
  renderBalance();
}

function renderBalance(){
  const totalIngresos=balanceClients.reduce((s,c)=>s+parseFloat(c.precio_mensual||0),0);
  const gastosActivos=gastos.filter(g=>g.activo&&g.recurrente);
  const totalGastos=gastosActivos.reduce((s,g)=>s+parseFloat(g.monto||0),0);
  const resultado=totalIngresos-totalGastos;
  const margen=totalIngresos>0?((resultado/totalIngresos)*100):0;

  // KPIs
  document.getElementById('kpi-ingresos').textContent=fmt(totalIngresos);
  document.getElementById('kpi-ingresos-sub').textContent=`${balanceClients.filter(c=>parseFloat(c.precio_mensual||0)>0).length} clientes con precio`;
  document.getElementById('kpi-gastos').textContent=fmt(totalGastos);
  document.getElementById('kpi-gastos-sub').textContent=`${gastosActivos.length} ítems recurrentes activos`;
  const resEl=document.getElementById('kpi-resultado');
  const resCard=document.getElementById('kpi-resultado-card');
  resEl.textContent=fmt(resultado);
  resEl.className='kpi-value '+(resultado>=0?'positive':'negative');
  resCard.className='balance-kpi '+(resultado>=0?'positive':'negative');
  const margenEl=document.getElementById('kpi-margen');
  margenEl.textContent=totalIngresos>0?fmtNum(margen,1)+'%':'—';
  margenEl.className='kpi-value '+(margen>=0?'positive':'negative');

  // Totales
  document.getElementById('total-ingresos-lbl').textContent=fmt(totalIngresos);
  document.getElementById('total-gastos-lbl').textContent=fmt(totalGastos);

  // Tabla ingresos
  const tbody1=document.getElementById('tbody-ingresos');
  if(!balanceClients.length){
    setHtml(tbody1, html`<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">Sin clientes</td></tr>`);
  } else {
    setHtml(tbody1, joinHtml(balanceClients.map(c=>html`
      <tr>
        <td style="font-weight:500">${c.nombre}</td>
        <td style="text-align:right">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
            <span style="font-size:12px;color:var(--text-tertiary)">$</span>
            <input class="precio-input" type="number" min="0" step="1"
              value="${parseFloat(c.precio_mensual||0).toFixed(0)}"
              data-cid="${c.id}"
              data-change="updatePrecio" data-args="[${c.id}]"
              aria-label="Precio mensual de ${c.nombre}" title="Enter para guardar"/>
          </div>
        </td>
        <td>
          <span style="font-size:11px;font-weight:600;color:${parseFloat(c.precio_mensual||0)>0?'var(--success)':'var(--text-tertiary)'}">${parseFloat(c.precio_mensual||0)>0?'●':'○'}</span>
        </td>
      </tr>`)));
  }

  // Tabla gastos
  const tbody2=document.getElementById('tbody-gastos');
  if(!gastos.length){
    setHtml(tbody2, html`<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">Sin gastos registrados</td></tr>`);
  } else {
    setHtml(tbody2, joinHtml(gastos.map(g=>{
      const opacidad=(!g.activo||!g.recurrente)?'opacity:0.45':'';
      return html`<tr style="${opacidad}">
        <td>
          <div style="font-weight:500;font-size:13px">${g.nombre}</div>
          ${g.notas?html`<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${g.notas}</div>`:''}
          ${!g.recurrente?html`<span style="font-size:10px;color:var(--text-secondary)">(único)</span>`:''}
          ${!g.activo?html`<span style="font-size:10px;color:var(--danger)"> · inactivo</span>`:''}
        </td>
        <td><span class="cat-pill cat-${safeCls(g.categoria)}">${g.categoria}</span></td>
        <td style="text-align:right;font-family:var(--font-mono);font-size:13px;font-weight:600;color:${g.activo&&g.recurrente?'var(--danger)':'var(--text-tertiary)'}">${fmt(g.monto)}</td>
        <td><div class="actions">
          <button class="icon-btn" data-ga="edit" data-gid="${g.id}" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" data-ga="del" data-gid="${g.id}" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div></td>
      </tr>`;
    })));
    tbody2.querySelectorAll('button[data-ga]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const id=parseInt(btn.dataset.gid);
        if(btn.dataset.ga==='del') removeGasto(id); else ACTIONS.openGastoModal('edit',id);
      });
    });
  }

  // Dibujar gráfico (después de renderizar tablas para que el DOM esté listo)
  requestAnimationFrame(()=>renderBalanceChart(balanceClients,gastos));
}

ACTIONS.updatePrecio=async function(clienteId,val){
  const precio=Math.max(0,parseFloat(val)||0);
  const {error}=await db.from('clientes').update({precio_mensual:precio}).eq('id',clienteId);
  if(error){ showToast('Error al guardar precio',true); return; }
  const c=balanceClients.find(c=>c.id===clienteId);
  if(c) c.precio_mensual=precio;
  renderBalance();
  showToast('Precio actualizado');
};

ACTIONS.openGastoModal=function(mode,id){
  gastoModalMode=mode; gastoActiveId=id;
  const save=document.getElementById('gasto-save');
  if(mode==='create'){
    document.getElementById('gasto-modal-title').textContent='Nuevo gasto';
    document.getElementById('gasto-modal-sub').textContent='Gasto mensual de la empresa';
    document.getElementById('gf-nombre').value='';
    document.getElementById('gf-categoria').value='Operativo';
    document.getElementById('gf-monto').value='';
    document.getElementById('gf-notas').value='';
    document.getElementById('gf-recurrente').checked=true;
    document.getElementById('gf-activo').checked=true;
    save.textContent='Crear gasto';
  } else {
    const g=gastos.find(g=>g.id===id);
    document.getElementById('gasto-modal-title').textContent='Editar gasto';
    document.getElementById('gasto-modal-sub').textContent=g.nombre;
    document.getElementById('gf-nombre').value=g.nombre;
    document.getElementById('gf-categoria').value=g.categoria;
    document.getElementById('gf-monto').value=parseFloat(g.monto).toFixed(2);
    document.getElementById('gf-notas').value=g.notas||'';
    document.getElementById('gf-recurrente').checked=g.recurrente;
    document.getElementById('gf-activo').checked=g.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-gasto').classList.add('show');
  setTimeout(()=>document.getElementById('gf-nombre').focus(),60);
};
ACTIONS.closeGastoModal=()=>document.getElementById('modal-gasto').classList.remove('show');

ACTIONS.saveGasto=async function(){
  const nombre=document.getElementById('gf-nombre').value.trim();
  const categoria=document.getElementById('gf-categoria').value;
  const monto=parseFloat(document.getElementById('gf-monto').value)||0;
  const notas=document.getElementById('gf-notas').value.trim()||null;
  const recurrente=document.getElementById('gf-recurrente').checked;
  const activo=document.getElementById('gf-activo').checked;
  if(!nombre||monto<0){ showToast('Falta el concepto o el monto',true); return; }
  const btn=document.getElementById('gasto-save');
  btn.disabled=true; btn.textContent=gastoModalMode==='create'?'Creando…':'Guardando…';
  try{
    if(gastoModalMode==='create'){
      const {data,error}=await db.from('gastos').insert({nombre,categoria,monto,notas,recurrente,activo}).select().single();
      if(error) throw error;
      gastos.unshift(data);
      showToast(`Gasto "${nombre}" creado`);
    } else {
      const {data,error}=await db.from('gastos').update({nombre,categoria,monto,notas,recurrente,activo}).eq('id',gastoActiveId).select().single();
      if(error) throw error;
      const idx=gastos.findIndex(g=>g.id===gastoActiveId);
      if(idx>=0) gastos[idx]=data;
      showToast('Gasto actualizado');
    }
    ACTIONS.closeGastoModal(); renderBalance();
  } catch(e){ showToast(userError(e),true); }
  finally{ btn.disabled=false; btn.textContent=gastoModalMode==='create'?'Crear gasto':'Guardar'; }
};

async function removeGasto(id){
  const g=gastos.find(g=>g.id===id);
  const ok=await confirmDialog('Eliminar gasto',`¿Eliminar "${g.nombre}" de los gastos?`);
  if(!ok) return;
  const {error}=await db.from('gastos').delete().eq('id',id);
  if(error){ showToast(userError(error),true); return; }
  gastos=gastos.filter(g=>g.id!==id);
  showToast('Gasto eliminado'); renderBalance();
}

ACTIONS.loadBalance=loadBalance;
export const load=loadBalance;
registerView('balance','Balance',loadBalance);
export function init(){}
