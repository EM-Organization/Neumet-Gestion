// Calidad de las mediciones: lista «Mediciones a revisar» (Inicio › Mediciones a revisar) y acciones Invalidar / Marcar como válida.
// El sistema solo marca mediciones como sospechosas (trigger de la base, nunca rechaza ni borra); una persona decide.
// Las invalidadas no cuentan en estados, tasas ni alertas, pero se conservan y se muestran atenuadas y tachadas.
// Toda la escritura pasa por las RPC medicion_invalidar y medicion_revalidar (autorización en la base: otro cliente u
// otra sucursal reciben «permiso denegado»). `listaCalidad` la reutiliza el detalle del vehículo.
// Acciones: calidad-invalidar (id), calidad-revalidar (id), calidad-confirmar, calidad-cerrar, calidad-filtro.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml, safeCls } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import { registerView, reloadActiveView } from '../core/nav.js';
import { registerActions } from '../core/actions.js';
import { contextoListo, filtrarFilas } from '../core/seccional.js';
import { fmtFechaHora, plural } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion } from '../domain/posicion.js';
import {
  MAX_LISTA, etiquetaCalidad, simboloCalidad, soloObservadas, contarObservadas, valoresTexto, validarMotivo,
  traducirErrorCalidad,
} from '../domain/calidad.js';

const $ = id => document.getElementById(id);
export const SEL_CALIDAD = 'id,vehiculo_id,posicion,idneumatico,mm1,mm2,mm3,promedio,created_at,calidad,calidad_motivo,calidad_at,vehiculos(nombre,patente,tipo_ruedas)';
const CLS = { sospechosa: 'orange', invalidada: 'gray' };

let filas = [];       // observadas del alcance del usuario (sospechosas e invalidadas)
let filtro = 'sospechosa';
let pendiente = null; // id de la medición que se está invalidando
let ocupado = false;

// Lista de mediciones con observaciones. `conVehiculo`: encabezar cada fila con el coche (lista general).
// Las invalidadas van atenuadas y con los valores tachados; el estado se dice también con texto y símbolo.
export function listaCalidad(rows, { conVehiculo = false, tipos = null } = {}) {
  return html`<ul class="cal-lista">${joinHtml(soloObservadas(rows).map(r => {
    const veh = r.vehiculos || {};
    const donde = [conVehiculo ? etiquetaCoche(veh.nombre || '') : '', nombrePosicion(r.posicion, (tipos && tipos.get(r.vehiculo_id)) || veh.tipo_ruedas)]
      .filter(Boolean).join(' · ');
    const inval = r.calidad === 'invalidada';
    return html`<li class="cal-fila cal-${safeCls(r.calidad)}">
      <div class="cal-cab"><span class="cal-donde">${donde}</span>${chip(CLS[r.calidad] || 'gray', etiquetaCalidad(r.calidad), simboloCalidad(r.calidad))}</div>
      <div class="cal-valores${inval ? ' tachado' : ''}">${valoresTexto(r)}<span class="cal-fecha"> · ${fmtFechaHora(r.created_at)}</span></div>
      ${r.calidad_motivo ? html`<div class="cal-motivo">${inval ? 'Motivo: ' : ''}${r.calidad_motivo}</div>` : ''}
      <div class="cal-acciones">
        ${inval ? '' : html`<button type="button" class="btn" data-action="calidad-invalidar" data-args="${JSON.stringify([r.id])}">Invalidar</button>`}
        <button type="button" class="btn ghost" data-action="calidad-revalidar" data-args="${JSON.stringify([r.id])}">Marcar como válida</button>
      </div></li>`;
  }))}</ul>`;
}

// ── Lista general ────────────────────────────────────────────────────────────────────────────────────────────────
function pintar() {
  const c = contarObservadas(filas);
  const sel = $('cal-filtro');
  if (sel) {
    setHtml(sel, html`<option value="sospechosa">${`En revisión (${c.sospechosas})`}</option><option value="invalidada">${`Invalidadas (${c.invalidadas})`}</option>`);
    sel.value = filtro;
  }
  const lista = filas.filter(r => r.calidad === filtro);
  const vacio = filtro === 'sospechosa' ? 'Sin mediciones por revisar' : 'Sin mediciones invalidadas';
  const tope = lista.length > MAX_LISTA ? html`<p class="inicio-meta">Se muestran las ${MAX_LISTA} más recientes de ${plural(lista.length, 'medición', 'mediciones')}.</p>` : '';
  setHtml($('cal-contenido'), lista.length ? html`${listaCalidad(lista.slice(0, MAX_LISTA), { conVehiculo: true })}${tope}` : estadoVacio(vacio));
}

export async function load() {
  const cont = $('cal-contenido');
  await contextoListo();
  setHtml(cont, estadoCarga('Cargando…'));
  const { data, error } = await db.from('mediciones').select(SEL_CALIDAD).in('calidad', ['sospechosa', 'invalidada'])
    .order('created_at', { ascending: false }).limit(1000);
  if (error) { showToast(userError(error), true); setHtml(cont, estadoError('', 'calidad-recargar')); return; }
  filas = soloObservadas(filtrarFilas(data || []));
  pintar();
}

// ── Invalidar con motivo ─────────────────────────────────────────────────────────────────────────────────────────
function cerrar() { $('modal-calidad').classList.remove('show'); pendiente = null; }

function abrirInvalidar(id) {
  const r = filas.find(x => String(x.id) === String(id)) || null;
  pendiente = Number(id);
  $('cal-sub').textContent = r ? [etiquetaCoche((r.vehiculos || {}).nombre || ''), valoresTexto(r)].filter(Boolean).join(' · ') : '';
  $('cal-motivo').value = '';
  $('cal-error').textContent = '';
  $('cal-confirmar').disabled = false;
  $('modal-calidad').classList.add('show');
}

async function confirmarInvalidar() {
  if (pendiente === null || ocupado) return;
  const v = validarMotivo($('cal-motivo').value);
  if (!v.ok) { $('cal-error').textContent = v.error; return; }
  ocupado = true; $('cal-confirmar').disabled = true;
  try {
    const { error } = await db.rpc('medicion_invalidar', { p_medicion_id: pendiente, p_motivo: v.motivo });
    if (error) throw error;
    cerrar();
    showToast('Medición invalidada');
    reloadActiveView();
  } catch (e) {
    console.error(e);
    const msg = traducirErrorCalidad(e);
    $('cal-error').textContent = msg;
    showToast(msg, true);
    if ($('cal-confirmar')) $('cal-confirmar').disabled = false;
  } finally { ocupado = false; }
}

async function revalidar(id) {
  if (ocupado) return;
  ocupado = true;
  try {
    const { error } = await db.rpc('medicion_revalidar', { p_medicion_id: Number(id) });
    if (error) throw error;
    showToast('Medición marcada como válida');
    reloadActiveView();
  } catch (e) {
    console.error(e);
    showToast(traducirErrorCalidad(e), true);
  } finally { ocupado = false; }
}

registerActions({
  'calidad-invalidar': id => abrirInvalidar(id),
  'calidad-revalidar': id => revalidar(id),
  'calidad-confirmar': () => confirmarInvalidar(),
  'calidad-cerrar': () => cerrar(),
  'calidad-filtro': valor => { filtro = valor === 'invalidada' ? 'invalidada' : 'sospechosa'; pintar(); },
  'calidad-recargar': () => load(),
});

// Cuelga de Inicio: el aviso de Inicio lleva aquí.
registerView('calidad', 'Mediciones a revisar', load, { menu: 'inicio' });
export function init() {}
