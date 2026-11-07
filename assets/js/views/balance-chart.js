// Balance: gráfico de evolución de ingresos / resultado de los últimos 12 meses (SVG).
import { svgEl as ns } from '../core/svg.js';
import { BRAND } from '../core/brand.js';

function fmtK(n){
  const abs=Math.abs(n);
  if(abs>=1000000) return (n/1000000).toFixed(1)+'M';
  if(abs>=1000)    return (n/1000).toFixed(0)+'k';
  return String(Math.round(n));
}

function niceGridVals(min,max,count=5){
  const range=max-min||1;
  const rough=range/count;
  const mag=Math.pow(10,Math.floor(Math.log10(rough)));
  const nice=[1,2,2.5,5,10].map(f=>f*mag).find(f=>f>=rough)||rough;
  const start=Math.floor(min/nice)*nice;
  const vals=[];
  for(let v=start; v<=max+nice*0.01; v=Math.round((v+nice)*1e9)/1e9) vals.push(v);
  return vals.filter(v=>v>=min-nice*0.01&&v<=max+nice*0.01);
}

export function renderBalanceChart(balanceClients,gastos){
  const svgEl=document.getElementById('balance-chart-svg');
  if(!svgEl) return;
  svgEl.replaceChildren();

  const W=svgEl.parentElement.clientWidth||700;
  svgEl.setAttribute('width',W);
  const H=280, pL=66, pR=28, pT=24, pB=42;
  const cW=W-pL-pR, cH=H-pT-pB;

  // Últimos 12 meses
  const months=[];
  const now=new Date();
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push({
      label: d.toLocaleDateString('es-AR',{month:'short'}).replace('.','').slice(0,3)
             +' '+(d.getFullYear()+'').slice(2),
      endDate: new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59)
    });
  }

  // Ingresos por mes (clientes creados antes del fin de ese mes)
  const incomes=months.map(m=>
    balanceClients.reduce((s,c)=>{
      const created=new Date(c.created_at);
      return created<=m.endDate ? s+parseFloat(c.precio_mensual||0) : s;
    },0)
  );

  // Gastos fijos mensuales (línea plana)
  const expTotal=gastos.filter(g=>g.activo&&g.recurrente).reduce((s,g)=>s+parseFloat(g.monto||0),0);

  // Resultado neto por mes
  const profits=incomes.map(inc=>inc-expTotal);

  // ── Empty state ──
  const maxInc=Math.max(...incomes);
  if(maxInc===0&&expTotal===0){
    const t=ns('text',{x:W/2,y:H/2,'text-anchor':'middle','font-size':'14',
      'font-family':"'Inter',sans-serif",fill:BRAND.textSecondary});
    t.textContent='Cargar precios de clientes y gastos para ver la evolución';
    svgEl.appendChild(t); return;
  }

  const allVals=[...incomes, expTotal, ...profits, 0];
  const rawMin=Math.min(...allVals), rawMax=Math.max(...allVals,1);
  const pad=(rawMax-rawMin)*0.18||rawMax*0.2||200;
  const vMin=rawMin<0?rawMin-pad*0.5:0;
  const vMax=rawMax+pad;
  const range=vMax-vMin;

  const xS=i=>pL+(i/(months.length-1))*cW;  // puntos en los extremos, no centrados
  const yS=v=>pT+cH-((v-vMin)/range)*cH;
  const y0=yS(0);

  // Catmull-Rom → Bezier cúbico
  function smoothLine(pts){
    if(pts.length<2) return `M${pts[0][0]},${pts[0][1]}`;
    const t=0.4;
    let d=`M${pts[0][0]},${pts[0][1]}`;
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
      const cp1x=p1[0]+(p2[0]-p0[0])*t, cp1y=p1[1]+(p2[1]-p0[1])*t;
      const cp2x=p2[0]-(p3[0]-p1[0])*t, cp2y=p2[1]-(p3[1]-p1[1])*t;
      d+=` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  const incPts =months.map((_,i)=>[xS(i), yS(incomes[i])]);
  const profPts=months.map((_,i)=>[xS(i), yS(profits[i])]);
  const lastProfit=profits[profits.length-1];
  const profColor=lastProfit>=0?'#34c759':'#ff3b30';
  const profColorAlpha=lastProfit>=0?'rgba(52,199,89,0.18)':'rgba(255,59,48,0.14)';

  // ── DEFS: gradientes de relleno ──
  const defs=ns('defs',{});

  // Gradiente ingresos (dorado → transparente)
  const gInc=ns('linearGradient',{id:'gInc',x1:'0',y1:'0',x2:'0',y2:'1'});
  gInc.appendChild(ns('stop',{offset:'0%','stop-color':BRAND.accent,'stop-opacity':'0.22'}));
  gInc.appendChild(ns('stop',{offset:'100%','stop-color':BRAND.accent,'stop-opacity':'0'}));
  defs.appendChild(gInc);

  // Gradiente resultado (verde o rojo → transparente)
  const gProf=ns('linearGradient',{id:'gProf',x1:'0',y1:'0',x2:'0',y2:'1'});
  gProf.appendChild(ns('stop',{offset:'0%','stop-color':profColor,'stop-opacity':'0.25'}));
  gProf.appendChild(ns('stop',{offset:'100%','stop-color':profColor,'stop-opacity':'0'}));
  defs.appendChild(gProf);

  svgEl.appendChild(defs);

  // ── GRILLA — muy sutil, estilo Apple ──
  niceGridVals(vMin,vMax,5).forEach(v=>{
    const y=yS(v);
    if(y<pT-2||y>pT+cH+2) return;
    svgEl.appendChild(ns('line',{x1:pL,y1:y,x2:pL+cW,y2:y,
      stroke:'rgba(0,0,0,0.055)','stroke-width':'1'}));
    const lbl=ns('text',{x:pL-10,y:y+4,'text-anchor':'end',
      'font-size':'11','font-family':"'Inter',sans-serif",fill:BRAND.textSecondary});
    lbl.textContent=fmtK(v);
    svgEl.appendChild(lbl);
  });

  // Línea de cero (referencia)
  if(y0>pT&&y0<pT+cH){
    svgEl.appendChild(ns('line',{x1:pL,y1:y0,x2:pL+cW,y2:y0,
      stroke:'rgba(0,0,0,0.1)','stroke-width':'1','stroke-dasharray':'3 3'}));
  }

  // ── ÁREAS de relleno (con gradiente) ──
  // Ingresos
  if(maxInc>0){
    const aInc=smoothLine(incPts)+` L${xS(months.length-1)},${pT+cH} L${xS(0)},${pT+cH} Z`;
    svgEl.appendChild(ns('path',{d:aInc,fill:'url(#gInc)',stroke:'none'}));
  }
  // Resultado
  const aProf=smoothLine(profPts)+` L${xS(months.length-1)},${pT+cH} L${xS(0)},${pT+cH} Z`;
  svgEl.appendChild(ns('path',{d:aProf,fill:'url(#gProf)',stroke:'none'}));

  // ── LÍNEA DE GASTOS (punteada horizontal) ──
  if(expTotal>0){
    svgEl.appendChild(ns('line',{
      x1:pL,y1:yS(expTotal),x2:pL+cW,y2:yS(expTotal),
      stroke:'rgba(192,57,43,0.55)','stroke-width':'1.8','stroke-dasharray':'7 5'}));
  }

  // ── LÍNEA DE RESULTADO (suavizada) ──
  svgEl.appendChild(ns('path',{d:smoothLine(profPts),fill:'none',stroke:profColor,
    'stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'}));

  // ── LÍNEA DE INGRESOS (suavizada, dorada) ──
  svgEl.appendChild(ns('path',{d:smoothLine(incPts),fill:'none',stroke:BRAND.ink,
    'stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'}));

  // ── PUNTOS EN CADA MES (pequeños, Apple style) ──
  months.forEach((_,i)=>{
    const isLast=i===months.length-1;
    // Ingresos
    svgEl.appendChild(ns('circle',{cx:xS(i),cy:yS(incomes[i]),r:isLast?'5':'2.5',
      fill:'white',stroke:BRAND.ink,'stroke-width':'2'}));
    // Resultado
    svgEl.appendChild(ns('circle',{cx:xS(i),cy:yS(profits[i]),r:isLast?'5':'2.5',
      fill:'white',stroke:profColor,'stroke-width':'2'}));
  });

  // ── VALOR DEL ÚLTIMO MES (badge flotante) ──
  [[incPts,BRAND.ink,incomes,'Ingresos'],[profPts,profColor,profits,'Resultado']].forEach(([pts,col,vals])=>{
    const i=pts.length-1;
    const [cx,cy]=pts[i];
    const val=fmtK(vals[i]);
    const tw=val.length*7+16;
    const bx=Math.min(cx-tw/2, pL+cW-tw-4);
    const by=cy-30;
    // Fondo del badge
    svgEl.appendChild(ns('rect',{x:bx,y:by,width:tw,height:20,rx:'10',
      fill:col,opacity:'0.15'}));
    const lbl=ns('text',{x:bx+tw/2,y:by+13.5,'text-anchor':'middle',
      'font-size':'11','font-family':"'Inter',sans-serif",'font-weight':'700',fill:col});
    lbl.textContent=val;
    svgEl.appendChild(lbl);
  });

  // Puntos en la línea de ingresos
  incomes.forEach((v,i)=>{
    const isLast=i===months.length-1;
    svgEl.appendChild(ns('circle',{cx:xS(i),cy:yS(v),r:isLast?'4.5':'2.5',
      fill:isLast?BRAND.ink:'white',stroke:BRAND.ink,'stroke-width':'1.8'}));
    // Valor del último punto
    if(isLast&&v>0){
      const lbl=ns('text',{x:xS(i),y:yS(v)-8,'text-anchor':'middle',
        'font-size':'10','font-family':"'Inter',sans-serif",'font-weight':'600',fill:BRAND.ink});
      lbl.textContent=fmtK(v);
      svgEl.appendChild(lbl);
    }
  });

  // ── ETIQUETAS EJE X ──
  months.forEach((m,i)=>{
    if(months.length>8&&i%2!==0&&i!==months.length-1) return;
    const lbl=ns('text',{x:xS(i),y:H-pB+22,'text-anchor':'middle',
      'font-size':'11','font-family':"'Inter',sans-serif",fill:BRAND.textSecondary});
    lbl.textContent=m.label;
    svgEl.appendChild(lbl);
  });
}
