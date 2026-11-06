import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { relDate } from '../core/ui.js';
import { isClienteMode, currentClienteId, currentClienteNombre, onLogin } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { tireStatus } from '../domain/desgaste.js';

// ── DASHBOARD CLIENTE ────────────────────────────────────────
export async function loadDashboard(){
  if(!isClienteMode()) return;

  const today=new Date().toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dash-title').textContent=`Hola, ${currentClienteNombre}`;
  document.getElementById('dash-subtitle').textContent=`Tu resumen al ${today}`;

  // Queries en paralelo
  const [
    {count:vehCount},
    {count:dispCount},
    {count:medCount},
    {data:vehicles},
    {data:allMed}
  ] = await Promise.all([
    db.from('vehiculos').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId).eq('activo',true),
    db.from('dispositivos').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId),
    db.from('mediciones').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId),
    db.from('vehiculos').select('id,nombre,patente,tipo_ruedas').eq('cliente_id',currentClienteId).eq('activo',true).order('nombre'),
    db.from('mediciones').select('vehiculo_id,posicion,mm1,mm2,mm3,created_at,vehiculos(nombre)')
      .eq('cliente_id',currentClienteId).order('created_at',{ascending:false}).limit(600)
  ]);

  document.getElementById('dash-stat-vehs').textContent = vehCount??0;
  document.getElementById('dash-stat-disps').textContent = dispCount??0;
  document.getElementById('dash-stat-meds').textContent = (medCount??0).toLocaleString('es-AR');

  // Último dato por vehículo+posición
  const latestMap={};
  (allMed||[]).forEach(m=>{
    const k=`${m.vehiculo_id}_${m.posicion}`;
    if(!latestMap[k]) latestMap[k]=m;
  });
  const latestList=Object.values(latestMap);

  const criticos=latestList.filter(m=>tireStatus(m)==='critico');
  document.getElementById('dash-stat-criticos').textContent=criticos.length;
  document.getElementById('dash-kpi-criticos').classList.toggle('alert',criticos.length>0);

  // ── Flota ──
  const fleetGrid=document.getElementById('dash-fleet-grid');
  const vehs=vehicles||[];
  if(!vehs.length){
    setHtml(fleetGrid, html`<div class="dash-empty" style="grid-column:1/-1">No hay vehículos activos.</div>`);
  } else {
    setHtml(fleetGrid, joinHtml(vehs.map(v=>{
      const tiresV=latestList.filter(m=>m.vehiculo_id===v.id);
      const total=v.tipo_ruedas||10;
      const ok=tiresV.filter(m=>tireStatus(m)==='ok').length;
      const bajo=tiresV.filter(m=>tireStatus(m)==='bajo').length;
      const crit=tiresV.filter(m=>tireStatus(m)==='critico').length;
      const sinD=total-tiresV.length;
      const pctOk=Math.round(ok/total*100);
      const pctBajo=Math.round(bajo/total*100);
      const pctCrit=Math.round(crit/total*100);
      return html`<div class="dash-fleet-card">
        <div class="dash-fleet-name">${v.nombre}${v.patente?html`<span class="dash-fleet-pat">${v.patente}</span>`:''}</div>
        <div class="dash-fleet-bar">
          <div style="width:${pctOk}%;background:#34c759"></div>
          <div style="width:${pctBajo}%;background:#ff9500"></div>
          <div style="width:${pctCrit}%;background:#ff3b30"></div>
          <div style="flex:1;background:rgba(0,0,0,0.07)"></div>
        </div>
        <div class="dash-fleet-stats">
          ${ok?html`<span style="color:#1a7f37">✓ ${ok} OK</span>`:''}
          ${bajo?html`<span style="color:#b25000">⚠ ${bajo} bajo</span>`:''}
          ${crit?html`<span style="color:#c0392b">✕ ${crit} crítico</span>`:''}
          ${sinD>0?html`<span style="color:var(--text-tertiary)">${sinD} sin datos</span>`:''}
        </div>
      </div>`;
    })));
  }

  // ── Tabla recientes ──
  const recentBody=document.getElementById('dash-recent-body');
  const recent=(allMed||[]).slice(0,20);
  if(!recent.length){
    setHtml(recentBody, html`<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-tertiary)">No hay mediciones aún.</td></tr>`);
    return;
  }
  const sLabel={ok:html`<span class="ds-badge ok">OK</span>`,bajo:html`<span class="ds-badge warn">Bajo</span>`,critico:html`<span class="ds-badge crit">Crítico</span>`};
  setHtml(recentBody, joinHtml(recent.map(m=>{
    const s=tireStatus(m);
    const fmt=v=>v!=null?html`<b>${parseFloat(v).toFixed(1)}</b>`:'—';
    return html`<tr>
      <td>${(m.vehiculos?.nombre||'—')}</td>
      <td><span class="tire-pos-badge" style="font-size:11px;padding:2px 7px">P${m.posicion}</span></td>
      <td>${fmt(m.mm1)}</td>
      <td>${fmt(m.mm2)}</td>
      <td>${fmt(m.mm3)}</td>
      <td>${s?sLabel[s]:'—'}</td>
      <td style="color:var(--text-secondary);font-size:12px">${relDate(m.created_at)}</td>
    </tr>`;
  })));
}

export const load=loadDashboard;
registerView('dashboard','Mi Panel',loadDashboard);
ACTIONS.loadDashboard=loadDashboard;
onLogin(({cliente})=>{ if(cliente) switchView('dashboard'); });
export function init(){}
