import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, setStatus, userError } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado } from '../core/componentes.js';
import { fmtNum, fmtFechaHora } from '../domain/formato.js';
import { isClienteMode, currentClienteId, currentClienteNombre, onLogout } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { contextoListo, hayFiltroSeccional, filtrarConsulta } from '../core/seccional.js';
import { ESTADOS, infoEstado, filtrarSalud, contarPorEstado, textoDias } from '../domain/salud.js';

// Salud de dispositivos: lee la vista v_salud_dispositivos (estado/días sin actividad los calcula la BD).
let filas=[], clientes=new Map(), fEstado='', fCliente='';

const SIMBOLO={activo:'✓',sin_actividad:'▲',caido:'✕',nunca:'–'};

export async function loadSalud(){
  setStatus(true,'Cargando...');
  await contextoListo();
  setHtml(document.getElementById('tbody-salud'), filaEstado(7, estadoCarga('Cargando salud de dispositivos…')));
  const [{data,error},cl]=await Promise.all([
    db.from('v_salud_dispositivos')
      .select('dispositivo_id,cliente_id,mac_address,nombre,activo,ultima_actividad_at,total_mediciones,dias_sin_actividad,estado')
      .order('dias_sin_actividad',{ascending:false,nullsFirst:false}),
    isClienteMode()?Promise.resolve({data:[{id:currentClienteId,nombre:currentClienteNombre}]})
      :db.from('clientes').select('id,nombre').is('deleted_at',null).order('nombre')
  ]);
  if(error){ setStatus(false,'Error de conexión'); showToast(userError(error),true); setHtml(document.getElementById('tbody-salud'), filaEstado(7, estadoError('', 'loadSalud'))); return; }
  filas=data||[];
  if(hayFiltroSeccional()){ // la vista no trae la seccional: se cruza con los dispositivos de la seccional elegida
    const {data:ds,error:e2}=await filtrarConsulta(db.from('dispositivos').select('id').eq('cliente_id',currentClienteId));
    if(e2){ setStatus(false,'Error de conexión'); showToast(userError(e2),true); return; }
    const ok=new Set((ds||[]).map(d=>String(d.id)));
    filas=filas.filter(f=>ok.has(String(f.dispositivo_id)));
  }
  clientes=new Map((cl.data||[]).map(c=>[String(c.id),c.nombre]));
  setStatus(true,'Conectado');
  renderFiltros();
  renderSalud();
}

function renderFiltros(){
  const sel=document.getElementById('salud-cliente');
  const ids=[...new Set(filas.map(f=>String(f.cliente_id)))];
  setHtml(sel, joinHtml([html`<option value="">Todos los clientes</option>`, ids.map(id=>html`<option value="${id}">${clientes.get(id)||('Cliente #'+id)}</option>`)]));
  if(fCliente&&!ids.includes(fCliente)) fCliente='';
  sel.value=fCliente;
  document.getElementById('salud-estado').value=fEstado;
  sel.style.display=isClienteMode()?'none':'';
}

function renderResumen(){
  const c=contarPorEstado(filas,fCliente);
  setHtml(document.getElementById('salud-chips'), joinHtml([
    html`<button class="salud-chip ${fEstado===''?'active':''}" data-action="saludFiltrarEstado" data-args='[""]'><span class="salud-chip-n">${c.total}</span> Todos</button>`,
    ESTADOS.map(e=>{
      const i=infoEstado(e);
      return html`<button class="salud-chip ${i.cls} ${fEstado===e?'active':''}" data-action="saludFiltrarEstado" data-args='["${e}"]'><span class="salud-chip-n">${c[e]}</span> ${i.lbl}</button>`;
    })
  ]));
}

function renderSalud(){
  renderResumen();
  const q=document.getElementById('salud-search').value;
  const lista=filtrarSalud(filas,{estado:fEstado,clienteId:fCliente,query:q});
  const tbody=document.getElementById('tbody-salud');
  document.getElementById('salud-count').textContent=`${lista.length} de ${filas.length}`;
  if(!lista.length){
    setHtml(tbody, filaEstado(7, filas.length
      ? estadoVacio('Ningún dispositivo coincide', 'Probá con otro filtro o quitá la búsqueda.')
      : estadoVacio('Todavía no hay dispositivos registrados', 'Registrá un dispositivo medidor y asignalo a un cliente para ver su actividad.', isClienteMode() ? null : { label: 'Ir a Dispositivos', action: 'irA', args: ['dispositivos'], primaria: true })));
    return;
  }
  setHtml(tbody, joinHtml(lista.map(r=>{
    const i=infoEstado(r.estado);
    return html`<tr data-estado="${r.estado}">
      <td>${chip(i.cls, i.lbl, SIMBOLO[r.estado]||'●')}</td>
      <td><span class="mono-cell salud-mac">${r.mac_address}</span></td>
      <td>${r.nombre?r.nombre:html`<span class="salud-muted">—</span>`}</td>
      <td>${clientes.get(String(r.cliente_id))||('#'+r.cliente_id)}</td>
      <td class="mono-cell salud-fecha">${fmtFechaHora(r.ultima_actividad_at)}</td>
      <td class="salud-num">${textoDias(r)}</td>
      <td class="salud-num">${fmtNum(r.total_mediciones||0)}${r.activo===false?html` <span class="badge gray">Desactivado</span>`:''}</td>
    </tr>`;
  })));
}

ACTIONS.saludFiltrarEstado=e=>{ fEstado=e||''; document.getElementById('salud-estado').value=fEstado; renderSalud(); };
ACTIONS.saludEstadoChange=v=>{ fEstado=v||''; renderSalud(); };
ACTIONS.saludClienteChange=v=>{ fCliente=v||''; renderSalud(); };
ACTIONS.loadSalud=loadSalud;
export const load=loadSalud;
registerView('salud','Salud de dispositivos',loadSalud);
onLogout(()=>{ filas=[]; clientes=new Map(); fEstado=''; fCliente=''; });

export function init(){
  document.getElementById('salud-search').addEventListener('input',renderSalud);
}
