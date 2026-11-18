import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode, currentClienteId, esAdmin, esAdminEmpresa, onLogout } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { menuMas } from '../core/menu-mas.js';
import { registerView, switchView } from '../core/nav.js';
import { sucursalSeleccionada } from '../core/seccional.js';
import { etiquetaCoche } from '../domain/coche.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { traerPrecios, conValor } from '../core/precios.js';
import { fmtFecha, fmtPesos, plural } from '../domain/formato.js';
import { VIDA_MAXIMA } from '../domain/recauchutado.js';
import { pestanasVisibles, PESTANA_RECAUCHUTADO } from '../domain/neumaticos.js';
import {
  CONDICIONES, CONDICIONES_MANUALES, etiquetaCondicion, claseCondicion, nombreUbicacion, validarCubierta, validarEdicion,
  argsMoverCubierta, filtrarCubiertas, ordenarCubiertas, resumenCubiertas, traducirErrorStock, ERROR_GENERICO
} from '../domain/stock-cubiertas.js';

let sucIni=''; // última sucursal de la barra aplicada como valor inicial del filtro
let stockItems=[]; // lotes anteriores: solo lectura (docs/17 PR 9: el equipo Neumet ya no los escribe)
let stockAssignMap={}; // stock_id → [{vehiculo_nombre, count}]

export async function loadStockAssignments(){
  // Carga asignaciones de neumaticos con stock_id para el cliente actual
  let q=db.from('neumaticos').select('stock_id,vehiculos(nombre)').not('stock_id','is',null);
  if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
  const {data}=await q;
  stockAssignMap={};
  (data||[]).forEach(n=>{
    if(!n.stock_id) return;
    const vnom=etiquetaCoche(n.vehiculos?.nombre)||'Vehículo desconocido';
    if(!stockAssignMap[n.stock_id]) stockAssignMap[n.stock_id]={};
    stockAssignMap[n.stock_id][vnom]=(stockAssignMap[n.stock_id][vnom]||0)+1;
  });
}

// ── Cubiertas individuales (neumáticos sin montar) ─────────────────────────────────────────────────────────────
// Cada cubierta es una fila de `neumaticos` sin vehículo. La escritura pasa solo por las RPC stock_cubierta_*: la
// autorización (admin o perfil global del propio cliente) se verifica en la base. El perfil de sucursal no ve el stock.
const $=id=>document.getElementById(id);
let enReca=new Set(), cubiertas=[], sucursales=[], clientes=[], cubiertaModal=null, moverId=null, cargaN=0, guardandoCb=false;

// Solo el administrador de la empresa escribe cubiertas (docs/17 PR 9); el equipo Neumet mira.
const puedeGestionar=()=>esAdminEmpresa();
const sucDe=cid=>sucursales.filter(x=>String(x.cliente_id)===String(cid));
const nombreCliente=id=>(clientes.find(c=>String(c.id)===String(id))||{}).nombre||'';

function cargarSelect(id,primera,opts,valor){
  const sel=$(id); const previo=valor===undefined?sel.value:valor;
  setHtml(sel, joinHtml([html`<option value="">${primera}</option>`, opts.map(o=>html`<option value="${o.id}">${o.label}</option>`)]));
  if([...sel.options].some(o=>o.value===String(previo))) sel.value=String(previo);
}

function opcionesFiltros(){
  const admin=esAdmin();
  const cli=$('filter-cliente-stock'); cli.style.display=admin?'':'none';
  if(admin) cargarSelect('filter-cliente-stock','Todos los clientes',clientes.map(c=>({id:c.id,label:c.nombre})));
  const cid=admin?$('filter-cliente-stock').value:String(currentClienteId);
  const sucs=cid?sucDe(cid):sucursales;
  const dup=admin&&!cid;
  cargarSelect('filter-sucursal-stock','Todas las sucursales',[
    ...sucs.map(x=>({id:x.id,label:dup?`${x.nombre} · ${nombreCliente(x.cliente_id)}`:x.nombre})),
    {id:'ninguna',label:'Sin sucursal'}]);
  cargarSelect('filter-condicion-stock','Todas las condiciones',CONDICIONES.map(c=>({id:c.id,label:c.label})));
}

const filtros=()=>({
  texto:$('search-stock').value, cliente:esAdmin()?$('filter-cliente-stock').value:'',
  sucursal:$('filter-sucursal-stock').value, condicion:$('filter-condicion-stock').value
});

function renderCubiertas(){
  const admin=esAdmin();
  const lista=filtrarCubiertas(ordenarCubiertas(cubiertas),filtros());
  const r=resumenCubiertas(lista);
  const alta=puedeGestionar();
  // «Enviar a recauchutar» solo para quien ve la pestaña Recauchutado (la acción vive en views/recauchutado.js).
  const puedeReca=alta&&pestanasVisibles({admin:esAdmin(),adminEmpresa:esAdminEmpresa()}).includes(PESTANA_RECAUCHUTADO);
  $('btn-cubierta-nueva').style.display=alta?'':'none';
  $('stk-resumen').textContent=!cubiertas.length?'':`${plural(r.total,'cubierta')}${r.porCondicion.length?' · '+r.porCondicion.map(c=>`${c.label} ${c.n}`).join(' · '):''}`;
  if(!cubiertas.length){
    setHtml($('stk-lista'), html`<div class="empty-state"><div class="empty-title">Sin cubiertas en stock</div>${alta?html`<div class="empty-sub">Usar «Agregar cubierta» para cargar la primera.</div>`:''}</div>`);
    return;
  }
  if(!lista.length){
    setHtml($('stk-lista'), html`<div class="empty-state"><div class="empty-title">Ninguna cubierta coincide</div><div class="empty-sub">Cambiar la búsqueda o el filtro.</div></div>`);
    return;
  }
  setHtml($('stk-lista'), html`<ul class="stk-lista" aria-label="Cubiertas en stock">
    <li class="stk-cab" aria-hidden="true"><span>Quema</span><span>Cubierta</span><span>Condición</span><span>Ubicación</span><span>Compra</span><span></span></li>
    ${lista.map(c=>{
      const reca=enReca.has(c.id);
      const loc=reca?'En recauchutado':nombreUbicacion(c.sucursal_id,sucursales);
      const cli=admin?(c.clientes&&c.clientes.nombre)||nombreCliente(c.cliente_id):'';
      const etq=c.numero_quema||'sin quema';
      return html`<li class="stk-fila" data-cubierta="${c.id}">
        <span class="stk-quema">${c.numero_quema||'—'}${cli?html`<span class="stk-sub">${cli}</span>`:''}</span>
        <span class="stk-desc">${c.marca||'Sin marca'}${c.modelo?html` <span class="stk-sub">${c.modelo}</span>`:''}</span>
        <span class="stk-cond"><span class="badge ${claseCondicion(c.condicion)}">${etiquetaCondicion(c.condicion)}</span></span>
        <span class="stk-loc${c.sucursal_id===null&&!reca?' stk-sin':''}">${loc}</span>
        <span class="stk-compra">${c.fecha_compra?fmtFecha(new Date(c.fecha_compra+'T00:00:00')):'—'}${c.precio_unidad!==null?html`<span class="stk-sub">${fmtPesos(c.precio_unidad)}</span>`:''}</span>
        <span class="stk-acc">${alta?html`
          ${reca||!puedeReca||(c.vida??0)>=VIDA_MAXIMA?'':html`<button type="button" class="btn stk-btn stk-primaria" data-action="recaEnviar" data-args="[${c.id}]" aria-label="Enviar a recauchutar la cubierta ${etq}">Enviar a recauchutar</button>`}
          ${menuMas({ etiqueta: `Más acciones de la cubierta ${etq}`, items: [
            { label: 'Editar', action: 'cubiertaEditar', args: [c.id], aria: `Editar la cubierta ${etq}` },
            ...(reca ? [] : [{ label: 'Cambiar sucursal', action: 'cubiertaMover', args: [c.id], aria: `Cambiar de sucursal la cubierta ${etq}` }]),
            // No se ofrece Eliminar cuando la base no lo permitiría: cubierta montada, dada de baja o en un proceso de recauchutado abierto.
            ...((c.estado || 'almacenado') !== 'almacenado' || reca ? [] : [{ label: 'Eliminar', action: 'cubiertaEliminar', args: [c.id], aria: `Eliminar la cubierta ${etq}`, peligro: true }]),
          ] })}`:''}</span>
      </li>`;
    })}</ul>`);
}

async function traerCubiertas(){
  // precio_unidad no se pide por select (privilegios por columna): se incorpora desde neumaticos_precios (admin y perfil global).
  const [r,p]=await Promise.all([fetchAll((from,to)=>{
    let q=db.from('neumaticos')
      .select('id,cliente_id,numero_quema,marca,modelo,fecha_compra,condicion,sucursal_id,vida,km_previos,idneumatico,clientes(nombre)')
      .is('vehiculo_id',null).order('id').range(from,to);
    if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
    return q;
  },{pageSize:PAGE_SIZE,max:50000}),traerPrecios({soloStock:true})]);
  if(r.error) return r;
  if(p.error) return {...r,rows:[],error:p.error};
  return {...r,rows:conValor(r.rows,p.precios,'precio_unidad')};
}

export async function loadStock(){
  const mio=++cargaN;
  const tbody=$('tbody-stock');
  setHtml(tbody, html`<tr><td colspan="${isClienteMode()?6:7}"><div class="loading-state"><div class="spinner"></div></div></td></tr>`);
  let sq=db.from('stock_neumaticos')
    .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas,clientes(nombre)')
    .order('created_at',{ascending:false});
  if(isClienteMode()) sq=sq.eq('cliente_id',currentClienteId);
  let sucQ=db.from('sucursales').select('id,nombre,cliente_id').order('nombre');
  if(isClienteMode()) sucQ=sucQ.eq('cliente_id',currentClienteId);
  const [rl,rc,rs,rcl,rr]=await Promise.all([sq,traerCubiertas(),sucQ,
    esAdmin()?db.from('clientes').select('id,nombre').is('deleted_at',null).order('nombre'):Promise.resolve({data:[]}),
    db.from('recauchutados').select('neumatico_id').in('estado',['enviado','apto'])]);
  if(mio!==cargaN) return; // llegó una carga más nueva
  if(rl.error||rc.error){ showToast(userError(rl.error||rc.error),true); return; }
  stockItems=rl.data||[];
  cubiertas=rc.rows||[];
  enReca=new Set(rr.error?[]:(rr.data||[]).map(x=>x.neumatico_id));
  sucursales=rs.error?[]:(rs.data||[]);
  clientes=rcl.error?[]:(rcl.data||[]);
  opcionesFiltros();
  // Valor inicial del filtro de sucursal: la elegida en la barra (Inicio, Vehículos...). Solo al cambiar esa elección;
  // después manda el filtro propio de Stock, que se puede volver a «Todas».
  const ini=isClienteMode()?sucursalSeleccionada():'';
  if(ini!==sucIni){ sucIni=ini; const f=$('filter-sucursal-stock'); if(!ini) f.value=''; else if([...f.options].some(o=>o.value===String(ini))) f.value=String(ini); }
  await loadStockAssignments();
  if(mio!==cargaN) return;
  renderStock();
}

function renderStock(){
  renderCubiertas();
  const q=$('search-stock').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):$('filter-cliente-stock').value;
  const tbody=$('tbody-stock');
  const filtered=stockItems.filter(s=>{
    const mq=(s.marca||'').toLowerCase().includes(q)||(s.modelo||'').toLowerCase().includes(q);
    const mc=!cid||String(s.cliente_id)===cid;
    return mq&&mc;
  });
  // Los lotes anteriores (legado, solo lectura) se muestran solo si existen.
  $('stock-lotes').style.display=stockItems.length?'':'none';
  // El rol cliente ve un solo cliente: la columna Cliente no aporta.
  const verCli=!isClienteMode();
  $('th-stock-cliente').hidden=!verCli;
  const cols=verCli?7:6;
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="${cols}"><div class="empty-state"><div class="empty-title">Sin lotes registrados</div></div></td></tr>`);
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
      ${verCli?html`<td>${s.clientes?s.clientes.nombre:'—'}</td>`:''}
      <td>${s.precio_unidad!=null?'$'+parseFloat(s.precio_unidad).toLocaleString('es-AR',{minimumFractionDigits:2}):'—'}</td>
      <td>${s.fecha_compra?new Date(s.fecha_compra+'T00:00:00').toLocaleDateString('es-AR'):'—'}</td>
      <td>${asigBadge}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-size:12px">${s.notas?s.notas:'—'}</td>
    </tr>
    <tr class="stock-asig-detail" data-detail="${s.id}" style="display:none">
      <td colspan="${cols}" style="padding:0">
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
      tbody.querySelectorAll('.stock-asig-detail').forEach(r=>r.style.display='none');
      tbody.querySelectorAll('.stock-asig-btn').forEach(b=>b.classList.remove('active'));
      if(!isOpen){ detail.style.display=''; btn.classList.add('active'); }
    });
  });
}

// ── Alta, edición, traslado y eliminación de cubiertas ──────────────────────────────────────────────────────────
const err=(id,msg)=>{ $(id).textContent=msg||''; };
const hoyISO=()=>new Date().toISOString().slice(0,10);
// Avisa al buscador global (core/buscador.js) para que vuelva a leer las quemas en stock.
const notificar=()=>document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));

function opcionesSucursal(clienteId,primera='Sin sucursal'){
  return joinHtml([html`<option value="">${primera}</option>`, sucDe(clienteId).map(x=>html`<option value="${x.id}">${x.nombre}</option>`)]);
}

async function rpcStock(nombre,args,okMsg,campoError){
  err(campoError,'');
  const {error}=await db.rpc(nombre,args);
  if(error){
    const m=traducirErrorStock(error);
    if(m===ERROR_GENERICO) console.error(error); // los rechazos de negocio (quema repetida, sin permiso...) no son fallos
    err(campoError,m); showToast(m,true);
    return false;
  }
  showToast(okMsg);
  notificar();
  await loadStock();
  return true;
}

ACTIONS.cubiertaNueva=function(){
  if(!puedeGestionar()) return;
  cubiertaModal={modo:'crear'};
  const admin=esAdmin();
  $('cubierta-title').textContent='Agregar cubierta';
  $('cb-cliente-wrap').style.display=admin?'':'none';
  if(admin){
    setHtml($('cb-cliente'), joinHtml(clientes.map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
    const f=$('filter-cliente-stock').value; if(f) $('cb-cliente').value=f;
  }
  const cid=admin?$('cb-cliente').value:currentClienteId;
  ['cb-quema','cb-marca','cb-modelo','cb-fecha','cb-precio'].forEach(id=>{ $(id).value=''; });
  $('cb-quema').disabled=false; $('cb-quema-hint').textContent='Único por cliente.';
  $('cb-sucursal-wrap').style.display=''; $('cb-condicion-wrap').style.display='none';
  setHtml($('cb-sucursal'), opcionesSucursal(cid));
  err('cb-error','');
  $('cb-guardar').textContent='Guardar';
  $('modal-cubierta').classList.add('show');
  setTimeout(()=>$('cb-quema').focus(),60); // modal-a11y enfoca de forma asíncrona: el foco propio va después
};
ACTIONS.cubiertaCliente=function(){ setHtml($('cb-sucursal'), opcionesSucursal($('cb-cliente').value)); };

ACTIONS.cubiertaEditar=function(id){
  const c=cubiertas.find(x=>String(x.id)===String(id)); if(!c||!puedeGestionar()) return;
  cubiertaModal={modo:'editar',cubierta:c};
  $('cubierta-title').textContent='Editar cubierta';
  $('cb-cliente-wrap').style.display='none';
  $('cb-quema').value=c.numero_quema||''; $('cb-quema').disabled=true;
  $('cb-quema-hint').textContent='La quema identifica a la cubierta y no se edita.';
  $('cb-marca').value=c.marca||''; $('cb-modelo').value=c.modelo||'';
  $('cb-fecha').value=c.fecha_compra||''; $('cb-precio').value=c.precio_unidad??'';
  $('cb-sucursal-wrap').style.display='none'; $('cb-condicion-wrap').style.display='';
  setHtml($('cb-condicion'), joinHtml([html`<option value="">${etiquetaCondicion(c.condicion)} (actual)</option>`,
    CONDICIONES_MANUALES.filter(x=>x.id!==c.condicion).map(x=>html`<option value="${x.id}">${x.label}</option>`)]));
  err('cb-error','');
  $('cb-guardar').textContent='Guardar';
  $('modal-cubierta').classList.add('show');
  setTimeout(()=>$('cb-marca').focus(),60);
};
ACTIONS.cubiertaCerrar=function(){ $('modal-cubierta').classList.remove('show'); cubiertaModal=null; };

ACTIONS.cubiertaGuardar=async function(){
  if(!cubiertaModal||guardandoCb||!puedeGestionar()) return; // guardandoCb: un segundo Enter no repite el envío
  const btn=$('cb-guardar');
  const campos={ marca:$('cb-marca').value, modelo:$('cb-modelo').value, fechaCompra:$('cb-fecha').value, precio:$('cb-precio').value };
  let nombre,args,ok;
  if(cubiertaModal.modo==='crear'){
    const r=validarCubierta({...campos,quema:$('cb-quema').value,sucursalId:$('cb-sucursal').value,
      clienteId:esAdmin()?$('cb-cliente').value:null},{esAdmin:esAdmin(),hoy:hoyISO()});
    if(!r.ok){ err('cb-error',r.error); return; }
    nombre='stock_cubierta_agregar'; args=r.args; ok='Cubierta agregada';
  } else {
    const r=validarEdicion(cubiertaModal.cubierta,{...campos,condicion:$('cb-condicion').value},{hoy:hoyISO()});
    if(!r.ok){ err('cb-error',r.error); return; }
    nombre='stock_cubierta_editar'; args=r.args; ok='Cubierta actualizada';
  }
  btn.disabled=true; btn.textContent='Guardando…'; guardandoCb=true;
  try{ if(await rpcStock(nombre,args,ok,'cb-error')) ACTIONS.cubiertaCerrar(); }
  finally{ btn.disabled=false; btn.textContent='Guardar'; guardandoCb=false; }
};

ACTIONS.cubiertaMover=function(id){
  const c=cubiertas.find(x=>String(x.id)===String(id)); if(!c||!puedeGestionar()) return;
  moverId=c.id;
  $('cubierta-mover-sub').textContent=`Quema ${c.numero_quema||'—'} · ahora en ${nombreUbicacion(c.sucursal_id,sucursales)}`;
  setHtml($('cbm-sucursal'), opcionesSucursal(c.cliente_id));
  $('cbm-sucursal').value=c.sucursal_id===null?'':String(c.sucursal_id);
  err('cbm-error','');
  $('modal-cubierta-mover').classList.add('show');
};
ACTIONS.cubiertaMoverCerrar=function(){ $('modal-cubierta-mover').classList.remove('show'); moverId=null; };
ACTIONS.cubiertaMoverGuardar=async function(){
  const c=cubiertas.find(x=>x.id===moverId); if(!c) return;
  const destino=$('cbm-sucursal').value;
  if(String(c.sucursal_id??'')===destino){ err('cbm-error','La cubierta ya está en esa ubicación'); return; }
  const btn=$('cbm-guardar'); btn.disabled=true;
  try{ if(await rpcStock('stock_cubierta_mover',argsMoverCubierta(c.id,destino),'Sucursal actualizada','cbm-error')) ACTIONS.cubiertaMoverCerrar(); }
  finally{ btn.disabled=false; }
};

ACTIONS.cubiertaEliminar=async function(id){
  const c=cubiertas.find(x=>String(x.id)===String(id)); if(!c||!puedeGestionar()) return;
  const ok=await confirmDialog('Eliminar cubierta',`¿Eliminar la cubierta ${c.numero_quema||''}? Solo se puede si nunca se usó.`,'Eliminar',true);
  if(!ok) return;
  const {error}=await db.rpc('stock_cubierta_eliminar',{p_id:c.id});
  if(error){
    const m=traducirErrorStock(error);
    if(m===ERROR_GENERICO) console.error(error);
    showToast(m,true); return;
  }
  showToast('Cubierta eliminada');
  notificar();
  await loadStock();
};

// Desde el buscador global: abre Stock filtrado por la quema.
ACTIONS.verStockQuema=function(quema){
  $('search-stock').value=String(quema||'');
  $('filter-sucursal-stock').value=''; $('filter-condicion-stock').value='';
  if(esAdmin()) $('filter-cliente-stock').value='';
  switchView('stock');
};

onLogout(()=>{ cubiertas=[]; stockItems=[]; sucursales=[]; clientes=[]; cubiertaModal=null; moverId=null; $('search-stock').value=''; });

ACTIONS.loadStock=loadStock;
export const load=loadStock;
registerView('stock','Neumáticos',loadStock); // pestaña Stock; la otra pestaña es `recauchutado` (views/neumaticos.js)

export function init(){
  // «Enter» en cualquier campo guarda (docs/14 §5, regla 3).
  $('cubierta-form').addEventListener('submit',e=>{ e.preventDefault(); ACTIONS.cubiertaGuardar(); });
  $('search-stock').addEventListener('input',renderStock);
  // Cambiar el cliente reduce las sucursales ofrecidas en el filtro.
  $('filter-cliente-stock').addEventListener('change',()=>{ opcionesFiltros(); renderStock(); });
  ['filter-sucursal-stock','filter-condicion-stock'].forEach(id=>$(id).addEventListener('change',renderStock));
}
