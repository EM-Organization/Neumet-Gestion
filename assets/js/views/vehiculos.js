import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError, avatarFor } from '../core/ui.js';
import { chipEstado, estadoVacio, estadoError } from '../core/componentes.js';
import { isClienteMode, currentClienteId } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { contextoListo, filtrarConsulta, filtrarFilas } from '../core/seccional.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { agruparVehiculos } from '../domain/flota.js';
import { buscarVehiculos, coincidenciaExacta } from '../domain/vehiculo-busqueda.js';
import { plural } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';
import { abrirDetalle } from './vehiculo-detalle.js';

let vehiculos=[], resumenes=new Map();
// Solo lectura para el equipo Neumet (docs/17 PR 9): crear, editar y eliminar vehículos lo hace el administrador de la empresa en Sucursales.

// La lista de vehículos se muestra en cuanto llega; el estado de los neumáticos (consulta pesada) se agrega después.
// Así la búsqueda por matrícula o número no espera ni depende de esa consulta.
let cargaId=0;
export async function loadVehiculos(){
  const mi=++cargaId;
  setStatus(true);
  await contextoListo();
  const {rows,error}=await fetchAll((from,to)=>{
    let q=filtrarConsulta(db.from('vehiculos')
      .select('id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,sucursal_id,fecha_compra,ultimo_servicio,notas,clientes(nombre)')
      .order('nombre').order('id').range(from,to));
    if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
    return q;
  },{pageSize:PAGE_SIZE,max:50000});
  if(mi!==cargaId) return;
  if(error){ setStatus(false); showToast(userError(error),true); setHtml(document.getElementById('veh-lista'), estadoError('','loadVehiculos')); return; }
  vehiculos=rows;
  resumenes=new Map();
  setStatus(true);
  const filterSel=document.getElementById('filter-cliente-veh');
  const clientSet=new Map();
  vehiculos.forEach(v=>{ if(v.clientes) clientSet.set(v.cliente_id, v.clientes.nombre); });
  setHtml(filterSel, joinHtml([html`<option value="">Todos los clientes</option>`, [...clientSet.entries()].map(([id,n])=>html`<option value="${id}">${n}</option>`)]));
  renderVehiculos();
  if(isClienteMode()){
    const est=await fetchAll((from,to)=>db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from,to),{pageSize:PAGE_SIZE,max:20000});
    if(mi!==cargaId||est.error) return; // sin estado se sigue mostrando la lista, sin chips
    resumenes=new Map(agruparVehiculos(filtrarFilas(est.rows)).map(g=>[g.vehiculo_id,g]));
    renderVehiculos();
  }
}

function resumenTexto(g){
  if(!g) return '';
  const p=[]; if(g.n_critico) p.push(plural(g.n_critico,'crítico','críticos')); if(g.n_bajo) p.push(plural(g.n_bajo,'bajo','bajos'));
  return p.join(' · ');
}

// Cliente: lista compacta de resultados (solo lectura) con chip de estado; click abre el detalle.
function renderLista(){
  const lista=document.getElementById('veh-lista');
  const q=document.getElementById('search-vehiculos').value;
  const activos=vehiculos.filter(v=>v.activo!==false);
  let res=buscarVehiculos(activos,q);
  // Sin búsqueda: los más urgentes primero.
  if(!q.trim()) res=res.sort((a,b)=>{ const ga=resumenes.get(a.id), gb=resumenes.get(b.id); return (ga?activosOrden(ga):9)-(gb?activosOrden(gb):9) || String(a.nombre).localeCompare(String(b.nombre),'es'); });
  document.getElementById('veh-contador').textContent=activos.length?(q.trim()?`${plural(res.length,'coincidencia','coincidencias')} de ${activos.length}`:plural(activos.length,'vehículo','vehículos')):'';
  if(!res.length){
    setHtml(lista, html`<li>${activos.length
      ?estadoVacio('Ningún vehículo coincide','Revisar la matrícula o el número de coche.')
      :estadoVacio('Sin vehículos registrados')}</li>`);
    return;
  }
  setHtml(lista, joinHtml(res.map(v=>{
    const g=resumenes.get(v.id), txt=resumenTexto(g);
    return html`<li><button type="button" class="veh-fila" data-action="verVehiculoDetalle" data-args="${JSON.stringify([v.id])}">
      <span class="veh-fila-main"><span class="veh-fila-nombre">${etiquetaCoche(v.nombre)}</span>
        <span class="veh-fila-meta">${v.patente||'Sin matrícula'}</span></span>
      <span class="veh-fila-estado">${txt}${chipEstado(g?g.semaforo:'sin_datos')}</span></button></li>`;
  })));
}
const activosOrden=g=>({critico:0,bajo:1,sin_datos:2,ok:3}[g.semaforo]??2);

function renderVehiculos(){
  const cli=isClienteMode();
  document.getElementById('filter-cliente-veh').style.display=cli?'none':'';
  if(cli){ renderLista(); return; }
  const q=document.getElementById('search-vehiculos').value;
  const cid=document.getElementById('filter-cliente-veh').value;
  const tbody=document.getElementById('tbody-vehiculos');
  let filtered=buscarVehiculos(vehiculos,q).filter(v=>!cid||String(v.cliente_id)===cid);
  if(!filtered.length){
    setHtml(tbody, html`<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">Cambiar la búsqueda o el filtro</div></div></td></tr>`);
    return;
  }
  setHtml(tbody, joinHtml(filtered.map(v=>{
    const av=avatarFor(v.id);
    const clientNom=v.clientes?v.clientes.nombre:'—';
    const estadoBadge=v.activo
      ?html`<span class="badge green">● Activo</span>`
      :html`<span class="badge" style="background:rgba(0,0,0,0.06);color:var(--text-tertiary)">● Inactivo</span>`;
    return html`<tr>
      <td class="id-cell">#${v.id}</td>
      <td><div class="name-cell"><div class="name-av ${av}">${v.nombre[0].toUpperCase()}</div>${etiquetaCoche(v.nombre)}</div></td>
      <td class="mono-cell">${v.patente?v.patente:'—'}</td>
      <td>${clientNom}</td>
      <td><span class="badge blue">${v.tipo_ruedas} WHL</span></td>
      <td>${estadoBadge}</td>
      <td><div class="actions">
        <button class="icon-btn" data-va="detalle" data-vid="${v.id}" title="Ver detalle del vehículo" aria-label="Ver detalle de ${etiquetaCoche(v.nombre)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="icon-btn" data-va="ciclo" data-vid="${v.id}" title="Odómetro y ciclo de vida" aria-label="Odómetro y ciclo de vida de ${etiquetaCoche(v.nombre)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
        </button>
      </div></td>
    </tr>`;
  })));
  tbody.querySelectorAll('button[data-va]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.vid);
      if(btn.dataset.va==='detalle') abrirDetalle(id);
      else if(btn.dataset.va==='ciclo') ACTIONS.openCicloVida(id);
    });
  });
}

ACTIONS.loadVehiculos=loadVehiculos;
export const load=loadVehiculos;
registerView('vehiculos','Vehículos',loadVehiculos);

// Lista de vehículos (la usa el modal de ciclo de vida)
export function getVehiculos(){ return vehiculos; }

export function init(){
  const inp=document.getElementById('search-vehiculos');
  inp.addEventListener('input',renderVehiculos);
  // Enter: abre directo si hay una sola coincidencia exacta (o una sola coincidencia a secas).
  inp.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const base=isClienteMode()?vehiculos.filter(v=>v.activo!==false):vehiculos;
    const v=coincidenciaExacta(base,inp.value)||(inp.value.trim()&&buscarVehiculos(base,inp.value).length===1?buscarVehiculos(base,inp.value)[0]:null);
    if(v){ e.preventDefault(); abrirDetalle(v.id); }
  });
  document.getElementById('filter-cliente-veh').addEventListener('change',renderVehiculos);
}
