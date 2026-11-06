// Mediciones: exportación CSV y reporte imprimible (PDF vía ventana de impresión).
import { db } from '../core/supabase.js';
import { html, setHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { WEAR, wearStatus } from '../domain/desgaste.js';
import { med } from './mediciones-state.js';

export async function exportMedicionesCSV(){
  const vid=parseInt(document.getElementById('med-vehiculo-select').value);
  if(!vid) return;
  const veh=med.vehs.find(v=>v.id===vid);
  const btn=document.getElementById('med-export-btn');
  btn.disabled=true; btn.textContent='Exportando...';

  const {data,error}=await db.from('mediciones')
    .select('posicion,mm1,mm2,mm3,promedio,created_at')
    .eq('vehiculo_id',vid)
    .order('created_at',{ascending:false});

  btn.disabled=false;
  setHtml(btn, html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar CSV`);

  if(error){ showToast(userError(error),true); return; }
  if(!data||!data.length){ showToast('No hay mediciones para exportar',true); return; }

  const vehNombre=veh?veh.nombre:'vehiculo';
  const rows=[['Fecha','Posición','Exterior (mm)','Medio (mm)','Interior (mm)','Promedio (mm)']];
  data.forEach(r=>{
    const fecha=new Date(r.created_at).toLocaleString('es-UY',{timeZone:'America/Montevideo',hour12:false});
    rows.push([fecha,r.posicion,r.mm1??'',r.mm2??'',r.mm3??'',r.promedio!=null?parseFloat(r.promedio).toFixed(1):'']);
  });

  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`neumet_${vehNombre.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export async function generarReportePDF(){
  const vid=parseInt(document.getElementById('med-vehiculo-select').value);
  if(!vid){ showToast('Seleccioná un vehículo primero',true); return; }
  const btn=document.getElementById('med-report-btn');
  btn.disabled=true; btn.textContent='Generando...';

  try{
    const veh=med.vehs.find(v=>v.id===vid);

    // Traer neumáticos asignados y últimas 10 mediciones por posición
    const [{data:neums},{data:meds}]=await Promise.all([
      db.from('neumaticos').select('posicion,marca,modelo,fecha_compra,precio_unidad,notas').eq('vehiculo_id',vid),
      db.from('mediciones').select('posicion,mm1,mm2,mm3,promedio,created_at').eq('vehiculo_id',vid).order('created_at',{ascending:false}).limit(500)
    ]);

    // Agrupar mediciones por posición, máximo 8 últimas por posición
    const medPorPos={};
    (meds||[]).forEach(m=>{
      if(!medPorPos[m.posicion]) medPorPos[m.posicion]=[];
      if(medPorPos[m.posicion].length<8) medPorPos[m.posicion].push(m);
    });

    // Determinar posiciones del camión
    const tipo=veh?.tipo_ruedas||6;
    const posiciones=Array.from({length:tipo},(_,i)=>i+1);

    const neumMap={};
    (neums||[]).forEach(n=>{ neumMap[n.posicion]=n; });

    const fmtDate=s=>s?new Date(s).toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';
    const fmtMM=v=>v!=null?parseFloat(v).toFixed(1)+'mm':'—';
    const fmtAvg=arr=>{
      const vals=arr.map(x=>x.promedio!=null?parseFloat(x.promedio):null).filter(v=>v!=null);
      return vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1)+'mm':'—';
    };
    const statusColor=mm=>{
      if(mm==null) return '#8e8e93';
      const st=wearStatus(mm);
      return st==='critico'?'#c0392b':st==='bajo'?'#b25000':'#1a7f37';
    };
    const statusLabel=mm=>{
      if(mm==null) return 'Sin datos';
      const st=wearStatus(mm);
      return st==='critico'?'CRÍTICO':st==='bajo'?'BAJO':'OK';
    };

    // Construir filas de la tabla de neumáticos
    const filasNeums=posiciones.map(pos=>{
      const n=neumMap[pos];
      const historial=medPorPos[pos]||[];
      const ultima=historial[0];
      const avgMM=ultima?.promedio!=null?parseFloat(ultima.promedio):null;
      const color=statusColor(avgMM);
      const label=statusLabel(avgMM);

      // Mini sparkline SVG con las últimas mediciones (promedio)
      const sparkVals=historial.slice().reverse().map(m=>m.promedio!=null?parseFloat(m.promedio):null).filter(v=>v!=null);
      let sparkSVG='';
      if(sparkVals.length>=2){
        const W=120,H=32,PAD=4;
        const min=Math.min(...sparkVals,0), max=Math.max(...sparkVals,12);
        const scaleX=(W-PAD*2)/(sparkVals.length-1);
        const scaleY=(H-PAD*2)/(max-min||1);
        const pts=sparkVals.map((v,i)=>`${PAD+i*scaleX},${H-PAD-(v-min)*scaleY}`).join(' ');
        const lastY=H-PAD-(sparkVals[sparkVals.length-1]-min)*scaleY;
        const lastX=PAD+(sparkVals.length-1)*scaleX;
        sparkSVG=html`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
          <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}"/>
          <line x1="0" y1="${H-PAD-(WEAR.LOW_MM-min)*scaleY}" x2="${W}" y2="${H-PAD-(WEAR.LOW_MM-min)*scaleY}" stroke="#c0392b" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.5"/>
        </svg>`;
      } else if(sparkVals.length===1){
        sparkSVG=html`<span style="font-size:11px;color:#8e8e93">1 medición</span>`;
      } else {
        sparkSVG=html`<span style="font-size:11px;color:#8e8e93">Sin historial</span>`;
      }

      // Variación primera vs última
      let variacion='';
      if(sparkVals.length>=2){
        const diff=sparkVals[sparkVals.length-1]-sparkVals[0];
        const diffStr=diff.toFixed(1);
        variacion=diff<0
          ?html`<span style="color:#c0392b">▼ ${Math.abs(diff).toFixed(1)}mm</span>`
          :html`<span style="color:#1a7f37">▲ ${diffStr}mm</span>`;
      }

      return html`<tr>
        <td style="font-weight:600;color:var(--text-primary)">Pos. ${pos}</td>
        <td>${(n?.marca||'—')}</td>
        <td>${(n?.modelo||'—')}</td>
        <td>${n?.fecha_compra?fmtDate(n.fecha_compra):'—'}</td>
        <td style="text-align:center">
          <span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;background:${color}18;color:${color};border:1px solid ${color}40">
            ${label}
          </span><br>
          <span style="font-size:13px;font-weight:600;color:${color}">${fmtMM(avgMM)}</span>
        </td>
        <td style="text-align:center">${fmtDate(ultima?.created_at||null)}</td>
        <td style="text-align:center">${sparkSVG}</td>
        <td style="text-align:center">${variacion||'—'}</td>
      </tr>`;
    });

    // Resumen global
    const allLastMM=posiciones.map(pos=>{
      const m=medPorPos[pos]?.[0];
      return m?.promedio!=null?parseFloat(m.promedio):null;
    }).filter(v=>v!=null);
    const criticos=allLastMM.filter(v=>wearStatus(v)==='critico').length;
    const bajos=allLastMM.filter(v=>wearStatus(v)==='bajo').length;
    const ok=allLastMM.filter(v=>wearStatus(v)==='ok').length;

    const doc=html`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Reporte NEUMET · ${(veh?.nombre||'')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#383424;padding:40px;font-size:14px}
  @media print{body{padding:20px}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:24px;border-bottom:2px solid #383424;margin-bottom:28px}
  .brand{font-size:22px;font-weight:800;color:#383424;letter-spacing:-0.5px}
  .brand span{color:#615A3F}
  .report-meta{text-align:right;font-size:12px;color:#615A3F;line-height:1.8}
  .report-meta strong{color:#383424}
  .veh-title{font-size:20px;font-weight:700;color:#383424;margin-bottom:4px}
  .veh-sub{font-size:13px;color:#615A3F}
  .kpis{display:flex;gap:16px;margin:24px 0}
  .kpi{flex:1;border:1px solid #e5e5ea;border-radius:10px;padding:14px 18px;text-align:center}
  .kpi-n{font-size:28px;font-weight:800;letter-spacing:-1px}
  .kpi-l{font-size:11px;color:#615A3F;margin-top:2px;font-weight:500}
  .kpi.ok .kpi-n{color:#1a7f37}
  .kpi.warn .kpi-n{color:#b25000}
  .kpi.crit .kpi-n{color:#c0392b}
  .kpi.total .kpi-n{color:#383424}
  h3{font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#615A3F;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead tr{background:#EBEBEB}
  th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#615A3F;border-bottom:1px solid #e5e5ea}
  td{padding:11px 12px;border-bottom:1px solid #f2f2f2;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e5ea;font-size:11px;color:#615A3F;display:flex;justify-content:space-between}
  @media print{
    .no-print{display:none}
    table{page-break-inside:avoid}
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="brand">NEU<span>MET</span></div>
    <div style="font-size:12px;color:#615A3F;margin-top:4px">Reporte de estado de neumáticos</div>
  </div>
  <div class="report-meta">
    <div><strong>Vehículo:</strong> ${(veh?.nombre||'—')}</div>
    <div><strong>Patente:</strong> ${(veh?.patente||'—')}</div>
    <div><strong>Fecha:</strong> ${fmtDate(new Date().toISOString())}</div>
  </div>
</div>

<div class="kpis">
  <div class="kpi total"><div class="kpi-n">${posiciones.length}</div><div class="kpi-l">Posiciones totales</div></div>
  <div class="kpi ok"><div class="kpi-n">${ok}</div><div class="kpi-l">En buen estado (≥8mm)</div></div>
  <div class="kpi warn"><div class="kpi-n">${bajos}</div><div class="kpi-l">Nivel bajo (5–7.9mm)</div></div>
  <div class="kpi crit"><div class="kpi-n">${criticos}</div><div class="kpi-l">Crítico (&lt;5mm)</div></div>
</div>

<h3>Detalle por posición</h3>
<table>
  <thead>
    <tr>
      <th>Posición</th>
      <th>Marca</th>
      <th>Modelo</th>
      <th>Fecha compra</th>
      <th style="text-align:center">Estado actual</th>
      <th style="text-align:center">Última medición</th>
      <th style="text-align:center">Evolución</th>
      <th style="text-align:center">Variación</th>
    </tr>
  </thead>
  <tbody>${filasNeums}</tbody>
</table>

<div class="footer">
  <span>NEUMET · Sistema de gestión de neumáticos</span>
  <span>Generado el ${fmtDate(new Date().toISOString())}</span>
</div>

</body>
</html>`;

    const w=window.open('','_blank');
    if(!w){ showToast('El navegador bloqueó la ventana del reporte. Permití las ventanas emergentes.',true); return; }
    // Documento generado con el helper html`` (todo dato interpolado queda escapado); about:blank del reporte no tiene otro sumidero.
    // eslint-disable-next-line no-unsanitized/method -- recibe SafeHtml (doc), no un string plano
    w.document.write(doc.toString());
    w.document.close();
    w.focus();
    setTimeout(()=>w.print(),300); // sin <script> inline (CSP sin 'unsafe-inline')

  } catch(e){
    showToast(userError(e),true);
  } finally{
    btn.disabled=false;
    setHtml(btn, html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Reporte PDF`);
  }
}

ACTIONS.exportMedicionesCSV=exportMedicionesCSV;
ACTIONS.generarReportePDF=generarReportePDF;
