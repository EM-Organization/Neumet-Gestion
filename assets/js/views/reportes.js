// Reportes: exportación CSV de mediciones y reporte imprimible (flota o vehículo), por cliente/vehículo y rango de fechas.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode, currentClienteId } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { PAGE_SIZE, MAX_ROWS, medicionesCsv, resumenFlota, rangoFechas, safeFilename, fetchAll } from '../domain/reportes.js';
import { printDoc } from './report.js';
import { contextoListo, hayFiltroSeccional, sucursalSeleccionada, filtrarConsulta } from '../core/seccional.js';
import { fmtMm } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';

const $ = id => document.getElementById(id);
const COLOR = { ok: '#1a7f37', bajo: '#b25000', critico: '#c0392b', null: '#8e8e93' };
const LABEL = { ok: 'OK', bajo: 'BAJO', critico: 'CRÍTICO', null: 'Sin datos' };
let busy = false;

function setProgress(msg, warn = false) {
  const el = $('rep-progress');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
}

function fillSelect(sel, first, items) {
  setHtml(sel, joinHtml([html`<option value="">${first}</option>`, ...items.map(i => html`<option value="${i.id}">${i.label}</option>`)]));
}

async function loadVehiculos() {
  const cid = isClienteMode() ? currentClienteId : $('rep-cliente').value;
  await contextoListo();
  let q = filtrarConsulta(db.from('vehiculos').select('id,nombre,patente,cliente_id').order('nombre'));
  if (cid) q = q.eq('cliente_id', cid);
  const { data, error } = await q;
  if (error) { showToast(userError(error), true); return; }
  fillSelect($('rep-vehiculo'), 'Todos los vehículos', (data || []).map(v => ({ id: v.id, label: v.patente ? `${etiquetaCoche(v.nombre)} (${v.patente})` : etiquetaCoche(v.nombre) })));
}

export async function load() {
  setProgress('');
  if (!isClienteMode()) {
    const { data, error } = await db.from('clientes').select('id,nombre').order('nombre');
    if (error) { showToast(userError(error), true); return; }
    fillSelect($('rep-cliente'), 'Todos los clientes', (data || []).map(c => ({ id: c.id, label: c.nombre })));
  }
  await loadVehiculos();
  $('rep-ver-vehiculo').hidden = true;
}

// Lee TODAS las mediciones del alcance elegido por lotes de PAGE_SIZE con range(); tope MAX_ROWS con aviso.
async function fetchMediciones() {
  const rango = rangoFechas($('rep-desde').value, $('rep-hasta').value);
  if (rango.error) { showToast(rango.error, true); return null; }
  const cid = isClienteMode() ? currentClienteId : $('rep-cliente').value;
  const vid = $('rep-vehiculo').value;
  const page = (from, to) => {
    // Con una sucursal elegida se filtra por el vehículo (join interno) en el servidor.
    const porSeccional = hayFiltroSeccional();
    let q = db.from('mediciones')
      .select(porSeccional
        ? 'id,created_at,vehiculo_id,posicion,idneumatico,mm1,mm2,mm3,promedio,vehiculos!inner(nombre,patente,sucursal_id)'
        : 'id,created_at,vehiculo_id,posicion,idneumatico,mm1,mm2,mm3,promedio,vehiculos(nombre,patente)');
    if (porSeccional) q = q.eq('vehiculos.sucursal_id', sucursalSeleccionada());
    if (cid) q = q.eq('cliente_id', cid);
    if (vid) q = q.eq('vehiculo_id', vid);
    if (rango.desde) q = q.gte('created_at', rango.desde);
    if (rango.hasta) q = q.lt('created_at', rango.hasta);
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
  };
  const res = await fetchAll(page, { pageSize: PAGE_SIZE, max: MAX_ROWS, onProgress: n => setProgress(`Descargando mediciones… ${n} filas`) });
  if (res.error) { showToast(userError(res.error), true); setProgress(''); return null; }
  if (res.truncated) {
    const msg = `Se alcanzó el tope de ${MAX_ROWS} filas: el resultado está incompleto. Acotar el rango de fechas o el vehículo.`;
    setProgress(msg, true); showToast(msg, true);
  } else setProgress(`${res.rows.length} filas descargadas`);
  return res;
}

async function run(btnId, fn) {
  if (busy) return;
  busy = true;
  const btns = ['rep-csv-btn', 'rep-print-btn'].map($);
  btns.forEach(b => { b.disabled = true; });
  try {
    const res = await fetchMediciones();
    if (!res) return;
    if (!res.rows.length) { setProgress('No hay mediciones para ese alcance y rango', true); showToast('No hay mediciones para el alcance elegido', true); return; }
    fn(res);
  } catch (e) { showToast(userError(e), true); }
  finally { busy = false; btns.forEach(b => { b.disabled = false; }); }
}

function scopeNames() {
  const sel = (id) => { const s = $(id); return s.value ? s.options[s.selectedIndex].textContent : ''; };
  return { cliente: isClienteMode() ? '' : sel('rep-cliente'), vehiculo: sel('rep-vehiculo') };
}

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  return run('rep-csv-btn', ({ rows }) => {
    const n = scopeNames();
    download(medicionesCsv(rows), safeFilename(['neumet', n.cliente, n.vehiculo, new Date().toISOString().slice(0, 10)], 'csv'));
    showToast(`CSV exportado (${rows.length} filas)`);
  });
}

const fmtDate = s => s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

function buildDoc(rows, truncated) {
  const r = resumenFlota(rows);
  const n = scopeNames();
  const titulo = n.vehiculo ? `Vehículo: ${n.vehiculo}` : `Flota${n.cliente ? ': ' + n.cliente : ''}`;
  const kpi = (cls, num, label) => html`<div class="kpi ${cls}"><div class="kpi-n">${num}</div><div class="kpi-l">${label}</div></div>`;
  const porVeh = joinHtml(r.vehiculos.map(v => html`<tr><td>${etiquetaCoche(v.nombre)}</td><td>${v.patente || '—'}</td><td>${v.neumaticos}</td><td>${v.ok}</td><td>${v.bajo}</td><td>${v.critico}</td></tr>`));
  const detalle = joinHtml(r.neumaticos.map(t => html`<tr>
    <td>${etiquetaCoche(t.nombre)}</td><td>${t.patente || '—'}</td><td>Pos. ${t.posicion ?? '—'}</td><td>${t.idneumatico ?? '—'}</td>
    <td style="font-weight:700;color:${COLOR[t.estado]}">${LABEL[t.estado]}</td><td>${fmtMm(t.promedio)}</td><td>${fmtDate(t.created_at)}</td></tr>`));
  return html`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>Reporte NEUMET · ${titulo}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#383424;padding:40px;font-size:14px}
  @media print{body{padding:20px}}
  .header{padding-bottom:20px;border-bottom:2px solid #383424;margin-bottom:24px}
  .brand{font-size:22px;font-weight:800}.brand span{color:#615A3F}
  .meta{font-size:12px;color:#615A3F;margin-top:6px;line-height:1.7}
  .warn{background:#fdecea;border:1px solid #c0392b;color:#c0392b;padding:10px;border-radius:8px;margin-bottom:16px;font-weight:600}
  .kpis{display:flex;gap:16px;margin:20px 0}
  .kpi{flex:1;border:1px solid #e5e5ea;border-radius:10px;padding:12px;text-align:center}
  .kpi-n{font-size:26px;font-weight:800}.kpi-l{font-size:11px;color:#615A3F}
  .kpi.ok .kpi-n{color:#1a7f37}.kpi.bajo .kpi-n{color:#b25000}.kpi.critico .kpi-n{color:#c0392b}
  h3{font-size:13px;text-transform:uppercase;color:#615A3F;margin:22px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#EBEBEB;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#615A3F}
  td{padding:8px 10px;border-bottom:1px solid #f2f2f2}
  .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e5e5ea;font-size:11px;color:#615A3F}
</style></head><body>
<div class="header"><div class="brand">NEU<span>MET</span></div>
<div class="meta"><strong>${titulo}</strong><br>Última medición de cada neumático · Generado el ${fmtDate(new Date().toISOString())}</div></div>
${truncated ? html`<div class="warn">Datos incompletos: se alcanzó el tope de ${MAX_ROWS} mediciones.</div>` : ''}
<div class="kpis">${kpi('total', r.neumaticos.length, 'Neumáticos')}${kpi('ok', r.ok, 'OK (≥8mm)')}${kpi('bajo', r.bajo, 'Bajo (5–7.9mm)')}${kpi('critico', r.critico, 'Crítico (<5mm)')}</div>
${n.vehiculo ? '' : html`<h3>Resumen por vehículo</h3><table><thead><tr><th>Vehículo</th><th>Matrícula</th><th>Neumáticos</th><th>OK</th><th>Bajo</th><th>Crítico</th></tr></thead><tbody>${porVeh}</tbody></table>`}
<h3>Estado por neumático</h3>
<table><thead><tr><th>Vehículo</th><th>Matrícula</th><th>Posición</th><th>ID neumático</th><th>Estado</th><th>Promedio</th><th>Última medición</th></tr></thead><tbody>${detalle}</tbody></table>
<div class="footer">NEUMET · Sistema de gestión de neumáticos</div>
</body></html>`;
}

function printReport() {
  return run('rep-print-btn', ({ rows, truncated }) => { printDoc(buildDoc(rows, truncated)); });
}

ACTIONS.repExportCsv = exportCsv;
ACTIONS.repPrint = printReport;
ACTIONS.repClienteChange = async v => { await loadVehiculos(); ACTIONS.repVehiculoChange(''); };
ACTIONS.repVehiculoChange = v => { $('rep-ver-vehiculo').hidden = !v; };
ACTIONS.repVerVehiculo = () => { const v = $('rep-vehiculo').value; if (v) ACTIONS.verVehiculo(v); };
registerView('reportes', 'Reportes', load);

export function init() { /* sin listeners propios: todo va por data-action / data-change */ }
