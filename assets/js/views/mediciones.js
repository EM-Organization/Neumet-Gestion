// Vista Mediciones (modo vehículo): selección de cliente/vehículo, detalle de rueda, gráfico y análisis predictivo.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { BRAND } from '../core/brand.js';
import { svgEl } from '../core/svg.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode, currentClienteId, currentClienteNombre } from '../core/auth.js';
import { contextoListo, filtrarConsulta } from '../core/seccional.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { WEAR, wearStatus, avgMm, analyzeTire } from '../domain/desgaste.js';
import { med } from './mediciones-state.js';
import { fmtNum } from '../domain/formato.js';
import { mLast, mTireColor, medDrawTruck, medUpdateCounters } from './mediciones-camion.js';
import { medSwitchMode, initDispositivoMode } from './mediciones-dispositivo.js';
import './report.js';
import { etiquetaCoche } from '../domain/coche.js';

function mRenderAnalysis(pos){
  const block = document.getElementById('med-analysis-block');
  const cards = document.getElementById('med-analysis-cards');
  const a = analyzeTire(med.tireData[pos]);

  if(!a){ block.style.display='none'; return; }

  const items = [];

  // Tasa de desgaste
  if(a.mmPerWeek != null){
    const rate   = fmtNum(Math.abs(a.mmPerWeek),2);
    const losing = a.mmPerWeek > 0;
    const cls    = !losing ? 'ok' : a.mmPerWeek > 0.5 ? 'warn' : 'ok';
    items.push(html`
      <div class="analysis-card ${cls}">
        <div class="ac-label">Tasa de desgaste</div>
        <div class="ac-value ${cls}">${rate} mm/sem</div>
        <div class="ac-sub">Basado en ${a.days} días de historial</div>
      </div>`);
  }

  // Vida útil estimada
  if(a.daysUntilLimit != null){
    const weeks = Math.round(a.daysUntilLimit / 7);
    let cls, txt;
    if(a.daysUntilLimit < 30)       { cls='crit'; txt=`~${a.daysUntilLimit} días`; }
    else if(a.daysUntilLimit < 90)  { cls='warn'; txt=`~${weeks} semanas`; }
    else                             { cls='ok';   txt=`~${Math.round(a.daysUntilLimit/30)} meses`; }
    items.push(html`
      <div class="analysis-card ${cls}">
        <div class="ac-label">Vida útil estimada</div>
        <div class="ac-value ${cls}">${txt}</div>
        <div class="ac-sub">Hasta llegar a 3mm al ritmo actual</div>
      </div>`);
  }

  // Desgaste desparejo
  if(a.unevenWear != null){
    items.push(html`
      <div class="analysis-card warn">
        <div class="ac-label">Desgaste desparejo</div>
        <div class="ac-value warn">${fmtNum(a.unevenWear,1)} mm</div>
        <div class="ac-sub">Mayor desgaste en el lado ${a.unevenSide}. Revisar alineación o presión.</div>
      </div>`);
  }

  if(!items.length){ block.style.display='none'; return; }
  setHtml(cards, joinHtml(items));
  block.style.display = 'block';
}

export async function medInit(){
  const sel=document.getElementById('med-cliente-select');
  // Panel selector de cliente: ocultar en modo cliente y auto-seleccionar
  document.getElementById('med-panel-vehiculo').querySelector('.field')?.closest
  const clientePanel=document.getElementById('med-cliente-select').closest('.field');
  if(clientePanel) clientePanel.style.display=isClienteMode()?'none':'';
  document.getElementById('med-cliente-search')?.closest('.field') &&
    (document.getElementById('med-cliente-search').closest('.field').style.display=isClienteMode()?'none':'');

  if(isClienteMode()){
    // En modo cliente: cargar vehículos directamente sin seleccionar cliente
    setHtml(sel, html`<option value="${currentClienteId}">${currentClienteNombre}</option>`);
    sel.value=String(currentClienteId);
    await contextoListo();
    const {data}=await filtrarConsulta(db.from('vehiculos').select('id,nombre,patente,tipo_ruedas')
      .eq('cliente_id',currentClienteId).eq('activo',true)).order('nombre');
    med.vehs=data||[];
    const vs=document.getElementById('med-vehiculo-select');
    setHtml(vs, joinHtml([html`<option value="">— Seleccionar vehículo —</option>`, med.vehs.map(v=>html`<option value="${v.id}">${etiquetaCoche(v.nombre)}${v.patente?' · '+v.patente:''} (${v.tipo_ruedas} WHL)</option>`)]));
    vs.disabled=false;
  } else {
    const {data}=await db.from('clientes').select('id,nombre').order('nombre');
    setHtml(sel, joinHtml([html`<option value="">— Seleccionar cliente —</option>`, (data||[]).map(c=>html`<option value="${c.id}">${c.nombre}</option>`)]));
    setHtml(document.getElementById('med-vehiculo-select'), html`<option value="">— Seleccionar vehículo —</option>`);
    document.getElementById('med-vehiculo-select').disabled=true;
  }
  document.getElementById('med-truck-card').style.display='none';
  document.getElementById('med-counters-card').style.display='none';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  document.getElementById('med-loading').style.display='none';
  med.tireData={}; med.selPos=null; med.selDevice=null; med.selSession=null;
  const activeMode=document.querySelector('.med-tab.active')?.dataset?.mode||'vehiculo';
  medSwitchMode(activeMode);
}


export function init(){
  initDispositivoMode();
  document.getElementById('med-cliente-search').addEventListener('input',function(){
    const q=this.value.toLowerCase();
    const opts=document.getElementById('med-cliente-select').options;
    for(let i=1;i<opts.length;i++) opts[i].style.display=opts[i].text.toLowerCase().includes(q)?'':'none';
    const vis=Array.from(opts).slice(1).filter(o=>o.style.display!=='none');
    if(vis.length===1){ document.getElementById('med-cliente-select').value=vis[0].value; document.getElementById('med-cliente-select').dispatchEvent(new Event('change')); }
  });

  document.getElementById('med-cliente-select').addEventListener('change',async function(){
    const cid=parseInt(this.value);
    const vs=document.getElementById('med-vehiculo-select');
    document.getElementById('med-truck-card').style.display='none';
    document.getElementById('med-counters-card').style.display='none';
    document.getElementById('med-empty').style.display='flex';
    document.getElementById('med-tire-detail').style.display='none';
    if(!cid){ setHtml(vs, html`<option value="">— Seleccionar vehículo —</option>`); vs.disabled=true; return; }
    const {data}=await db.from('vehiculos').select('id,nombre,patente,tipo_ruedas').eq('cliente_id',cid).eq('activo',true).order('nombre');
    med.vehs=data||[];
    setHtml(vs, joinHtml([html`<option value="">— Seleccionar vehículo —</option>`, med.vehs.map(v=>html`<option value="${v.id}">${etiquetaCoche(v.nombre)}${v.patente?' · '+v.patente:''} (${v.tipo_ruedas} WHL)</option>`)]));
    vs.disabled=false;
  });

  document.getElementById('med-vehiculo-select').addEventListener('change',async function(){
    const vid=parseInt(this.value);
    if(!vid){ document.getElementById('med-truck-card').style.display='none';
    document.getElementById('med-counters-card').style.display='none'; document.getElementById('med-empty').style.display='flex'; document.getElementById('med-tire-detail').style.display='none'; return; }
    const v=med.vehs.find(v=>v.id===vid);
    if(v) med.tipoRuedas=String(v.tipo_ruedas);
    document.getElementById('med-loading').style.display='flex';
    document.getElementById('med-empty').style.display='none';
    document.getElementById('med-tire-detail').style.display='none';
    med.tireData={}; med.selPos=null;
    // Historial del neumático MONTADO en cada posición (v_mediciones_neumatico): tras un cambio no hereda
    // las del viejo y tras una rotación acompaña al neumático.
    const {data,error}=await db.from('v_mediciones_neumatico').select('posicion_actual,mm1,mm2,mm3,promedio,created_at,idneumatico')
      .eq('vehiculo_id',vid).eq('estado_montaje','montado').order('created_at',{ascending:true}).order('medicion_id',{ascending:true});
    if(error){ showToast(userError(error),true); document.getElementById('med-loading').style.display='none'; return; }
    // Agrupar historial por posición actual (últimas 10 lecturas por rueda)
    const grp={};
    (data||[]).forEach(r=>{ const p=parseInt(r.posicion_actual); if(!grp[p]) grp[p]=[]; grp[p].push(r); });
    Object.keys(grp).forEach(p=>{ med.tireData[parseInt(p)]=grp[p].slice(-10); });
    document.getElementById('med-loading').style.display='none';
    document.getElementById('med-truck-card').style.display='block';
    document.getElementById('med-counters-card').style.display='block';
    document.getElementById('med-empty').style.display='flex';
    document.getElementById('med-tire-detail').style.display='none';
    medDrawTruck(); medUpdateCounters();
  });
}

export function medSelectTire(pos){
  med.selPos=pos; medDrawTruck();
  const col=mTireColor(pos), hist=med.tireData[pos]||[], a=mLast(pos);
  document.getElementById('med-empty').style.display='none';
  document.getElementById('med-tire-detail').style.display='block';

  document.getElementById('med-pos-badge').textContent=`P${pos}`;
  const lr=hist[hist.length-1];
  document.getElementById('med-tire-title').textContent=lr&&lr.idneumatico?`Neumático ID ${lr.idneumatico}`:`Posición ${pos}`;
  document.getElementById('med-tire-sub').textContent=a!=null?`Promedio actual: ${fmtNum(a,1)} mm`:'Sin mediciones recientes';

  const statusEl=document.getElementById('med-tire-status');
  const statusMap={ok:{cls:'ok',txt:'Operativo'},warn:{cls:'warn',txt:'Bajo'},crit:{cls:'crit',txt:'Crítico'},neutral:{cls:'',txt:'Sin datos'}};
  const s=statusMap[col.status]||statusMap.neutral;
  statusEl.className=`tire-status ${s.cls}`;
  statusEl.textContent=s.txt+(a!=null?` · ${fmtNum(a,1)} mm`:'');

  // mm values
  const mm=['mm1','mm2','mm3'];
  mm.forEach((m,i)=>{
    const val=lr&&lr[m]!=null?parseFloat(lr[m]):null;
    const pct=val!=null?Math.min(100,(val/12)*100):0;
    const c=val==null?'var(--text-tertiary)':{ok:'#1a7f37',bajo:'#b25000',critico:'#c0392b'}[wearStatus(val)];
    const bc=val==null?'rgba(0,0,0,0.15)':{ok:'#34c759',bajo:'#ff9500',critico:'#ff3b30'}[wearStatus(val)];
    document.getElementById(`med-${m}`).textContent=val!=null?fmtNum(val,1)+' mm':'—';
    document.getElementById(`med-${m}`).style.color=c;
    document.getElementById(`med-bar${i+1}`).style.width=pct+'%';
    document.getElementById(`med-bar${i+1}`).style.background=bc;
  });

  // History table
  const tbody=document.getElementById('med-hist-body');
  if(!hist.length){
    setHtml(tbody, html`<tr><td colspan="6" style="color:var(--text-tertiary);text-align:center;padding:16px;font-size:12px">Sin registros</td></tr>`);
  } else {
    setHtml(tbody, joinHtml(hist.slice().reverse().map((r,i)=>{
      const pa=r.promedio!=null?parseFloat(r.promedio):avgMm(r);
      const rc=pa==null?'var(--text-tertiary)':{ok:'#1a7f37',bajo:'#b25000',critico:'#c0392b'}[wearStatus(pa)];
      const fecha=r.created_at?new Date(r.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
      const badge=i===0?html`<span style="background:var(--accent-light);color:var(--accent);border-radius:4px;padding:1px 5px;font-size:9px;margin-left:4px">Actual</span>`:'';
      return html`<tr>
        <td style="color:var(--text-secondary)">${fecha}${badge}</td>
        <td style="color:var(--text-secondary)">${fmtNum(r.mm1,1)}</td>
        <td style="color:var(--text-secondary)">${fmtNum(r.mm2,1)}</td>
        <td style="color:var(--text-secondary)">${fmtNum(r.mm3,1)}</td>
        <td style="color:${rc};font-weight:500">${fmtNum(pa,1)}</td>
      </tr>`;
    })));
  }
  medDrawChart(hist);
  mRenderAnalysis(pos);
}

function medDrawChart(hist){
  const svgEl=document.getElementById('med-chart-svg');
  const W=svgEl.parentElement.clientWidth||400;
  svgEl.setAttribute('width',W); svgEl.replaceChildren();
  const avgs=hist.map(r=>r.promedio!=null?parseFloat(r.promedio):avgMm(r)).filter(x=>x!=null);
  if(avgs.length<2){
    const t=svgEl('text',{x:W/2,y:55,'text-anchor':'middle','font-size':'12','font-family':"'Inter',sans-serif",fill:BRAND.textSecondary}); t.textContent='Insuficientes datos para el gráfico'; svgEl.appendChild(t); return;
  }
  const H=120,pL=32,pR=12,pT=10,pB=24,cW=W-pL-pR,cH=H-pT-pB;
  const minV=Math.max(0,Math.min(...avgs)-2), maxV=Math.min(12,Math.max(...avgs)+2);
  const xS=i=>pL+(i/(avgs.length-1))*cW, yS=v=>pT+cH-((v-minV)/(maxV-minV))*cH;

  // Background
  svgEl.appendChild(svgEl('rect',{x:pL,y:pT,width:cW,height:cH,fill:'#fafafa',rx:4,stroke:'rgba(0,0,0,0.06)','stroke-width':'0.5'}));

  // Zone fills
  [[8,12,'rgba(52,199,89,0.04)'],[5,8,'rgba(255,149,0,0.04)'],[0,5,'rgba(255,59,48,0.04)']].forEach(([lo,hi,fill])=>{
    const y1=yS(Math.min(hi,maxV)), y2=yS(Math.max(lo,minV));
    if(y2>y1) svgEl.appendChild(svgEl('rect',{x:pL,y:y1,width:cW,height:y2-y1,fill}));
  });

  // Grid lines + labels
  [4,6,8,10,12].forEach(v=>{
    if(v<minV||v>maxV) return;
    const y=yS(v);
    svgEl.appendChild(svgEl('line',{x1:pL,y1:y,x2:pL+cW,y2:y,stroke:'rgba(0,0,0,0.07)','stroke-width':'0.5','stroke-dasharray':'3 3'}));
    const lbl=svgEl('text',{x:pL-4,y:y+3.5,'text-anchor':'end','font-size':'9','font-family':"'Inter',sans-serif",fill:BRAND.textSecondary}); lbl.textContent=v; svgEl.appendChild(lbl);
  });

  // Threshold lines
  [[WEAR.OK_MM,'#34c759'],[WEAR.LOW_MM,'#ff9500']].forEach(([v,c])=>{
    if(v<minV||v>maxV) return;
    svgEl.appendChild(svgEl('line',{x1:pL,y1:yS(v),x2:pL+cW,y2:yS(v),stroke:c,'stroke-width':'0.8','stroke-dasharray':'4 3',opacity:'0.5'}));
  });

  // Area fill
  const lastCol={ok:'#34c759',bajo:'#ff9500',critico:'#ff3b30'}[wearStatus(avgs[avgs.length-1])];
  const aPath=`M${xS(0)},${yS(avgs[0])}`+avgs.slice(1).map((v,i)=>`L${xS(i+1)},${yS(v)}`).join('')+`L${xS(avgs.length-1)},${pT+cH}L${pL},${pT+cH}Z`;
  svgEl.appendChild(svgEl('path',{d:aPath,fill:lastCol+'14',stroke:'none'}));

  // Line
  const lPath=`M${xS(0)},${yS(avgs[0])}`+avgs.slice(1).map((v,i)=>`L${xS(i+1)},${yS(v)}`).join('');
  svgEl.appendChild(svgEl('path',{d:lPath,fill:'none',stroke:lastCol,'stroke-width':'2','stroke-linejoin':'round','stroke-linecap':'round'}));

  // Dots
  avgs.forEach((v,i)=>{
    const x2=xS(i), y2=yS(v), isLast=i===avgs.length-1;
    const dc={ok:'#34c759',bajo:'#ff9500',critico:'#ff3b30'}[wearStatus(v)];
    svgEl.appendChild(svgEl('circle',{cx:x2,cy:y2,r:isLast?4:2.5,fill:isLast?dc:'#fff',stroke:dc,'stroke-width':isLast?0:1.5}));
    if(isLast){ const vl=svgEl('text',{x:x2+6,y:y2-4,'font-size':'10','font-family':"'Inter',sans-serif",'font-weight':'500',fill:dc}); vl.textContent=v.toFixed(1)+'mm'; svgEl.appendChild(vl); }
    // X axis date labels (every 2nd)
    if(i%2===0||isLast){
      const rl=hist[hist.length-1-i]; // reversed order
      const actHist=hist[i];
      const xl=svgEl('text',{x:x2,y:pT+cH+14,'text-anchor':'middle','font-size':'9','font-family':"'Inter',sans-serif",fill:BRAND.textSecondary});
      xl.textContent=isLast?'Hoy':`-${avgs.length-1-i}`;
      svgEl.appendChild(xl);
    }
  });
}

ACTIONS.medSelectTire=medSelectTire;
export const load=medInit;
registerView('mediciones','Mediciones',medInit);
