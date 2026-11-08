// Odómetro del vehículo y ciclo de vida del neumático (montaje, desmontaje, rotación, reparación, reencauche, baja).
// El admin escribe directo; el cliente (gomero) solo por RPC acotadas (cambio de neumático, rotación, odómetro: nunca
// escritura directa) y ve la línea de tiempo de lo suyo.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { getVehiculos } from './vehiculos.js';
import { fmtNum, fmtFechaHora } from '../domain/formato.js';
import { getNeumVehiculoId } from './neumaticos.js';
import { EVENTO_CAMBIO } from './cambio-neumatico.js';
import { COLUMNAS_KM, resumenKm, indexarKm } from '../domain/km-cubierta.js';
import { TIPOS_EVENTO, TIPO_LABEL, validarOdometro, planEvento, planRotacion, ordenarEventos } from '../domain/ciclo-vida.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, modeloMini } from '../domain/posicion.js';
import { miniVehiculo } from '../core/componentes.js';

let vehId=null, veh=null, neums=[], eventos=[], estadoFilas=[], kmCub=new Map(), filtroNeum='';
const $=id=>document.getElementById(id);
const fmtKm=n=>n==null?'—':fmtNum(n)+' km';
const fmtFecha=fmtFechaHora;
const hoyISO=()=>new Date().toISOString().slice(0,10);
const nomPos=p=>nombrePosicion(p, veh&&veh.tipo_ruedas);
const neumLabel=n=>`${nomPos(n.posicion)} · ${[n.marca,n.modelo].filter(Boolean).join(' ')||'Sin marca'} · ${n.estado||'montado'} · vida ${n.vida||0}${n.numero_quema?` · quema ${n.numero_quema}`:''}`;

async function cargar(){
  const [rv,rn,re,rs,rk]=await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,tipo_ruedas,odometro_km,odometro_actualizado_at').eq('id',vehId).maybeSingle(),
    db.from('neumaticos').select('id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado,fecha_baja,motivo_baja,numero_quema,km_previos').eq('vehiculo_id',vehId).order('posicion'),
    db.from('eventos_neumatico').select('*').eq('vehiculo_id',vehId).order('created_at',{ascending:false}).limit(500),
    // Solo colorea el mini vehículo: si falla, las ruedas salen sin datos.
    db.from('v_estado_neumaticos').select('*').eq('vehiculo_id',vehId).order('posicion'),
    // Km por cubierta (v_km_cubierta): si falla, la tabla de km muestra «Sin dato» en lugar de inventar valores.
    db.from('v_km_cubierta').select(COLUMNAS_KM).eq('vehiculo_id',vehId)
  ]);
  const err=rv.error||rn.error||re.error;
  if(err){ showToast(userError(err),true); return false; }
  const base=getVehiculos().find(x=>x.id===vehId)||{};
  veh={...base,...(rv.data||{})};
  neums=rn.data||[]; eventos=re.data||[]; estadoFilas=rs.error?[]:(rs.data||[]); kmCub=indexarKm(rk.error?[]:rk.data);
  return true;
}

function renderOdometro(){
  const admin=true; // el cliente también registra el kilometraje (RPC vehiculo_registrar_odometro: solo puede subirlo)
  setHtml($('ciclo-odo'), html`
    <div class="ciclo-odo-actual">
      <div class="ciclo-odo-val" id="ciclo-odo-val">${fmtKm(veh.odometro_km)}</div>
      <div class="ciclo-sub">Actualizado: ${veh.odometro_actualizado_at?fmtFecha(veh.odometro_actualizado_at):'nunca'}</div>
    </div>
    ${admin?html`<div class="ciclo-odo-form">
      <div class="field"><label for="ciclo-odo-input">Nuevo kilometraje</label>
        <input id="ciclo-odo-input" type="number" inputmode="numeric" min="0" step="1" placeholder="128500"/></div>
      <button class="btn primary" id="ciclo-odo-save" data-action="cicloGuardarOdometro">Registrar</button>
    </div>`:''}`);
}

// Punto de entrada temporal del cambio de neumático (el botón definitivo vive en el detalle del vehículo).
// Contrato: data-action="neumatico-cambiar" + data-vehiculo-id + data-posicion.
function renderCambio(){
  const disp=neums.filter(n=>n.estado==='montado' || !n.estado);
  if(!disp.length){ setHtml($('ciclo-cambio'), html``); return; }
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

function renderForm(){
  const wrap=$('ciclo-form');
  if(isClienteMode()){ setHtml(wrap, html``); return; }
  const disp=neums.filter(n=>n.estado!=='baja');
  if(!disp.length){ setHtml(wrap, html`<div class="ciclo-sub">No hay neumáticos activos asignados a este vehículo.</div>`); return; }
  setHtml(wrap, html`
    <div class="field-row">
      <div class="field"><label for="ciclo-neum">Neumático</label>
        <select id="ciclo-neum" data-change="cicloTipoCambio">${disp.map(n=>html`<option value="${n.id}">${neumLabel(n)}</option>`)}</select></div>
      <div class="field"><label for="ciclo-tipo">Acción</label>
        <select id="ciclo-tipo" data-change="cicloTipoCambio">${TIPOS_EVENTO.map(t=>html`<option value="${t}">${TIPO_LABEL[t]}</option>`)}</select></div>
    </div>
    <div id="ciclo-extra"></div>
    <div class="field-row">
      <div class="field"><label for="ciclo-ev-odo">Odómetro <span class="label-opt">(opcional)</span></label>
        <input id="ciclo-ev-odo" type="number" inputmode="numeric" min="0" step="1"/></div>
      <div class="field"><label for="ciclo-ev-costo">Costo <span class="label-opt">(opcional)</span></label>
        <input id="ciclo-ev-costo" type="number" inputmode="decimal" min="0" step="0.01"/></div>
    </div>
    <div class="field"><label for="ciclo-ev-notas">Notas <span class="label-opt">(opcional)</span></label>
      <input id="ciclo-ev-notas" type="text" maxlength="300"/></div>
    <button class="btn primary" id="ciclo-ev-save" data-action="cicloRegistrarEvento">Registrar evento</button>`);
  renderExtra();
  if(veh.odometro_km!=null) $('ciclo-ev-odo').value=String(veh.odometro_km);
}

function renderExtra(){
  const tipo=$('ciclo-tipo').value, ex=$('ciclo-extra');
  if(tipo==='rotacion') setHtml(ex, html`<div class="field"><label for="ciclo-pos-dest">Posición de destino</label>
    <input id="ciclo-pos-dest" type="number" min="1" max="99" step="1"/></div>`);
  else if(tipo==='desmontaje') setHtml(ex, html`<div class="field"><label for="ciclo-dest-estado">Destino del neumático</label>
    <select id="ciclo-dest-estado"><option value="almacenado">Almacenado</option><option value="reparacion">En reparación</option></select></div>`);
  else if(tipo==='baja') setHtml(ex, html`<div class="field-row">
    <div class="field"><label for="ciclo-baja-motivo">Motivo de la baja</label><input id="ciclo-baja-motivo" type="text" maxlength="200"/></div>
    <div class="field"><label for="ciclo-baja-fecha">Fecha de baja</label><input id="ciclo-baja-fecha" type="date" value="${hoyISO()}"/></div></div>`);
  else setHtml(ex, html``);
}

function renderTimeline(){
  const sel=$('ciclo-filtro');
  setHtml(sel, joinHtml([html`<option value="">Todos los neumáticos</option>`, neums.map(n=>html`<option value="${n.id}" ${String(n.id)===filtroNeum?'selected':''}>${neumLabel(n)}</option>`)]));
  // Km del neumático (v_km_cubierta): km que ya traía + tramos montados (también los de otros vehículos).
  const km=v=>v==null?'Sin dato':fmtKm(v);
  const kmRows=neums.filter(n=>kmCub.has(n.id)||n.numero_quema||n.km_previos>0).map(n=>{ const k=resumenKm(kmCub.get(n.id)); return html`<tr>
    <td data-label="Posición"><div class="pos-mini">${miniVehiculo(modeloMini(estadoFilas,{destacadas:[n.posicion],tipo:veh.tipo_ruedas}))}<span>${nomPos(n.posicion)}</span></div></td>
    <td data-label="Neumático">${[n.marca,n.modelo].filter(Boolean).join(' ')||'—'}</td><td class="mono-cell" data-label="N.º de quema">${n.numero_quema||'—'}</td><td data-label="Vida">${n.vida||0}</td>
    <td class="mono-cell" data-label="Km previos">${fmtKm(n.km_previos||0)}</td>
    ${k.disponible?html`<td class="mono-cell" data-label="Km recorridos">${km(k.recorridos)}</td>
    <td class="mono-cell" data-label="Tramo actual">${km(k.tramoActual)}</td>
    <td class="mono-cell" data-label="Km totales">${km(k.totales)}</td>`:html`<td class="mono-cell" data-label="Km recorridos">—</td><td class="mono-cell" data-label="Tramo actual">—</td><td class="mono-cell" data-label="Km totales">—</td>`}</tr>
    ${k.nota?html`<tr class="ciclo-km-nota"><td colspan="8">${k.nota}</td></tr>`:''}`; });
  setHtml($('ciclo-km'), kmRows.length?html`<table class="ciclo-tabla"><thead><tr><th>Posición</th><th>Neumático</th><th>N.º de quema</th><th>Vida</th><th>Km previos</th><th>Km recorridos</th><th>Tramo actual</th><th>Km totales</th></tr></thead><tbody>${kmRows}</tbody></table>`
    :html`<div class="ciclo-sub">Sin km registrados.</div>`);
  const lista=ordenarEventos(eventos,true).filter(e=>!filtroNeum||String(e.neumatico_id)===filtroNeum);
  setHtml($('ciclo-timeline'), lista.length?joinHtml(lista.map(e=>{
    const n=neums.find(x=>x.id===e.neumatico_id);
    const pos=e.tipo==='rotacion'?`${e.posicion_origen!=null?nomPos(e.posicion_origen):'?'} → ${e.posicion_destino!=null?nomPos(e.posicion_destino):'?'}`:(e.posicion_origen!=null?nomPos(e.posicion_origen):'');
    return html`<div class="ciclo-ev ciclo-ev-${safeCls(e.tipo)}">
      <div class="ciclo-ev-head"><strong>${TIPO_LABEL[e.tipo]||e.tipo}</strong> <span class="ciclo-sub">${pos}${n?' · '+(n.marca||''):(e.idneumatico?' · '+e.idneumatico:'')}</span></div>
      <div class="ciclo-sub">${fmtFecha(e.created_at)}${e.odometro_km!=null?' · '+fmtKm(e.odometro_km):''}${e.costo!=null?' · costo '+e.costo:''}</div>
      ${e.notas?html`<div class="ciclo-ev-notas">${e.notas}</div>`:''}</div>`;
  })):html`<div class="ciclo-sub">Sin eventos registrados.</div>`);
}

function renderTodo(){
  $('ciclo-title').textContent=`Odómetro y ciclo de vida · ${etiquetaCoche(veh.nombre)}`;
  $('ciclo-admin').style.display=isClienteMode()?'none':'';
  renderOdometro(); renderCambio(); renderForm(); renderTimeline();
}

ACTIONS.openCicloVida=async function(id){
  vehId=id; filtroNeum='';
  $('modal-ciclo').classList.add('show');
  if(await cargar()) renderTodo(); else ACTIONS.closeCicloVida();
};
ACTIONS.cicloDesdeNeum=function(){ const id=getNeumVehiculoId(); if(id!=null) ACTIONS.openCicloVida(id); };
ACTIONS.closeCicloVida=function(){ $('modal-ciclo').classList.remove('show'); };
ACTIONS.cicloTipoCambio=function(){ renderExtra(); };
ACTIONS.cicloFiltro=function(v){ filtroNeum=v||''; renderTimeline(); };

ACTIONS.cicloGuardarOdometro=async function(){
  if(!veh) return;
  const cliente=isClienteMode();
  let r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value);
  if(r.requiereConfirmacion){
    // El cliente no puede bajar el kilometraje (lo corrige el admin); el admin confirma, p. ej. por cambio de tablero.
    if(cliente){ showToast(`El kilometraje no puede ser menor al actual (${veh.odometro_km} km). La corrección la hace el administrador`,true); return; }
    if(!(await confirmDialog('Kilometraje menor al actual',`Se registrará ${r.valor} km, menos que ${veh.odometro_km} km. ¿Continuar?`))) return;
    r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value, true);
  }
  if(!r.ok){ showToast(r.error,true); return; }
  const btn=$('ciclo-odo-save'); btn.disabled=true;
  try{
    const ts=new Date().toISOString();
    if(cliente){
      const {error}=await db.rpc('vehiculo_registrar_odometro',{p_vehiculo_id:vehId, p_odometro_km:r.valor});
      if(error) throw error;
    } else {
      const {error}=await db.from('vehiculos').update({odometro_km:r.valor, odometro_actualizado_at:ts}).eq('id',vehId);
      if(error) throw error;
    }
    veh.odometro_km=r.valor; veh.odometro_actualizado_at=ts;
    showToast('Kilometraje registrado');
    renderOdometro(); renderTimeline();
  }catch(e){ showToast(userError(e),true); btn.disabled=false; }
};

ACTIONS.cicloRegistrarEvento=async function(){
  if(isClienteMode()) return;
  const n=neums.find(x=>String(x.id)===$('ciclo-neum').value);
  const tipo=$('ciclo-tipo').value;
  const g=id=>{ const el=$(id); return el?el.value:undefined; };
  const p=planEvento(tipo,n,{
    odometro:g('ciclo-ev-odo'), costo:g('ciclo-ev-costo'), notas:g('ciclo-ev-notas'),
    posicionDestino:g('ciclo-pos-dest'), destinoEstado:g('ciclo-dest-estado'), motivo:g('ciclo-baja-motivo'), fecha:g('ciclo-baja-fecha')
  },hoyISO());
  if(!p.ok){ showToast(p.error,true); return; }
  let rotar=false;
  if(tipo==='rotacion'){
    const rot=planRotacion(neums,n,p.posicionDestino);
    if(!rot.ok){ showToast(rot.error,true); return; }
    rotar=true;
    if(rot.intercambio && !(await confirmDialog('Intercambiar neumáticos',`La posición ${nomPos(p.posicionDestino)} está ocupada: se intercambiarán los neumáticos de ${nomPos(n.posicion)} y ${nomPos(p.posicionDestino)}.`))) return;
  }
  const btn=$('ciclo-ev-save'); btn.disabled=true;
  try{
    if(rotar){
      // Una sola llamada transaccional: intercambia posiciones y registra los eventos, o no hace nada.
      const {error}=await db.rpc('neumatico_rotar',{p_vehiculo_id:n.vehiculo_id, p_pos_a:n.posicion, p_pos_b:p.posicionDestino, p_odometro_km:p.evento.odometro_km??null});
      if(error) throw error;
      showToast(`${TIPO_LABEL[tipo]} registrado`);
    } else {
      if(Object.keys(p.patch).length){
        const {error}=await db.from('neumaticos').update(p.patch).eq('id',n.id);
        if(error) throw error;
      }
      const {error:e2}=await db.from('eventos_neumatico').insert([p.evento]);
      if(e2){ showToast('El neumático se actualizó pero no se pudo registrar el evento',true); console.error(e2); }
      else showToast(`${TIPO_LABEL[tipo]} registrado`);
    }
    if(await cargar()) renderTodo();
  }catch(e){ showToast(userError(e),true); btn.disabled=false; }
};

export function init(){}
