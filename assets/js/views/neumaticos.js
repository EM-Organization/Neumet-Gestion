import { db } from '../core/supabase.js';
import { html, setHtml } from '../core/html.js';
import { svgEl } from '../core/svg.js';
import { BRAND } from '../core/brand.js';
import { showToast, userError } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { MED_CFG } from '../domain/camion.js';
import { getVehiculos } from './vehiculos.js';
import { invalidarCatalogo } from '../core/buscador.js';
import { traerPrecios, conValor } from '../core/precios.js';
import { etiquetaCoche } from '../domain/coche.js';
import { normalizarQuema, parseKmPrevios } from '../domain/quema.js';

// Columnas de neumaticos (sin precio_unidad: la base no lo entrega por select; ver core/precios.js).
const NEUM_COLS='id,vehiculo_id,cliente_id,posicion,stock_id,marca,modelo,fecha_compra,notas,idneumatico,numero_quema,km_previos,vida,estado,condicion';
let neumVehiculoId=null, neumSelPos=null, neumAssignments={}, neumStockCache=[];

// ── Dibujo del vehículo en modo asignación ──

function neumTireColor(pos){
  const n=neumAssignments[pos];
  if(!n||(!n.marca&&!n.modelo)) return {fill:'rgba(56,52,36,0.04)',stroke:'rgba(56,52,36,0.22)',text:'rgba(56,52,36,0.35)'};
  return {fill:'rgba(56,52,36,0.10)',stroke:BRAND.ink,text:BRAND.ink};
}

function neumDrawTire(svg, cx, cy, pos, TW, TH, isAbove){
  const col=neumTireColor(pos);
  const isSel=neumSelPos===pos;
  const n=neumAssignments[pos];
  const RW=TH, RH=TW, rx=3;
  const x=cx-RW/2, y=cy-RH/2;
  const g=svgEl('g',{cursor:'pointer'});
  g.addEventListener('click',()=>neumSelectTire(pos));
  // fondo
  g.appendChild(svgEl('rect',{x,y,width:RW,height:RH,rx,fill:col.fill}));
  // borde
  g.appendChild(svgEl('rect',{x,y,width:RW,height:RH,rx,fill:'none',
    stroke:col.stroke,'stroke-width':isSel?'2.5':'1.8'}));
  // doble contorno interior
  const ins=3;
  g.appendChild(svgEl('rect',{x:x+ins,y:y+ins,width:RW-ins*2,height:RH-ins*2,rx:Math.max(1,rx-2),
    fill:'none',stroke:col.stroke,'stroke-width':'0.6',opacity:'0.5'}));
  // halo selección
  if(isSel) g.appendChild(svgEl('rect',{x:x-4,y:y-4,width:RW+8,height:RH+8,rx:rx+3,
    fill:'none',stroke:BRAND.ink,'stroke-width':'1.2','stroke-dasharray':'3 2',opacity:'0.5'}));
  // marca abreviada o "P{n}"
  const label=n?.marca ? n.marca.substring(0,6) : `P${pos}`;
  const t=svgEl('text',{x:cx,y:cy,'text-anchor':'middle','dominant-baseline':'middle',
    'font-size':'6.5','font-family':"'Inter',sans-serif",'font-weight':'600',fill:col.text});
  t.textContent=label;
  g.appendChild(t);
  // label posición
  const ly=isAbove ? y-7 : y+RH+11;
  const pl=svgEl('text',{x:cx,y:ly,'text-anchor':'middle',
    'font-size':'7','font-family':"'Inter',sans-serif",'font-weight':'400',
    fill:isSel?BRAND.ink:'rgba(56,52,36,0.38)','letter-spacing':'0.04em'});
  pl.textContent=`P${pos}`;
  g.appendChild(pl);
  svg.appendChild(g);
}

function neumDrawTruck(){
  const v=getVehiculos().find(x=>x.id===neumVehiculoId);
  const key=String(v?.tipo_ruedas||10);
  const cfg=MED_CFG[key]; if(!cfg) return;
  const svg=document.getElementById('neum-assign-svg');
  svg.replaceChildren();
  const TW_s=20,TH_s=54,TW_d=15,TH_d=38,GAP_D=5,BGAP=12;
  let axleXs,bodyX1,bodyX2;
  if(key==='10'){ axleXs=[150,440,580]; bodyX1=64; bodyX2=730; }
  else           { axleXs=[120,310,420,530,640]; bodyX1=50; bodyX2=780; }
  const outerR=Math.max(BGAP+TW_d+GAP_D+TW_d, BGAP+TW_s);
  const bodyH=86, margin=28, labelExtra=22;
  const H=bodyH+(outerR+labelExtra+margin)*2;
  const W=key==='10'?860:900;
  const midY=H/2, bodyTop=midY-bodyH/2, bodyBot=midY+bodyH/2;
  const bodyW=bodyX2-bodyX1, cabW=90;
  const INK='rgba(50,49,25,';
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('height',String(Math.round(H)));

  // Grid fondo
  const defs=svgEl('defs',{});
  const pat=svgEl('pattern',{id:'ngrid',width:'20',height:'20',patternUnits:'userSpaceOnUse'});
  pat.appendChild(svgEl('path',{d:'M 20 0 L 0 0 0 20',fill:'none',stroke:INK+'0.06)','stroke-width':'0.5'}));
  defs.appendChild(pat); svg.appendChild(defs);
  svg.appendChild(svgEl('rect',{x:0,y:0,width:W,height:H,fill:'url(#ngrid)'}));

  // Ejes
  axleXs.forEach(ax=>{
    svg.appendChild(svgEl('line',{x1:ax,y1:margin/2,x2:ax,y2:H-margin/2,
      stroke:INK+'0.14)','stroke-width':'1','stroke-dasharray':'8 5','stroke-linecap':'round'}));
    svg.appendChild(svgEl('line',{x1:ax,y1:bodyTop,x2:ax,y2:bodyBot,
      stroke:INK+'0.28)','stroke-width':'1.2'}));
    [bodyTop,bodyBot].forEach(ey=>{
      svg.appendChild(svgEl('circle',{cx:ax,cy:ey,r:'2.5',
        fill:'white',stroke:INK+'0.30)','stroke-width':'0.8'}));
    });
  });
  // Línea central
  svg.appendChild(svgEl('line',{x1:bodyX1-20,y1:midY,x2:bodyX2+20,y2:midY,
    stroke:INK+'0.10)','stroke-width':'0.8','stroke-dasharray':'10 6'}));

  // Carrocería
  svg.appendChild(svgEl('rect',{x:bodyX1+2,y:bodyTop+2,width:bodyW,height:bodyH,rx:6,fill:'rgba(0,0,0,0.05)'}));
  svg.appendChild(svgEl('rect',{x:bodyX1,y:bodyTop,width:bodyW,height:bodyH,rx:6,
    fill:'rgba(56,52,36,0.07)',stroke:BRAND.ink,'stroke-width':'1.5'}));
  const wi=5;
  svg.appendChild(svgEl('rect',{x:bodyX1+wi,y:bodyTop+wi,width:bodyW-wi*2,height:bodyH-wi*2,rx:3,
    fill:'none',stroke:INK+'0.20)','stroke-width':'0.7'}));
  // Cabina
  svg.appendChild(svgEl('rect',{x:bodyX1,y:bodyTop,width:cabW,height:bodyH,rx:6,fill:'rgba(56,52,36,0.10)',stroke:'none'}));
  svg.appendChild(svgEl('line',{x1:bodyX1+cabW,y1:bodyTop+wi+2,x2:bodyX1+cabW,y2:bodyBot-wi-2,
    stroke:INK+'0.25)','stroke-width':'0.8','stroke-dasharray':'4 3'}));
  svg.appendChild(svgEl('path',{d:`M ${bodyX1+6} ${bodyTop+14} Q ${bodyX1+3} ${midY} ${bodyX1+6} ${bodyBot-14}`,
    fill:'none',stroke:INK+'0.35)','stroke-width':'1.2'}));
  // Luces
  [[bodyTop+10,10],[bodyBot-20,10]].forEach(([fy,fh])=>{
    svg.appendChild(svgEl('rect',{x:bodyX1-5,y:fy,width:5,height:fh,rx:2,fill:'rgba(56,52,36,0.55)',stroke:BRAND.ink,'stroke-width':'0.6'}));
  });
  [[bodyTop+12,14],[bodyBot-26,14]].forEach(([ry,rh])=>{
    svg.appendChild(svgEl('rect',{x:bodyX2,y:ry,width:5,height:rh,rx:2,fill:'rgba(56,52,36,0.25)',stroke:BRAND.ink,'stroke-width':'0.6'}));
  });
  // Etiqueta frente
  const lf=svgEl('text',{x:bodyX1+cabW/2,y:bodyTop-12,'text-anchor':'middle','font-size':'7',
    'font-family':"'Inter',sans-serif",'font-weight':'500',fill:INK+'0.35)','letter-spacing':'0.14em'});
  lf.textContent='FRENTE'; svg.appendChild(lf);

  // Neumáticos
  cfg.forEach((axle,ai)=>{
    const ax=axleXs[ai]; if(ax===undefined) return;
    if(axle.single){
      const L=axle.positions.find(p=>p.side==='L');
      const R=axle.positions.find(p=>p.side==='R');
      if(L) neumDrawTire(svg,ax,bodyTop-BGAP-TW_s/2,L.pos,TW_s,TH_s,true);
      if(R) neumDrawTire(svg,ax,bodyBot+BGAP+TW_s/2,R.pos,TW_s,TH_s,false);
    } else {
      const LL=axle.positions.find(p=>p.side==='LL');
      const LR=axle.positions.find(p=>p.side==='LR');
      const RL=axle.positions.find(p=>p.side==='RL');
      const RR=axle.positions.find(p=>p.side==='RR');
      const cyLI=bodyTop-BGAP-TW_d/2, cyLO=cyLI-TW_d-GAP_D;
      const cyRI=bodyBot+BGAP+TW_d/2, cyRO=cyRI+TW_d+GAP_D;
      if(LR) neumDrawTire(svg,ax,cyLI,LR.pos,TW_d,TH_d,true);
      if(LL) neumDrawTire(svg,ax,cyLO,LL.pos,TW_d,TH_d,true);
      if(RL) neumDrawTire(svg,ax,cyRI,RL.pos,TW_d,TH_d,false);
      if(RR) neumDrawTire(svg,ax,cyRO,RR.pos,TW_d,TH_d,false);
    }
  });
}

function neumSelectTire(pos){
  neumSelPos=pos;
  neumDrawTruck();
  renderNeumDetailPanel(pos);
}

function renderNeumDetailPanel(pos){
  const n=neumAssignments[pos]||{};
  const stockOpts=neumStockCache.map(s=>
    html`<option value="${s.id}" ${n.stock_id===s.id?'selected':''}>
      ${s.marca}${s.modelo?' '+s.modelo:''} ${s.precio_unidad?'· $'+s.precio_unidad:''} ${s.fecha_compra?'· '+s.fecha_compra:''}
    </option>`);
  const panel=document.getElementById('neum-detail-panel');
  setHtml(panel, html`
    <div class="ndp-header">
      <div class="ndp-title">Posición <strong>P${pos}</strong></div>
      <button class="ndp-clear" data-action="neumClearPos" data-args="[${pos}]" title="Quitar neumático">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="field" style="margin-bottom:10px">
      <label>Seleccionar del stock</label>
      <select id="ndp-stock" data-change="neumFillFromStock" data-args="[${pos}]">
        <option value="">— Ingresar manualmente —</option>
        ${stockOpts}
      </select>
    </div>
    <div class="field-row" style="gap:8px">
      <div class="field"><label>Marca</label><input id="ndp-marca" value="${(n.marca||'')}" placeholder="Michelin"/></div>
      <div class="field"><label>Modelo</label><input id="ndp-modelo" value="${(n.modelo||'')}" placeholder="X MultiWay"/></div>
    </div>
    <div class="field-row" style="gap:8px">
      <div class="field"><label>Precio/ud</label><input id="ndp-precio" type="number" value="${n.precio_unidad??''}" placeholder="0.00" min="0" step="0.01"/></div>
      <div class="field"><label>Fecha compra</label><input id="ndp-fecha" type="date" value="${n.fecha_compra||''}"/></div>
    </div>
    <div class="field-row" style="gap:8px">
      <div class="field"><label>Número de quema</label><input id="ndp-quema" value="${(n.numero_quema||'')}" maxlength="40" autocomplete="off"/></div>
      <div class="field"><label>Km que ya traía el neumático</label><input id="ndp-km-previos" type="number" value="${n.km_previos??0}" min="0" step="1"/></div>
    </div>
    <div class="field"><label>Notas</label><textarea id="ndp-notas" rows="2" placeholder="Dimensión, observaciones...">${(n.notas||'')}</textarea></div>
    <button class="btn primary ndp-btn" data-action="neumApplyPos" data-args="[${pos}]">Aplicar</button>
  `);
}

ACTIONS.neumFillFromStock=function(pos){
  const sid=parseInt(document.getElementById('ndp-stock').value);
  if(!sid) return;
  const s=neumStockCache.find(x=>x.id===sid); if(!s) return;
  document.getElementById('ndp-marca').value=s.marca||'';
  document.getElementById('ndp-modelo').value=s.modelo||'';
  document.getElementById('ndp-precio').value=s.precio_unidad??'';
  document.getElementById('ndp-fecha').value=s.fecha_compra||'';
};

ACTIONS.neumApplyPos=function(pos){
  const q=normalizarQuema(document.getElementById('ndp-quema').value);
  if(!q.ok){ showToast(q.error,true); return; }
  const kp=parseKmPrevios(document.getElementById('ndp-km-previos').value);
  if(!kp.ok){ showToast(kp.error,true); return; }
  const repetida=Object.entries(neumAssignments).some(([p,x])=>Number(p)!==pos && q.valor && x.numero_quema && x.numero_quema.toLowerCase()===q.valor.toLowerCase());
  if(repetida){ showToast('Ese número de quema ya está en otra posición de este vehículo',true); return; }
  const sid=parseInt(document.getElementById('ndp-stock').value)||null;
  const precio=document.getElementById('ndp-precio').value;
  neumAssignments[pos]={
    ...( neumAssignments[pos]||{} ),
    stock_id:sid,
    marca:document.getElementById('ndp-marca').value.trim()||null,
    modelo:document.getElementById('ndp-modelo').value.trim()||null,
    precio_unidad:precio!==''&&precio!=null?parseFloat(precio):null,
    fecha_compra:document.getElementById('ndp-fecha').value||null,
    notas:document.getElementById('ndp-notas').value.trim()||null,
    numero_quema:q.valor,
    km_previos:kp.valor
  };
  neumDrawTruck(); // actualizar colores
  showToast(`P${pos} actualizada. Guardar para confirmar`,false);
};

ACTIONS.neumClearPos=function(pos){
  delete neumAssignments[pos];
  neumSelPos=null;
  setHtml(document.getElementById('neum-detail-panel'), html`<div class="neum-no-sel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:var(--text-tertiary)"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg><span>Elegir una rueda</span></div>`);
  neumDrawTruck();
};

ACTIONS.openNeumaticosModal=async function(vehiculoId){
  neumVehiculoId=vehiculoId; neumSelPos=null; neumAssignments={};
  const v=getVehiculos().find(x=>x.id===vehiculoId);
  document.getElementById('neum-modal-title').textContent=`Neumáticos · ${etiquetaCoche(v?.nombre)}`;
  document.getElementById('modal-neumaticos').classList.add('show');
  setHtml(document.getElementById('neum-detail-panel'), html`<div class="neum-no-sel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:var(--text-tertiary)"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg><span>Elegir una rueda</span></div>`);

  // Carga paralela: registros existentes + stock del cliente
  const [{data:nData,error:nErr},{data:sData},{precios,error:pErr}]=await Promise.all([
    db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id',vehiculoId),
    db.from('stock_neumaticos').select('*').eq('cliente_id',v.cliente_id).order('marca'),
    traerPrecios({vehiculoId})
  ]);
  // Sin los precios no se puede guardar sin pisarlos con vacío: se cierra en lugar de editar a ciegas.
  if(nErr||pErr){ showToast(userError(nErr||pErr),true); ACTIONS.closeNeumaticosModal(); return; }
  conValor(nData,precios,'precio_unidad').forEach(n=>{ neumAssignments[n.posicion]=n; });
  neumStockCache=sData||[];
  neumDrawTruck();
};

ACTIONS.closeNeumaticosModal=function(){
  document.getElementById('modal-neumaticos').classList.remove('show');
};

ACTIONS.saveNeumaticos=async function(){
  const v=getVehiculos().find(x=>x.id===neumVehiculoId); if(!v) return;
  const btn=document.getElementById('neum-save');
  btn.disabled=true; btn.textContent='Guardando…';
  try{
    const rows=Object.entries(neumAssignments).map(([pos,n])=>({
      vehiculo_id:neumVehiculoId,
      cliente_id:v.cliente_id,
      posicion:parseInt(pos),
      stock_id:n.stock_id||null,
      marca:n.marca||null,
      modelo:n.modelo||null,
      precio_unidad:n.precio_unidad!=null?n.precio_unidad:null,
      fecha_compra:n.fecha_compra||null,
      notas:n.notas||null,
      numero_quema:n.numero_quema||null,
      km_previos:n.km_previos||0
    }));
    // Sin upsert: ON CONFLICT DO UPDATE leería excluded.precio_unidad y la base no da SELECT sobre esa columna.
    // Lo que ya existe en la posición se actualiza por id y lo nuevo se inserta.
    for(const r of rows){
      const id=neumAssignments[r.posicion]&&neumAssignments[r.posicion].id;
      const {error}=id?await db.from('neumaticos').update(r).eq('id',id):await db.from('neumaticos').insert(r);
      if(error) throw error;
    }
    invalidarCatalogo(); // las quemas del buscador
    showToast('Neumáticos guardados');
    ACTIONS.closeNeumaticosModal();
  } catch(e){
    showToast(e&&e.code==='23505'?'Número de quema repetido: ya lo usa otro neumático del cliente':userError(e),true);
  }
  finally{ btn.disabled=false; btn.textContent='Guardar todo'; }
};

export function getNeumVehiculoId(){ return neumVehiculoId; }

export function init(){}
