// Mediciones: dibujo SVG del vehículo (vista superior) con el estado de cada rueda.
import { svgEl } from '../core/svg.js';
import { BRAND } from '../core/brand.js';
import { ACTIONS } from '../core/actions.js';
import { avgMm, wearClass, countByStatus } from '../domain/desgaste.js';
import { MED_CFG } from '../domain/camion.js';
import { med } from './mediciones-state.js';

export function mLast(pos){ const h=med.tireData[pos]; return(!h||!h.length)?null:avgMm(h[h.length-1]); }
function medDrawTire(svg, cx, cy, pos, TW, TH, isSingle, isAbove){
  const col=mTireColor(pos), isSel=med.selPos===pos, a=mLast(pos);
  const g=svgEl('g',{cursor:'pointer'});
  g.addEventListener('click',()=>ACTIONS.medSelectTire(pos));

  // Girar 90°: el lado largo queda horizontal (paralelo al bus)
  const RW=TH, RH=TW;
  const rx=3;
  const x=cx-RW/2, y=cy-RH/2;
  const hasData=a!==null;

  // Fondo claro con tinte de estado
  g.appendChild(svgEl('rect',{
    x, y, width:RW, height:RH, rx,
    fill: hasData ? col.fill : 'rgba(56,52,36,0.04)'
  }));

  // Contorno de estado — línea principal
  g.appendChild(svgEl('rect',{
    x, y, width:RW, height:RH, rx,
    fill:'none',
    stroke: hasData ? col.stroke : 'rgba(56,52,36,0.22)',
    'stroke-width': isSel ? '2.5' : '1.8'
  }));

  // Línea interior paralela (doble contorno estilo plano técnico)
  const inset=3;
  g.appendChild(svgEl('rect',{
    x:x+inset, y:y+inset, width:RW-inset*2, height:RH-inset*2, rx:Math.max(1,rx-2),
    fill:'none',
    stroke: hasData ? col.stroke : 'rgba(56,52,36,0.10)',
    'stroke-width':'0.6',
    opacity:'0.5'
  }));

  // Valor mm — centrado dentro
  if(hasData){
    const fs=isSingle?7.5:6.5;
    const t=svgEl('text',{
      x:cx, y:cy,
      'text-anchor':'middle', 'dominant-baseline':'middle',
      'font-size':fs, 'font-family':"'Inter',sans-serif",
      'font-weight':'700', fill:col.text
    });
    t.textContent=a.toFixed(1);
    g.appendChild(t);
  }

  // Indicador de selección — borde externo punteado
  if(isSel){
    g.appendChild(svgEl('rect',{
      x:x-4, y:y-4, width:RW+8, height:RH+8, rx:rx+3,
      fill:'none', stroke:col.stroke, 'stroke-width':'1.2',
      'stroke-dasharray':'3 2', opacity:'0.6'
    }));
  }

  // Label posición — encima o debajo del neumático
  const ly=isAbove ? y-7 : y+RH+11;
  const pl=svgEl('text',{
    x:cx, y:ly, 'text-anchor':'middle',
    'font-size':'7.5', 'font-family':"'Inter',sans-serif",
    'font-weight': isSel?'700':'400',
    fill: isSel ? col.stroke : 'rgba(56,52,36,0.38)',
    'letter-spacing':'0.04em'
  });
  pl.textContent=`P${pos}`;
  g.appendChild(pl);

  svg.appendChild(g);
}

// ── VEHÍCULO — plano técnico, vista superior ──
export function medDrawTruck(){
  const key=String(med.tipoRuedas);
  const svg=document.getElementById('med-truck-svg');
  svg.replaceChildren();
  const cfg=MED_CFG[key]; if(!cfg) return;

  // ── Dimensiones de neumáticos ──
  const TW_s=20, TH_s=54;   // simple: perfil delgado, ancho largo
  const TW_d=15, TH_d=38;   // dual: más compacto
  const GAP_D=5;             // espacio entre par de duales
  const BGAP=12;             // gap carrocería → neumático

  // ── Posición de ejes según tipo ──
  let axleXs, bodyX1, bodyX2;
  if(key==='10'){
    axleXs=[150, 440, 580]; bodyX1=64; bodyX2=730;
  } else {
    axleXs=[120, 310, 420, 530, 640]; bodyX1=50; bodyX2=780;
  }

  // Altura del canvas: rotado 90°, el lado que "sale" del bus es TW (el corto)
  const outerR_d = BGAP + TW_d + GAP_D + TW_d; // distancia máxima desde borde cuerpo (dual)
  const outerR_s = BGAP + TW_s;                 // distancia máxima (simple)
  const outerR   = Math.max(outerR_d, outerR_s);
  const labelExtra = 22;
  const bodyH = 86;
  const margin = 28;
  const H = bodyH + (outerR + labelExtra + margin) * 2;
  const W = key==='10' ? 860 : 900;
  const midY = H / 2;
  const bodyTop = midY - bodyH/2, bodyBot = midY + bodyH/2;
  const bodyW = bodyX2 - bodyX1;

  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('width','100%');
  svg.setAttribute('height',String(Math.round(H)));

  const INK  = 'rgba(50,49,25,';   // color base de tinta del plano
  const INK2 = BRAND.ink;

  // ── DEFS: patrón de líneas finas (fondo plano técnico) ──
  const defs=svgEl('defs',{});

  // Patrón de cuadrícula muy sutil
  const pat=svgEl('pattern',{id:'grid',width:'20',height:'20',patternUnits:'userSpaceOnUse'});
  pat.appendChild(svgEl('path',{d:'M 20 0 L 0 0 0 20',fill:'none',stroke:INK+'0.06)',
    'stroke-width':'0.5'}));
  defs.appendChild(pat);

  svg.appendChild(defs);

  // Fondo con grid técnico muy tenue
  svg.appendChild(svgEl('rect',{x:0,y:0,width:W,height:H,fill:'url(#grid)'}));

  // ── LÍNEAS DE EJE — atraviesan todo el canvas de arriba a abajo ──
  axleXs.forEach((ax,i)=>{
    // Línea de eje de punta a punta
    svg.appendChild(svgEl('line',{
      x1:ax, y1:margin/2, x2:ax, y2:H-margin/2,
      stroke:INK+'0.14)', 'stroke-width':'1',
      'stroke-dasharray':'8 5', 'stroke-linecap':'round'
    }));
    // Trazo sólido dentro del cuerpo
    svg.appendChild(svgEl('line',{
      x1:ax, y1:bodyTop, x2:ax, y2:bodyBot,
      stroke:INK+'0.28)', 'stroke-width':'1.2'
    }));
    // Pequeño círculo en la intersección eje / borde cuerpo (arriba y abajo)
    [bodyTop, bodyBot].forEach(ey=>{
      svg.appendChild(svgEl('circle',{cx:ax,cy:ey,r:'2.5',
        fill:'white',stroke:INK+'0.30)','stroke-width':'0.8'}));
    });
  });

  // Línea de simetría longitudinal
  svg.appendChild(svgEl('line',{
    x1:bodyX1-20, y1:midY, x2:bodyX2+20, y2:midY,
    stroke:INK+'0.10)', 'stroke-width':'0.8', 'stroke-dasharray':'10 6'
  }));

  // ── CARROCERÍA — cuerpo principal ──
  // Sombra muy sutil
  svg.appendChild(svgEl('rect',{
    x:bodyX1+2, y:bodyTop+2, width:bodyW, height:bodyH, rx:6,
    fill:'rgba(0,0,0,0.05)'
  }));

  // Relleno del cuerpo — color brand muy claro
  svg.appendChild(svgEl('rect',{
    x:bodyX1, y:bodyTop, width:bodyW, height:bodyH, rx:6,
    fill:'rgba(56,52,36,0.07)', stroke:INK2,
    'stroke-width':'1.5'
  }));

  // Línea de pared interior (doble contorno estilo arquitectónico)
  const wallInset=5;
  svg.appendChild(svgEl('rect',{
    x:bodyX1+wallInset, y:bodyTop+wallInset,
    width:bodyW-wallInset*2, height:bodyH-wallInset*2, rx:3,
    fill:'none', stroke:INK+'0.20)', 'stroke-width':'0.7'
  }));

  // ── FRENTE (izquierda) — parabrisa y detalles ──
  const cabW=90;
  // Zona de cabina con relleno más marcado
  svg.appendChild(svgEl('rect',{
    x:bodyX1, y:bodyTop, width:cabW, height:bodyH, rx:6,
    fill:'rgba(56,52,36,0.10)',
    stroke:'none'
  }));
  // Borde derecho de cabina
  svg.appendChild(svgEl('line',{
    x1:bodyX1+cabW, y1:bodyTop+wallInset+2,
    x2:bodyX1+cabW, y2:bodyBot-wallInset-2,
    stroke:INK+'0.25)', 'stroke-width':'0.8', 'stroke-dasharray':'4 3'
  }));
  // Parabrisa — arco esquemático
  svg.appendChild(svgEl('path',{
    d:`M ${bodyX1+6} ${bodyTop+14} Q ${bodyX1+3} ${midY} ${bodyX1+6} ${bodyBot-14}`,
    fill:'none', stroke:INK+'0.35)', 'stroke-width':'1.2'
  }));

  // ── LUCES delanteras ──
  [[bodyTop+10, 10],[bodyBot-20, 10]].forEach(([fy,fh])=>{
    svg.appendChild(svgEl('rect',{
      x:bodyX1-5, y:fy, width:5, height:fh, rx:2,
      fill:'rgba(56,52,36,0.55)', stroke:INK2, 'stroke-width':'0.6'
    }));
  });

  // ── LUCES traseras ──
  [[bodyTop+12, 14],[bodyBot-26, 14]].forEach(([ry,rh])=>{
    svg.appendChild(svgEl('rect',{
      x:bodyX2, y:ry, width:5, height:rh, rx:2,
      fill:'rgba(56,52,36,0.25)', stroke:INK2, 'stroke-width':'0.6'
    }));
  });

  // ── ETIQUETAS ──
  // "FRENTE"
  const labelF=svgEl('text',{
    x:bodyX1+cabW/2, y:bodyTop-12,
    'text-anchor':'middle', 'font-size':'7',
    'font-family':"'Inter',sans-serif", 'font-weight':'500',
    fill:INK+'0.35)', 'letter-spacing':'0.14em'
  });
  labelF.textContent='FRENTE';
  svg.appendChild(labelF);

  // Número de eje sobre cada línea de eje
  axleXs.forEach((ax,i)=>{
    const t=svgEl('text',{
      x:ax, y:bodyTop-12,
      'text-anchor':'middle', 'font-size':'7',
      'font-family':"'Inter',sans-serif", 'font-weight':'400',
      fill:INK+'0.28)', 'letter-spacing':'0.06em'
    });
    t.textContent=`EJE ${i+1}`;
    svg.appendChild(t);
  });

  // ── NEUMÁTICOS ──
  cfg.forEach((axle,ai)=>{
    const ax=axleXs[ai]; if(ax===undefined) return;
    if(axle.single){
      const L=axle.positions.find(p=>p.side==='L');
      const R=axle.positions.find(p=>p.side==='R');
      // Rotado 90°: el lado que separa del bus es TW_s (el corto)
      const cyL=bodyTop-BGAP-TW_s/2;
      const cyR=bodyBot+BGAP+TW_s/2;
      if(L) medDrawTire(svg,ax,cyL,L.pos,TW_s,TH_s,true,true);
      if(R) medDrawTire(svg,ax,cyR,R.pos,TW_s,TH_s,true,false);
    } else {
      const LL=axle.positions.find(p=>p.side==='LL');
      const LR=axle.positions.find(p=>p.side==='LR');
      const RL=axle.positions.find(p=>p.side==='RL');
      const RR=axle.positions.find(p=>p.side==='RR');
      // Rotado 90°: el lado que separa del bus es TW_d (el corto)
      const cyLI=bodyTop-BGAP-TW_d/2;
      const cyLO=cyLI-TW_d-GAP_D;
      const cyRI=bodyBot+BGAP+TW_d/2;
      const cyRO=cyRI+TW_d+GAP_D;
      if(LR) medDrawTire(svg,ax,cyLI,LR.pos,TW_d,TH_d,false,true);
      if(LL) medDrawTire(svg,ax,cyLO,LL.pos,TW_d,TH_d,false,true);
      if(RL) medDrawTire(svg,ax,cyRI,RL.pos,TW_d,TH_d,false,false);
      if(RR) medDrawTire(svg,ax,cyRO,RR.pos,TW_d,TH_d,false,false);
    }
  });
}

export function medUpdateCounters(){
  const cfg=MED_CFG[String(med.tipoRuedas)]; if(!cfg) return;
  const c=countByStatus(cfg.flatMap(a=>a.positions.map(p=>mLast(p))));
  const ok=c.ok,warn=c.bajo,crit=c.critico;
  document.getElementById('med-ok').textContent=ok;
  document.getElementById('med-warn').textContent=warn;
  document.getElementById('med-crit').textContent=crit;
}

const TIRE_COLORS={
  neutral:{stroke:'#48484a',fill:'rgba(72,72,74,0.08)',text:'#98989d',status:'neutral'},
  ok:{stroke:'#34c759',fill:'rgba(52,199,89,0.12)',text:'#1a7f37',status:'ok'},
  warn:{stroke:'#ff9500',fill:'rgba(255,149,0,0.12)',text:'#b25000',status:'warn'},
  crit:{stroke:'#ff3b30',fill:'rgba(255,59,48,0.12)',text:'#c0392b',status:'crit'}
};
export function mTireColor(pos){ return TIRE_COLORS[wearClass(mLast(pos))]; }
