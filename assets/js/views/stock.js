import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode, currentClienteId, esAdmin, esAdminEmpresa, esUsuarioSucursal, onLogout } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { menuMas } from '../core/menu-mas.js';
import { registerView, switchView } from '../core/nav.js';
import { sucursalSeleccionada } from '../core/seccional.js';
import { etiquetaCoche } from '../domain/coche.js';
import { fetchAll, PAGE_SIZE, MAX_ROWS, safeFilename } from '../domain/reportes.js';
import { COLUMNAS_KM } from '../domain/km-cubierta.js';
import { COLUMNAS_COSTO } from '../domain/costos.js';
import { rendimientoFila, cubiertasCsv } from '../domain/rendimiento-cubierta.js';
import { puedeVerCostos } from './costos.js';
import { traerPrecios, conValor } from '../core/precios.js';
import { fmtFecha, fmtPesos, fmtNum, plural } from '../domain/formato.js';
import { claveQuema } from '../domain/quema.js';
import { pestanasVisibles, PESTANA_RECAUCHUTADO } from '../domain/neumaticos.js';
import {
  CONDICIONES, CONDICIONES_MANUALES, etiquetaCondicion, claseCondicion, nombreUbicacion, validarEdicion,
  argsMoverCubierta, filtrarCubiertas, ordenarCubiertas, resumenCubiertas, traducirErrorStock, ERROR_GENERICO,
  validarLote, paramsLote, errorLote, precioPorMm, filasLote, MAX_LOTE
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
let loteModal=null, guardandoLote=false; // alta por lote abierta y envío en curso (un solo envío a la vez)
let umbralCliente=null; // umbral de retiro (mm) del cliente del perfil; el admin lo lee de la lista de clientes
let rendKm=new Map(), rendCosto=new Map(); // neumatico_id → fila de v_km_cubierta / v_costo_cubierta (columna Rendimiento)
let exportando=false; // doble clic en «Exportar CSV»: una exportación a la vez

// Espera máxima de la base para el alta por lote. Si vence NO se reintenta: el lote pudo haberse aplicado igual y
// repetirlo daría quemas repetidas. Configurable para las pruebas.
export const config = { timeoutMs: 20000 };
const TARDE = Symbol('tarde');
function conLimite(promesa) {
  let t;
  const limite = new Promise(res => { t = setTimeout(() => res(TARDE), config.timeoutMs); });
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(t));
}

// Umbral de retiro del cliente de la fila (para «$ X por mm»). Sin dato, null: la columna no se muestra.
const umbralDe=cid=>{ const c=clientes.find(x=>String(x.id)===String(cid)); return c?(c.umbral_retiro_mm??null):umbralCliente; };

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
  // El perfil de sucursal no ve el stock (la base le da cero filas): exportar no le sirve.
  $('btn-stock-csv').style.display=esUsuarioSucursal()?'none':'';
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
    <li class="stk-cab" aria-hidden="true"><span>Quema</span><span>Cubierta</span><span>Condición</span><span>Ubicación</span><span>Compra</span><span>Rendimiento</span><span></span></li>
    ${lista.map(c=>{
      const reca=enReca.has(c.id);
      const loc=reca?'En recauchutado':nombreUbicacion(c.sucursal_id,sucursales);
      const cli=admin?(c.clientes&&c.clientes.nombre)||nombreCliente(c.cliente_id):'';
      const etq=c.numero_quema||'sin quema';
      const rd=rendimientoFila(rendKm.get(c.id),rendCosto.get(c.id),{conCostos:puedeVerCostos()});
      // Medida y DOT bajo el modelo: son lo que el operario busca al recorrer el stock.
      const det=[c.medida,c.dot?`DOT ${c.dot}`:''].filter(Boolean).join(' · ');
      // Precio por mm de banda: solo con permiso de costos (el precio solo llega a quien lo ve).
      const pm=puedeVerCostos()&&c.precio_unidad!==null?precioPorMm(c.precio_unidad,c.profundidad_inicial_mm,umbralDe(c.cliente_id)):null;
      return html`<li class="stk-fila" data-cubierta="${c.id}">
        <span class="stk-quema">${c.numero_quema||'—'}${cli?html`<span class="stk-sub">${cli}</span>`:''}</span>
        <span class="stk-desc">${c.marca||'Sin marca'}${c.modelo?html` <span class="stk-sub">${c.modelo}</span>`:''}${det?html`<span class="stk-sub">${det}</span>`:''}</span>
        <span class="stk-cond"><span class="badge ${claseCondicion(c.condicion)}">${etiquetaCondicion(c.condicion)}</span></span>
        <span class="stk-loc${c.sucursal_id===null&&!reca?' stk-sin':''}">${loc}</span>
        <span class="stk-compra">${c.fecha_compra?fmtFecha(new Date(c.fecha_compra+'T00:00:00')):'—'}${c.precio_unidad!==null?html`<span class="stk-sub">${fmtPesos(c.precio_unidad)}</span>`:''}${pm!==null?html`<span class="stk-sub">$ ${fmtNum(pm,2)} por mm</span>`:''}</span>
        <span class="stk-rend" title="${rd.kmNota||''}">${rd.kmTexto}${rd.cpkTexto!==null?html`<span class="stk-sub">${rd.cpkTexto}</span>`:''}</span>
        <span class="stk-acc">${alta?html`
          ${reca||!puedeReca?'':html`<button type="button" class="btn stk-btn stk-primaria" data-action="recaEnviar" data-args="[${c.id}]" aria-label="Enviar a recauchutar la cubierta ${etq}">Enviar a recauchutar</button>`}
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
      .select('id,cliente_id,numero_quema,marca,modelo,medida,dot,profundidad_inicial_mm,fecha_compra,proveedor,factura,soporte,condicion,sucursal_id,vida,km_previos,idneumatico,clientes(nombre)')
      .is('vehiculo_id',null).eq('estado','almacenado').order('id').range(from,to);
    if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
    return q;
  },{pageSize:PAGE_SIZE,max:50000}),traerPrecios({soloStock:true})]);
  if(r.error) return r;
  if(p.error) return {...r,rows:[],error:p.error};
  return {...r,rows:conValor(r.rows,p.precios,'precio_unidad')};
}

// Km y CPK de las cubiertas de la lista: `.in` por lotes de 200 ids (el lote acota cada consulta, no la vista entera).
const LOTE_RENDIMIENTO=200;
async function cargarRendimiento(ids){
  const km=new Map(), costo=new Map(), ver=puedeVerCostos();
  for(let i=0;i<ids.length;i+=LOTE_RENDIMIENTO){
    const lote=ids.slice(i,i+LOTE_RENDIMIENTO);
    const [a,b]=await Promise.all([
      db.from('v_km_cubierta').select(COLUMNAS_KM).in('neumatico_id',lote),
      ver?db.from('v_costo_cubierta').select(COLUMNAS_COSTO).in('neumatico_id',lote):Promise.resolve({data:[],error:null})]);
    if(a.error||b.error) return {error:true};
    (a.data||[]).forEach(f=>km.set(f.neumatico_id,f));
    (b.data||[]).forEach(f=>costo.set(f.neumatico_id,f));
  }
  return {km,costo,error:false};
}

// Todas las cubiertas del cliente (cualquier estado) con sus km y costos, por lotes con range(). Cada vista tiene
// cliente_id, así que el filtro va en la base aunque la lista de Stock esté filtrada en pantalla.
async function leerParaCsv(cid){
  const pagina=(tabla,columnas,orden,max=MAX_ROWS)=>fetchAll((from,to)=>{
    let q=db.from(tabla).select(columnas).eq('cliente_id',cid);
    orden.forEach(c=>{ q=q.order(c); });
    return q.range(from,to);
  },{pageSize:PAGE_SIZE,max});
  const sinDatos={rows:[],truncated:false,error:null};
  const ver=puedeVerCostos();
  const [n,k,c,v,p]=await Promise.all([
    pagina('neumaticos','id,numero_quema,idneumatico,marca,modelo,medida,dot,profundidad_inicial_mm,fecha_compra,proveedor,factura,soporte,sucursal_id,vida,estado,vehiculo_id,posicion,vehiculos(nombre,tipo_ruedas)',['id']),
    pagina('v_km_cubierta',COLUMNAS_KM,['neumatico_id']),
    ver?pagina('v_costo_cubierta',COLUMNAS_COSTO,['neumatico_id']):Promise.resolve(sinDatos),
    // Hasta cuatro vidas por cubierta: el tope de filas es el de cubiertas por cuatro.
    ver?pagina('v_costo_vida','neumatico_id,vida,moneda,moneda_mixta,km_recorridos,km_confiable,cpk',['neumatico_id','vida'],MAX_ROWS*4):Promise.resolve(sinDatos),
    // precio_unidad no viaja en el select (privilegios por columna): se incorpora como en la lista.
    ver?traerPrecios({soloStock:true}):Promise.resolve({precios:[],error:null})]);
  if(ver&&!p.error) n.rows=conValor(n.rows,p.precios,'precio_unidad');
  return {n,k,c,v,p};
}

// Descarga local, igual que el resto de exportaciones (Reportes): el CSV ya lleva el BOM de buildCsv.
function descargarCsv(texto,nombre){
  const blob=new Blob([texto],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  // El umbral de retiro se usa solo para «$ X por mm», que muestra quien ve costos.
  const umbralQ=!esAdmin()&&isClienteMode()&&puedeVerCostos()?db.from('clientes').select('umbral_retiro_mm').eq('id',currentClienteId).maybeSingle():Promise.resolve({data:null});
  const [rl,rc,rs,rcl,rr,ru]=await Promise.all([sq,traerCubiertas(),sucQ,
    esAdmin()?db.from('clientes').select('id,nombre,umbral_retiro_mm').is('deleted_at',null).order('nombre'):Promise.resolve({data:[]}),
    db.from('recauchutados').select('neumatico_id').in('estado',['enviado','apto']),umbralQ]);
  if(mio!==cargaN) return; // llegó una carga más nueva
  if(rl.error||rc.error){ showToast(userError(rl.error||rc.error),true); return; }
  stockItems=rl.data||[];
  cubiertas=rc.rows||[];
  enReca=new Set(rr.error?[]:(rr.data||[]).map(x=>x.neumatico_id));
  sucursales=rs.error?[]:(rs.data||[]);
  clientes=rcl.error?[]:(rcl.data||[]);
  umbralCliente=ru&&!ru.error&&ru.data?(ru.data.umbral_retiro_mm??null):null;
  opcionesFiltros();
  // Valor inicial del filtro de sucursal: la elegida en la barra (Inicio, Vehículos...). Solo al cambiar esa elección;
  // después manda el filtro propio de Stock, que se puede volver a «Todas».
  const ini=isClienteMode()?sucursalSeleccionada():'';
  if(ini!==sucIni){ sucIni=ini; const f=$('filter-sucursal-stock'); if(!ini) f.value=''; else if([...f.options].some(o=>o.value===String(ini))) f.value=String(ini); }
  // En paralelo: la lista no espera una ida y vuelta más por la columna Rendimiento.
  // Sin lecturas de km, la columna muestra «Sin dato»: la lista no se cae por una vista.
  const [,rend]=await Promise.all([loadStockAssignments(), cargarRendimiento(cubiertas.map(c=>c.id))]);
  if(mio!==cargaN) return;
  if(rend.error) showToast('No se pudo leer el rendimiento de las cubiertas',true); // sin userError: no es un fallo de código
  rendKm=rend.km||new Map(); rendCosto=rend.costo||new Map();
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

// ── Alta por lote (modal-lote): los datos comunes van arriba y una fila por cubierta (Quema | DOT) ──────────────────
const setLoteError=msg=>{ $('lote-error').textContent=msg||''; };
const indiceQuemaLote=(filas,quema)=>{ const k=claveQuema(quema); const i=(filas||[]).findIndex(x=>claveQuema(x.quema)===k); return i<0?null:i; };

function leerFilasLote(){
  return [...$('lote-filas').querySelectorAll('.lote-fila')].map(el=>({
    quema:el.querySelector('.lote-quema').value, dot:el.querySelector('.lote-dot').value
  }));
}
function leerLote(){
  const v=id=>$(id).value;
  return {
    filas:leerFilasLote(), clienteId:esAdmin()?v('lt-cliente'):null,
    marca:v('lt-marca'), modelo:v('lt-modelo'), medida:v('lt-medida'), mmIniciales:v('lt-mm'), fechaCompra:v('lt-fecha'),
    precio:puedeVerCostos()?v('lt-precio'):'', proveedor:v('lt-proveedor'), factura:v('lt-factura'), soporte:v('lt-soporte'),
    sucursalId:v('lt-sucursal'),
  };
}
// Pinta las filas. Los valores que están en pantalla se leen antes de llamar; `fila` marca la fila con error.
function pintarFilasLote(filas,fila=null){
  setHtml($('lote-filas'), joinHtml(filas.map((f,i)=>html`<div class="lote-fila${i===fila?' lote-fila-error':''}" data-fila="${i}">
    <span class="lote-n">${i+1}</span>
    <input type="text" class="lote-quema" maxlength="40" autocomplete="off" value="${f.quema}" aria-label="Número de quema, cubierta ${i+1}" aria-invalid="${i===fila?'true':'false'}"/>
    <input type="text" class="lote-dot" maxlength="4" inputmode="numeric" placeholder="0825" autocomplete="off" value="${f.dot}" aria-label="DOT, cubierta ${i+1}"/>
    <button type="button" class="btn ghost stk-btn" data-action="loteQuitarFila" data-args="[${i}]" aria-label="Quitar la cubierta ${i+1}">Quitar</button>
  </div>`)));
}
function actualizarContadorLote(){
  if(guardandoLote) return; // durante el envío el botón muestra «Guardando…»
  const n=filasLote(leerFilasLote()).length;
  const btn=$('lt-guardar');
  btn.disabled=n===0;
  btn.textContent=n?`Guardar ${plural(n,'cubierta')}`:'Guardar';
}
// Error de validación o de la base: el mensaje va al pie del diálogo y la fila afectada queda marcada, con el foco.
function errorLoteUI(msg,fila=null,campo='quema'){
  setLoteError(msg);
  pintarFilasLote(leerFilasLote(),fila);
  if(fila!==null){
    const el=$('lote-filas').querySelectorAll('.lote-fila')[fila];
    if(el) el.querySelector(campo==='dot'?'.lote-dot':'.lote-quema').focus();
  }
  actualizarContadorLote();
}
function agregarFilaLote(){
  const filas=leerFilasLote();
  if(filas.length>=MAX_LOTE){ setLoteError(`El lote admite hasta ${MAX_LOTE} cubiertas`); return; }
  filas.push({quema:'',dot:''});
  pintarFilasLote(filas);
  setLoteError('');
  actualizarContadorLote();
  const quemas=$('lote-filas').querySelectorAll('.lote-quema');
  quemas[quemas.length-1].focus();
}
// Enter: de la quema pasa al DOT; en el DOT abre una fila nueva; en una quema vacía guarda el lote.
function teclaFilaLote(e){
  if(e.key!=='Enter'||!(e.target instanceof HTMLInputElement)) return;
  const fila=e.target.closest('.lote-fila'); if(!fila) return;
  e.preventDefault(); // sin esto el Enter envía el formulario en medio de la carga
  if(e.target.classList.contains('lote-quema')){
    if(!e.target.value.trim()){ ACTIONS.loteGuardar(); return; }
    fila.querySelector('.lote-dot').focus();
    return;
  }
  agregarFilaLote();
}

ACTIONS.cubiertaNueva=function(){
  if(!puedeGestionar()) return;
  loteModal={};
  const admin=esAdmin();
  $('lt-cliente-wrap').style.display=admin?'':'none';
  if(admin){
    setHtml($('lt-cliente'), joinHtml(clientes.map(c=>html`<option value="${c.id}">${c.nombre}</option>`)));
    const f=$('filter-cliente-stock').value; if(f) $('lt-cliente').value=f;
  }
  const cid=admin?$('lt-cliente').value:currentClienteId;
  ['lt-marca','lt-modelo','lt-medida','lt-mm','lt-fecha','lt-precio','lt-proveedor','lt-factura','lt-soporte'].forEach(id=>{ $(id).value=''; });
  $('lt-precio-wrap').style.display=puedeVerCostos()?'':'none';
  setHtml($('lt-sucursal'), opcionesSucursal(cid));
  pintarFilasLote([{quema:'',dot:''}]);
  setLoteError('');
  $('lt-guardar').textContent='Guardar';
  actualizarContadorLote();
  $('modal-lote').classList.add('show');
  setTimeout(()=>$('lt-marca').focus(),60); // modal-a11y enfoca de forma asíncrona: el foco propio va después
};
ACTIONS.loteCliente=function(){ setHtml($('lt-sucursal'), opcionesSucursal($('lt-cliente').value)); };
ACTIONS.loteAgregarFila=function(){ agregarFilaLote(); };
ACTIONS.loteQuitarFila=function(i){
  const filas=leerFilasLote(); filas.splice(Number(i),1);
  pintarFilasLote(filas.length?filas:[{quema:'',dot:''}]);
  setLoteError('');
  actualizarContadorLote();
};
ACTIONS.loteCerrar=function(){ $('modal-lote').classList.remove('show'); loteModal=null; };

ACTIONS.loteGuardar=async function(){
  if(!loteModal||guardandoLote||!puedeGestionar()) return; // guardandoLote: un segundo Enter no repite el envío
  const f=leerLote();
  const opts={esAdmin:esAdmin(),hoy:hoyISO(),conCostos:puedeVerCostos()};
  const v=validarLote(f,opts);
  if(!v.ok){ errorLoteUI(v.error,v.fila??null,/DOT/.test(v.error)?'dot':'quema'); return; }
  const p=paramsLote(f,opts);
  const btn=$('lt-guardar'); btn.disabled=true; btn.textContent='Guardando…'; guardandoLote=true;
  try{
    const res=await conLimite(db.rpc('stock_cubiertas_agregar_lote',p));
    if(res===TARDE){
      // No se reintenta: el lote pudo haberse aplicado igual. Se cierra y se recarga el stock para que lo vea.
      ACTIONS.loteCerrar();
      showToast('No se pudo confirmar el alta. Revisar Stock antes de reintentar',true);
      await loadStock();
      return;
    }
    const {error}=res;
    if(error){
      const e=errorLote(error);
      if(e.mensaje===ERROR_GENERICO) console.error(error); // los rechazos de negocio (quema repetida, sin permiso...) no son fallos
      errorLoteUI(e.mensaje,e.quema?indiceQuemaLote(f.filas,e.quema):null);
      showToast(e.mensaje,true);
      return;
    }
    const n=p.p_cubiertas.length;
    showToast(`${plural(n,'cubierta')} ${n===1?'agregada':'agregadas'} al stock`);
    notificar();
    ACTIONS.loteCerrar();
    await loadStock();
  } finally { guardandoLote=false; actualizarContadorLote(); }
};

ACTIONS.cubiertaEditar=function(id){
  const c=cubiertas.find(x=>String(x.id)===String(id)); if(!c||!puedeGestionar()) return;
  cubiertaModal={cubierta:c};
  $('cubierta-title').textContent='Editar cubierta';
  $('cb-quema').value=c.numero_quema||''; $('cb-quema').disabled=true;
  $('cb-quema-hint').textContent='La quema identifica a la cubierta y no se edita.';
  $('cb-marca').value=c.marca||''; $('cb-modelo').value=c.modelo||'';
  $('cb-medida').value=c.medida||''; $('cb-dot').value=c.dot||''; $('cb-mm').value=c.profundidad_inicial_mm??'';
  $('cb-fecha').value=c.fecha_compra||'';
  $('cb-precio-wrap').style.display=puedeVerCostos()?'':'none'; $('cb-precio').value=c.precio_unidad??'';
  $('cb-proveedor').value=c.proveedor||''; $('cb-factura').value=c.factura||''; $('cb-soporte').value=c.soporte||'';
  $('cb-condicion-wrap').style.display='';
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
  // Solo se envían los campos cambiados (validarEdicion); lo que se vacía va como null y la base lo borra.
  const r=validarEdicion(cubiertaModal.cubierta,{
    marca:$('cb-marca').value, modelo:$('cb-modelo').value, fechaCompra:$('cb-fecha').value,
    precio:puedeVerCostos()?$('cb-precio').value:'', medida:$('cb-medida').value, dot:$('cb-dot').value,
    mmIniciales:$('cb-mm').value, proveedor:$('cb-proveedor').value, factura:$('cb-factura').value,
    soporte:$('cb-soporte').value, condicion:$('cb-condicion').value},{hoy:hoyISO()});
  if(!r.ok){ err('cb-error',r.error); return; }
  btn.disabled=true; btn.textContent='Guardando…'; guardandoCb=true;
  try{ if(await rpcStock('stock_cubierta_editar',r.args,'Cubierta actualizada','cb-error')) ACTIONS.cubiertaCerrar(); }
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

ACTIONS.cubiertasCsv=async function(){
  if(exportando||esUsuarioSucursal()) return;
  const cid=isClienteMode()?currentClienteId:$('filter-cliente-stock').value;
  if(!cid){ showToast('Elegir un cliente para exportar sus cubiertas',true); return; }
  exportando=true; const btn=$('btn-stock-csv'); btn.disabled=true;
  try{
    const {n,k,c,v,p}=await leerParaCsv(cid);
    const malo=[n,k,c,v,p].find(x=>x.error||x.truncated);
    if(malo){
      showToast(malo.truncated?`Hay más de ${MAX_ROWS.toLocaleString('es-AR')} filas: el CSV no se genera completo`:'No se pudo leer las cubiertas para exportar',true);
      return;
    }
    const texto=cubiertasCsv(n.rows,k.rows,c.rows,v.rows,{conCostos:puedeVerCostos(),enReca,sucursales,umbral:umbralDe(cid)});
    descargarCsv(texto,safeFilename(['neumet-cubiertas',nombreCliente(cid),new Date().toISOString().slice(0,10)],'csv'));
    showToast(`CSV exportado (${n.rows.length} filas)`);
  } finally { exportando=false; btn.disabled=false; }
};

onLogout(()=>{ cubiertas=[]; stockItems=[]; sucursales=[]; clientes=[]; cubiertaModal=null; loteModal=null; umbralCliente=null; moverId=null; rendKm=new Map(); rendCosto=new Map(); $('search-stock').value=''; });

ACTIONS.loadStock=loadStock;
export const load=loadStock;
registerView('stock','Neumáticos',loadStock); // pestaña Stock; la otra pestaña es `recauchutado` (views/neumaticos.js)

export function init(){
  // «Enter» en cualquier campo guarda (docs/14 §5, regla 3).
  $('cubierta-form').addEventListener('submit',e=>{ e.preventDefault(); ACTIONS.cubiertaGuardar(); });
  $('lote-form').addEventListener('submit',e=>{ e.preventDefault(); ACTIONS.loteGuardar(); });
  $('lote-form').addEventListener('input',actualizarContadorLote);
  $('lote-filas').addEventListener('keydown',teclaFilaLote);
  $('search-stock').addEventListener('input',renderStock);
  // Cambiar el cliente reduce las sucursales ofrecidas en el filtro.
  $('filter-cliente-stock').addEventListener('change',()=>{ opcionesFiltros(); renderStock(); });
  ['filter-sucursal-stock','filter-condicion-stock'].forEach(id=>$(id).addEventListener('change',renderStock));
}
