// Odómetro del vehículo y ciclo de vida del neumático (montaje, desmontaje, rotación, reparación, reencauche, baja).
// Solo el admin escribe (RLS); el cliente ve la línea de tiempo de lo suyo en modo lectura.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError, confirmDialog } from '../core/ui.js';
import { isClienteMode } from '../core/auth.js';
import { ACTIONS } from '../core/actions.js';
import { getVehiculos } from './vehiculos.js';
import { getNeumVehiculoId } from './neumaticos.js';
import { TIPOS_EVENTO, TIPO_LABEL, validarOdometro, planEvento, planRotacion, kmPorNeumatico, ordenarEventos } from '../domain/ciclo-vida.js';

let vehId=null, veh=null, neums=[], eventos=[], filtroNeum='';
const $=id=>document.getElementById(id);
const fmtKm=n=>n==null?'—':Number(n).toLocaleString('es-CL')+' km';
const fmtFecha=d=>d?new Date(d).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):'—';
const hoyISO=()=>new Date().toISOString().slice(0,10);
const neumLabel=n=>`P${n.posicion} · ${[n.marca,n.modelo].filter(Boolean).join(' ')||'Sin marca'} · ${n.estado||'montado'} · vida ${n.vida||0}`;

async function cargar(){
  const [rv,rn,re]=await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,odometro_km,odometro_actualizado_at').eq('id',vehId).maybeSingle(),
    db.from('neumaticos').select('id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado,fecha_baja,motivo_baja').eq('vehiculo_id',vehId).order('posicion'),
    db.from('eventos_neumatico').select('*').eq('vehiculo_id',vehId).order('created_at',{ascending:false}).limit(500)
  ]);
  const err=rv.error||rn.error||re.error;
  if(err){ showToast(userError(err),true); return false; }
  const base=getVehiculos().find(x=>x.id===vehId)||{};
  veh={...base,...(rv.data||{})};
  neums=rn.data||[]; eventos=re.data||[];
  return true;
}

function renderOdometro(){
  const admin=!isClienteMode();
  setHtml($('ciclo-odo'), html`
    <div class="ciclo-odo-actual">
      <div class="ciclo-odo-val" id="ciclo-odo-val">${fmtKm(veh.odometro_km)}</div>
      <div class="ciclo-sub">Actualizado: ${veh.odometro_actualizado_at?fmtFecha(veh.odometro_actualizado_at):'nunca'}</div>
    </div>
    ${admin?html`<div class="ciclo-odo-form">
      <div class="field"><label for="ciclo-odo-input">Nuevo kilometraje</label>
        <input id="ciclo-odo-input" type="number" inputmode="numeric" min="0" step="1" placeholder="Ej: 128500"/></div>
      <button class="btn primary" id="ciclo-odo-save" data-action="cicloGuardarOdometro">Registrar</button>
    </div>`:''}`);
}

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
  const kms=kmPorNeumatico(eventos, veh.odometro_km??null);
  const sel=$('ciclo-filtro');
  setHtml(sel, joinHtml([html`<option value="">Todos los neumáticos</option>`, neums.map(n=>html`<option value="${n.id}" ${String(n.id)===filtroNeum?'selected':''}>${neumLabel(n)}</option>`)]));
  const kmRows=neums.filter(n=>kms['n'+n.id]).map(n=>{ const k=kms['n'+n.id]; return html`<tr>
    <td>P${n.posicion}</td><td>${[n.marca,n.modelo].filter(Boolean).join(' ')||'—'}</td><td>${n.vida||0}</td>
    <td class="mono-cell">${fmtKm(k.km)}${k.abierto?' (en uso)':''}</td>
    <td>${k.incompletos?html`<span class="badge orange">${k.incompletos} tramo(s) sin odómetro</span>`:''}</td></tr>`; });
  setHtml($('ciclo-km'), kmRows.length?html`<table class="ciclo-tabla"><thead><tr><th>Pos.</th><th>Neumático</th><th>Vida</th><th>Km recorridos</th><th></th></tr></thead><tbody>${kmRows}</tbody></table>`
    :html`<div class="ciclo-sub">Sin montajes con odómetro registrados todavía.</div>`);
  const lista=ordenarEventos(eventos,true).filter(e=>!filtroNeum||String(e.neumatico_id)===filtroNeum);
  setHtml($('ciclo-timeline'), lista.length?joinHtml(lista.map(e=>{
    const n=neums.find(x=>x.id===e.neumatico_id);
    const pos=e.tipo==='rotacion'?`P${e.posicion_origen??'?'} → P${e.posicion_destino??'?'}`:(e.posicion_origen!=null?`P${e.posicion_origen}`:'');
    return html`<div class="ciclo-ev ciclo-ev-${safeCls(e.tipo)}">
      <div class="ciclo-ev-head"><strong>${TIPO_LABEL[e.tipo]||e.tipo}</strong> <span class="ciclo-sub">${pos}${n?' · '+(n.marca||''):(e.idneumatico?' · '+e.idneumatico:'')}</span></div>
      <div class="ciclo-sub">${fmtFecha(e.created_at)}${e.odometro_km!=null?' · '+fmtKm(e.odometro_km):''}${e.costo!=null?' · costo '+e.costo:''}</div>
      ${e.notas?html`<div class="ciclo-ev-notas">${e.notas}</div>`:''}</div>`;
  })):html`<div class="ciclo-sub">Sin eventos registrados.</div>`);
}

function renderTodo(){
  $('ciclo-title').textContent=`Odómetro y ciclo de vida · ${veh.nombre||''}`;
  $('ciclo-admin').style.display=isClienteMode()?'none':'';
  renderOdometro(); renderForm(); renderTimeline();
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
  if(isClienteMode()||!veh) return;
  let r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value);
  if(r.requiereConfirmacion){
    if(!(await confirmDialog('Kilometraje menor al actual',`Se registrará ${r.valor} km, menos que ${veh.odometro_km} km. ¿Continuar?`))) return;
    r=validarOdometro(veh.odometro_km??null, $('ciclo-odo-input').value, true);
  }
  if(!r.ok){ showToast(r.error,true); return; }
  const btn=$('ciclo-odo-save'); btn.disabled=true;
  try{
    const ts=new Date().toISOString();
    const {error}=await db.from('vehiculos').update({odometro_km:r.valor, odometro_actualizado_at:ts}).eq('id',vehId);
    if(error) throw error;
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
    if(rot.intercambio && !(await confirmDialog('Intercambiar neumáticos',`La posición P${p.posicionDestino} está ocupada: se intercambiarán los neumáticos de P${n.posicion} y P${p.posicionDestino}.`))) return;
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
