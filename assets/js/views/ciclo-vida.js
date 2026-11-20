// Odómetro del vehículo y ciclo de vida del neumático (montaje, desmontaje, rotación, reparación, reencauche, baja).
// El equipo Neumet solo mira (docs/17 PR 9: ya no escribe vehículos ni neumáticos ni eventos); el cliente escribe solo por RPC
// acotadas (cambio de neumático, odómetro) y ve la línea de tiempo de lo suyo. Nadie hace escritura directa sobre neumaticos,
// eventos_neumatico ni vehiculos desde esta vista.
import { tipoLayout } from '../domain/distribucion.js';
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode, esAdmin, esAdminEmpresa } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { getVehiculos } from './vehiculos.js';
import { fmtNum, fmtFechaHora } from '../domain/formato.js';
import { EVENTO_CAMBIO } from './cambio-neumatico.js';
import { COLUMNAS_KM, resumenKm, indexarKm } from '../domain/km-cubierta.js';
import { COLUMNAS_COSTO, resumenCosto, indexarCostos } from '../domain/costos.js';
import { abrirRegistroCosto, puedeVerCostos, puedeRegistrarCosto } from './costos.js';
import { TIPO_LABEL, validarOdometro, rutaOdometro, AVISO_ODOMETRO_SUCURSAL, ordenarEventos } from '../domain/ciclo-vida.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, modeloMini } from '../domain/posicion.js';
import { miniVehiculo } from '../core/componentes.js';
import { traerCostos } from '../core/precios.js';
import { conValor, textoCosto } from '../domain/precios.js';

// Columnas de eventos_neumatico sin costo (la base no lo entrega por select: se pide con traerCostos, solo admin y perfil global).
const EVENTO_COLS='id,cliente_id,vehiculo_id,neumatico_id,idneumatico,tipo,posicion_origen,posicion_destino,odometro_km,notas,created_by,created_at,sucursal_origen_id,sucursal_destino_id';
let vehId=null, veh=null, neums=[], eventos=[], estadoFilas=[], kmCub=new Map(), costoCub=new Map(), filtroNeum='';
const $=id=>document.getElementById(id);
const fmtKm=n=>n==null?'—':fmtNum(n)+' km';
const fmtFecha=fmtFechaHora;
const nomPos=p=>nombrePosicion(p, tipoLayout(veh));
const neumLabel=n=>`${nomPos(n.posicion)} · ${[n.marca,n.modelo].filter(Boolean).join(' ')||'Sin marca'} · ${n.estado||'montado'} · vida ${n.vida||0}${n.numero_quema?` · quema ${n.numero_quema}`:''}`;

async function cargar(){
  const [rv,rn,re,rs,rk,rc,rcc]=await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,tipo_ruedas,distribucion,odometro_km,odometro_actualizado_at').eq('id',vehId).maybeSingle(),
    db.from('neumaticos').select('id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado,fecha_baja,motivo_baja,numero_quema,km_previos').eq('vehiculo_id',vehId).order('posicion'),
    db.from('eventos_neumatico').select(EVENTO_COLS).eq('vehiculo_id',vehId).order('created_at',{ascending:false}).limit(500),
    // Solo colorea el mini vehículo: si falla, las ruedas salen sin datos.
    db.from('v_estado_neumaticos').select('*').eq('vehiculo_id',vehId).order('posicion'),
    // Km por cubierta (v_km_cubierta): si falla, la tabla de km muestra «Sin dato» en lugar de inventar valores.
    db.from('v_km_cubierta').select(COLUMNAS_KM).eq('vehiculo_id',vehId),
    // Costos de los eventos: vacío para el perfil de sucursal (no se consulta); si falla, la línea de tiempo sale sin costo.
    traerCostos({vehiculoId:vehId}),
    // Costo y costo por km (v_costo_cubierta): solo administrador y perfil global; el de sucursal no ve costos.
    puedeVerCostos()?db.from('v_costo_cubierta').select(COLUMNAS_COSTO).eq('vehiculo_id',vehId):Promise.resolve({data:[],error:null})
  ]);
  const err=rv.error||rn.error||re.error;
  if(err){ showToast(userError(err),true); return false; }
  const base=getVehiculos().find(x=>x.id===vehId)||{};
  veh={...base,...(rv.data||{})};
  neums=rn.data||[]; eventos=conValor(re.data,rc.costos,'costo'); estadoFilas=rs.error?[]:(rs.data||[]); kmCub=indexarKm(rk.error?[]:rk.data); costoCub=indexarCostos(rcc.error?[]:rcc.data);
  return true;
}

function renderOdometro(){
  const edita=isClienteMode(); // el cliente registra el kilometraje por RPC (sucursal: solo subirlo); el equipo Neumet solo lo ve
  setHtml($('ciclo-odo'), html`
    <div class="ciclo-odo-actual">
      <div class="ciclo-odo-val" id="ciclo-odo-val">${fmtKm(veh.odometro_km)}</div>
      <div class="ciclo-sub">Actualizado: ${veh.odometro_actualizado_at?fmtFecha(veh.odometro_actualizado_at):'nunca'}</div>
    </div>
    ${edita?html`<div class="ciclo-odo-form">
      <div class="field"><label for="ciclo-odo-input">Nuevo kilometraje</label>
        <input id="ciclo-odo-input" type="number" inputmode="numeric" min="0" step="1" placeholder="128500"/></div>
      <button class="btn primary" id="ciclo-odo-save" data-action="cicloGuardarOdometro">Registrar</button>
    </div>`:html`<div class="ciclo-sub">El kilometraje lo corrige el administrador de la empresa.</div>`}`);
}

// Punto de entrada temporal del cambio de neumático (el botón definitivo vive en el detalle del vehículo).
// Contrato: data-action="neumatico-cambiar" + data-vehiculo-id + data-posicion.
function renderCambio(){
  const disp=neums.filter(n=>n.estado==='montado' || !n.estado);
  if(esAdmin() || !disp.length){ setHtml($('ciclo-cambio'), html``); return; }
  setHtml($('ciclo-cambio'), html`
    <div class="field"><label for="ciclo-cambio-pos">Cambiar neumático (taller)</label>
      <select id="ciclo-cambio-pos" data-change="cicloCambioPos">${disp.map(n=>html`<option value="${n.posicion}">${neumLabel(n)}</option>`)}</select></div>
    <button class="btn primary" id="ciclo-cambio-btn" data-action="neumatico-cambiar" data-vehiculo-id="${vehId}" data-posicion="${disp[0].posicion}">Cambiar neumático</button>`);
}
ACTIONS.cicloCambioPos=function(v){ const b=$('ciclo-cambio-btn'); if(b) b.dataset.posicion=String(v); };
// Tras un cambio/rotación registrado desde cualquier lugar, refresca este modal si está abierto.
document.addEventListener(EVENTO_CAMBIO, async ()=>{
  if(vehId==null || !$('modal-ciclo').classList.contains('show')) return;
  if(await cargar()) renderTodo();
});

function renderTimeline(){
  const sel=$('ciclo-filtro');
  setHtml(sel, joinHtml([html`<option value="">Todos los neumáticos</option>`, neums.map(n=>html`<option value="${n.id}" ${String(n.id)===filtroNeum?'selected':''}>${neumLabel(n)}</option>`)]));
  // Km del neumático (v_km_cubierta): km que ya traía + tramos montados (también los de otros vehículos).
  const km=v=>v==null?'Sin dato':fmtKm(v);
  const kmRows=neums.filter(n=>kmCub.has(n.id)||n.numero_quema||n.km_previos>0).map(n=>{ const k=resumenKm(kmCub.get(n.id)); return html`<tr>
    <td data-label="Posición"><div class="pos-mini">${miniVehiculo(modeloMini(estadoFilas,{destacadas:[n.posicion],tipo:tipoLayout(veh)}))}<span>${nomPos(n.posicion)}</span></div></td>
    <td data-label="Neumático">${[n.marca,n.modelo].filter(Boolean).join(' ')||'—'}</td><td class="mono-cell" data-label="N.º de quema">${n.numero_quema||'—'}</td><td data-label="Vida">${n.vida||0}</td>
    <td class="mono-cell" data-label="Km previos">${fmtKm(n.km_previos||0)}</td>
    ${k.disponible?html`<td class="mono-cell" data-label="Km recorridos">${km(k.recorridos)}</td>
    <td class="mono-cell" data-label="En el tramo actual">${km(k.tramoActual)}</td>
    <td class="mono-cell" data-label="Km totales">${km(k.totales)}</td>`:html`<td class="mono-cell" data-label="Km recorridos">—</td><td class="mono-cell" data-label="En el tramo actual">—</td><td class="mono-cell" data-label="Km totales">—</td>`}</tr>
    ${k.nota?html`<tr class="ciclo-km-nota"><td colspan="8">${k.nota}</td></tr>`:''}`; });
  setHtml($('ciclo-km'), kmRows.length?html`<table class="ciclo-tabla"><thead><tr><th>Posición</th><th>Neumático</th><th>N.º de quema</th><th>Vida</th><th>Km previos</th><th>Km recorridos</th><th>En el tramo actual</th><th>Km totales</th></tr></thead><tbody>${kmRows}</tbody></table>`
    :html`<div class="ciclo-sub">Sin km registrados.</div>`);
  // Costo y costo por km por neumático (v_costo_cubierta): sin fila (perfil de sucursal) la sección no se muestra.
  const ver=puedeVerCostos();
  $('ciclo-costo-wrap').hidden=!ver;
  if(ver){
    const cRows=neums.filter(n=>costoCub.has(n.id)).map(n=>{ const c=resumenCosto(costoCub.get(n.id)); return html`<tr>
      <td data-label="Posición"><div class="pos-mini">${miniVehiculo(modeloMini(estadoFilas,{destacadas:[n.posicion],tipo:tipoLayout(veh)}))}<span>${nomPos(n.posicion)}</span></div></td>
      <td data-label="Neumático">${[n.marca,n.modelo].filter(Boolean).join(' ')||'—'}</td>
      <td class="mono-cell" data-label="Costo">${c.textoCosto}</td>
      <td class="mono-cell" data-label="Costo por km">${c.textoCpk}</td>
      <td data-label="">${puedeRegistrarCosto()?html`<button type="button" class="btn ghost ciclo-costo-btn" data-action="cicloRegistrarCosto" data-args="[${n.id}]" aria-label="Registrar costo, ${nomPos(n.posicion)}">Registrar costo</button>`:''}</td></tr>
      ${c.nota?html`<tr class="ciclo-km-nota"><td colspan="5">${c.nota}</td></tr>`:''}`; });
    setHtml($('ciclo-costo'), cRows.length?html`<table class="ciclo-tabla"><thead><tr><th>Posición</th><th>Neumático</th><th>Costo</th><th>Costo por km</th><th><span class="sr-only">Acción</span></th></tr></thead><tbody>${cRows}</tbody></table>`
      :html`<div class="ciclo-sub">Sin neumáticos montados.</div>`);
  }
  const lista=ordenarEventos(eventos,true).filter(e=>!filtroNeum||String(e.neumatico_id)===filtroNeum);
  setHtml($('ciclo-timeline'), lista.length?joinHtml(lista.map(e=>{
    const n=neums.find(x=>x.id===e.neumatico_id);
    const pos=e.tipo==='rotacion'?`${e.posicion_origen!=null?nomPos(e.posicion_origen):'?'} → ${e.posicion_destino!=null?nomPos(e.posicion_destino):'?'}`:(e.posicion_origen!=null?nomPos(e.posicion_origen):'');
    return html`<div class="ciclo-ev ciclo-ev-${safeCls(e.tipo)}">
      <div class="ciclo-ev-head"><strong>${TIPO_LABEL[e.tipo]||e.tipo}</strong> <span class="ciclo-sub">${pos}${n?' · '+(n.marca||''):(e.idneumatico?' · '+e.idneumatico:'')}</span></div>
      <div class="ciclo-sub">${fmtFecha(e.created_at)}${e.odometro_km!=null?' · '+fmtKm(e.odometro_km):''}${textoCosto(e.costo)}</div>
      ${e.notas?html`<div class="ciclo-ev-notas">${e.notas}</div>`:''}</div>`;
  })):html`<div class="ciclo-sub">Sin eventos registrados.</div>`);
}

function renderTodo(){
  $('ciclo-title').textContent=`Odómetro y ciclo de vida · ${etiquetaCoche(veh.nombre)}`;
  renderOdometro(); renderCambio(); renderTimeline();
}

ACTIONS.cicloRegistrarCosto=function(id){
  if(esAdmin()) return; // costos.js ya lo rechaza; guarda propia para no depender de eso
  const n=neums.find(x=>x.id===Number(id)); if(!n) return;
  abrirRegistroCosto({neumaticoId:n.id, etiqueta:`${nomPos(n.posicion)} · ${[n.marca,n.modelo].filter(Boolean).join(' ')||'Neumático'}`,
    alGuardar:async()=>{ if(await cargar()) renderTodo(); }});
};
ACTIONS.openCicloVida=async function(id){
  vehId=id; filtroNeum='';
  $('modal-ciclo').classList.add('show');
  if(await cargar()) renderTodo(); else ACTIONS.closeCicloVida();
};
ACTIONS.closeCicloVida=function(){ $('modal-ciclo').classList.remove('show'); };
ACTIONS.cicloFiltro=function(v){ filtroNeum=v||''; renderTimeline(); };

ACTIONS.cicloGuardarOdometro=async function(){
  if(!veh||!isClienteMode()) return; // el equipo Neumet no escribe el kilometraje (docs/17 PR 9)
  let r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value);
  let ruta=rutaOdometro({cliente:true, adminEmpresa:esAdminEmpresa(), baja:!!r.requiereConfirmacion});
  if(r.requiereConfirmacion){
    // Bajar el kilometraje (p. ej. por cambio de tablero): el usuario de sucursal no puede; el administrador de empresa
    // confirma (el equipo Neumet ya no escribe el kilometraje).
    if(ruta.accion==='avisar'){ showToast(AVISO_ODOMETRO_SUCURSAL(veh.odometro_km),true); return; }
    if(!(await confirmDialog('Kilometraje menor al actual',`Se registrará ${r.valor} km, menos que ${veh.odometro_km} km. ¿Continuar?`,'Continuar',false))) return;
    r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value, true);
  }
  if(!r.ok){ showToast(r.error,true); return; }
  const btn=$('ciclo-odo-save'); btn.disabled=true;
  try{
    const ts=new Date().toISOString();
    const {error}=await db.rpc(ruta.rpc,{p_vehiculo_id:vehId, p_odometro_km:r.valor});
    if(error) throw error;
    veh.odometro_km=r.valor; veh.odometro_actualizado_at=ts;
    showToast('Kilometraje registrado');
    renderOdometro(); renderTimeline();
  }catch(e){ showToast(userError(e),true); btn.disabled=false; }
};

export function init(){}
