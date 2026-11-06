// Detalle de un vehículo: cabecera, diagrama SVG de ruedas coloreado por desgaste y panel del neumático seleccionado.
// Datos: vehiculos, v_estado_neumaticos, v_alertas, mediciones y eventos_neumatico (la RLS filtra por cliente/seccional).
// Contrato con el flujo de taller: los botones del panel llevan data-action="neumatico-cambiar" / "neumatico-rotar-pos"
// con data-vehiculo-id y data-posicion (y data-args='[vehiculoId, posicion]'). Esta vista NO implementa esas acciones:
// si no están registradas en ACTIONS muestra el aviso "No disponible". Tras operar, la acción puede llamar a
// ACTIONS.recargarVehiculoDetalle() para refrescar el diagrama.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { svgEl } from '../core/svg.js';
import { showToast, userError } from '../core/ui.js';
import { chip, chipEstado, estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import { registerView, switchView } from '../core/nav.js';
import { ACTIONS, registerActions } from '../core/actions.js';
import { contextoListo, filtrarFilas, nombreSucursal } from '../core/seccional.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { fmtNum, fmtMm, fmtFecha, plural } from '../domain/formato.js';
import { semaforoVehiculo } from '../domain/flota.js';
import { TIPO_LABEL } from '../domain/ciclo-vida.js';
import {
  layoutRuedas, geometriaDiagrama, umbralesDe, colorDesgaste, colorTexto, muestrasLeyenda, NIVEL_INFO,
} from '../domain/vehiculo-diagrama.js';
import { referenciaTasas, evaluarDesgaste } from '../domain/desgaste-flota.js';
import { serieDesgaste, datosGrafico } from '../domain/grafico-desgaste.js';

const $ = id => document.getElementById(id);
const nulo = v => v === null || v === undefined;
const MAX_FILAS = 20000;
const SEL_VEHICULO = 'id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,sucursal_id,odometro_km,odometro_actualizado_at,clientes(nombre)';
const NIVEL_CLS = { ok: 'green', bajo: 'orange', critico: 'red', retiro: 'red', sin_datos: 'gray' };

let vehiculoId = null;
let datos = null; // { veh, filas, alertas, eventos, ref, layout, geo, u, porPos }
let seleccion = null;
let ultimoFoco = null;
let tokenGrafico = 0;
const cacheMediciones = new Map();

// Rol que puede operar sobre neumáticos (cambiar/rotar): por ahora admin y cliente.
const puedeOperar = () => true;

export function abrirDetalle(id) {
  vehiculoId = id;
  seleccion = null;
  cacheMediciones.clear();
  switchView('vehiculo-detalle');
  // El detalle cuelga de "Vehículos": se mantiene resaltado en el menú.
  const nav = document.querySelector('.nav-item[data-view="vehiculos"]');
  if (nav) { nav.classList.add('active'); nav.setAttribute('aria-current', 'page'); }
}

function datosDeFila(f, u) {
  const mm = f ? f.promedio : null;
  return { mm: mm === undefined ? null : mm, ...colorDesgaste(mm, u) };
}

function cabecera() {
  const { veh, filas } = datos;
  const sem = semaforoVehiculo(filas.map(f => f.estado));
  const ult = filas.reduce((m, f) => (f.ultima_medicion_at && (!m || f.ultima_medicion_at > m) ? f.ultima_medicion_at : m), null);
  const seccional = !nulo(veh.sucursal_id) ? nombreSucursal(veh.sucursal_id) : '';
  const dato = (t, v) => html`<div><dt>${t}</dt><dd>${v}</dd></div>`;
  setHtml($('vd-cab'), html`
    <div class="vd-cab-titulo"><h2>${veh.nombre}</h2>${chipEstado(sem)}${veh.activo === false ? chip('gray', 'Inactivo', '–') : ''}</div>
    <dl class="vd-datos">
      ${dato('Matrícula', veh.patente || '—')}
      ${dato('Número de coche', veh.numero || '—')}
      ${seccional ? dato('Seccional', seccional) : ''}
      ${dato('Odómetro', !nulo(veh.odometro_km) ? html`${fmtNum(veh.odometro_km)} km${veh.odometro_actualizado_at ? html` <small>(al ${fmtFecha(veh.odometro_actualizado_at)})</small>` : ''}` : 'Sin registrar')}
      ${dato('Última medición', ult ? fmtFecha(ult) : 'Nunca')}
    </dl>`);
  document.getElementById('breadcrumb-current').textContent = veh.nombre;
  document.title = `${veh.nombre} · NEUMET`;
}

function resumen() {
  const { filas, ref } = datos;
  const con = filas.filter(f => f.estado !== 'sin_datos').length;
  const crit = filas.filter(f => f.estado === 'critico').length;
  const bajo = filas.filter(f => f.estado === 'bajo').length;
  const mayor = filas.filter(f => evaluarDesgaste(f, ref).mayorAlNormal).length;
  setHtml($('vd-resumen'), joinHtml([
    chip('gray', plural(filas.length, 'neumático montado', 'neumáticos montados'), '●'),
    crit ? chip('red', plural(crit, 'crítico', 'críticos'), '✕') : '',
    bajo ? chip('orange', plural(bajo, 'con desgaste bajo', 'con desgaste bajo'), '▲') : '',
    filas.length - con ? chip('gray', `${filas.length - con} sin datos`, '–') : '',
    mayor ? chip('orange', `${mayor} con desgaste mayor al normal`, '!') : '',
  ]));
}

function leyenda() {
  const { u } = datos;
  const items = muestrasLeyenda(u).map(m => html`<span class="vd-leyenda-item"><span class="vd-muestra" style="background:${m.hex};color:${colorTexto(m.rgb)}" aria-hidden="true">${m.simbolo}</span>${m.texto} (${m.rango})</span>`);
  items.push(html`<span class="vd-leyenda-item"><span class="vd-muestra" style="background:#eceae0;color:#383424" aria-hidden="true">–</span>Sin datos</span>`);
  items.push(html`<span class="vd-leyenda-item"><span class="vd-muestra" style="background:#383424;color:#fff" aria-hidden="true">!</span>Desgaste mayor al normal</span>`);
  setHtml($('vd-leyenda'), joinHtml(items));
}

function etiquetaAria(r, info, mm, ind) {
  const base = `Posición ${r.posicion}${r.eje ? `, ${r.etiqueta}` : ', auxilio'}`;
  const medida = nulo(mm) ? 'sin datos' : `${fmtNum(mm, 1)} milímetros, ${info.texto}`;
  return `${base}: ${medida}.${ind && ind.mayorAlNormal ? ' Desgaste mayor al normal.' : ''}`;
}

function dibujarRueda(svg, r) {
  const { u, porPos, ref } = datos;
  const fila = porPos.get(r.posicion);
  const { mm, hex, rgb, nivel } = datosDeFila(fila, u);
  const info = NIVEL_INFO[nivel];
  const ind = fila ? evaluarDesgaste(fila, ref) : null;
  const g = svgEl('g', {
    class: `vd-rueda${r.posicion === seleccion ? ' sel' : ''}${ind && ind.mayorAlNormal ? ' vd-marca' : ''}`,
    tabindex: '0', role: 'button', 'aria-pressed': String(r.posicion === seleccion),
    'aria-label': etiquetaAria(r, info, mm, ind),
    'data-action': 'detalleRueda', 'data-args': JSON.stringify([r.posicion]), 'data-pos': String(r.posicion),
  });
  const t = svgEl('title'); t.textContent = etiquetaAria(r, info, mm, ind); g.appendChild(t);
  g.appendChild(svgEl('rect', { class: 'vd-goma', x: r.x, y: r.y, width: r.ancho, height: r.alto, rx: 6, fill: hex || 'url(#vd-sin-datos)' }));
  const tinta = hex ? colorTexto(rgb) : '#383424';
  const txt = (cls, y, s) => { const e = svgEl('text', { class: cls, x: r.x + r.ancho / 2, y, fill: tinta }); e.textContent = s; g.appendChild(e); };
  txt('vd-pos', r.y + 12, r.auxilio ? 'AUX' : `P${r.posicion}`);
  txt('vd-mm', r.y + 29, nulo(mm) ? '—' : fmtNum(mm, 1));
  txt('vd-sim', r.y + 45, info.simbolo);
  if (ind && ind.mayorAlNormal) {
    g.appendChild(svgEl('circle', { class: 'vd-alerta-disco', cx: r.x + r.ancho / 2, cy: r.y - 6, r: 7 }));
    const s = svgEl('text', { class: 'vd-alerta-signo', x: r.x + r.ancho / 2, y: r.y - 2.5 }); s.textContent = '!'; g.appendChild(s);
  }
  svg.appendChild(g);
}

function dibujarDiagrama() {
  const { geo } = datos;
  const svg = svgEl('svg', { class: 'vd-svg', viewBox: `0 0 ${geo.ancho} ${geo.alto}`, role: 'group', 'aria-label': 'Vehículo visto desde arriba, con el frente hacia arriba. Cada rueda es un botón.' });
  const defs = svgEl('defs');
  const pat = svgEl('pattern', { id: 'vd-sin-datos', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(svgEl('rect', { width: 6, height: 6, fill: '#eceae0' }));
  pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#b9b49d', 'stroke-width': 2 }));
  defs.appendChild(pat); svg.appendChild(defs);
  const c = geo.chasis;
  svg.appendChild(svgEl('rect', { class: 'vd-chasis', x: c.x, y: c.y, width: c.ancho, height: c.alto, rx: 10 }));
  svg.appendChild(svgEl('rect', { class: 'vd-cabina', x: geo.cabina.x, y: geo.cabina.y, width: geo.cabina.ancho, height: geo.cabina.alto, rx: 10 }));
  const frente = svgEl('text', { class: 'vd-txt-suave', x: c.x + c.ancho / 2, y: c.y + 27, 'text-anchor': 'middle' }); frente.textContent = 'FRENTE'; svg.appendChild(frente);
  geo.ejes.forEach(e => {
    const delEje = geo.ruedas.filter(r => r.eje === e.eje);
    const x1 = Math.min(...delEje.map(r => r.x + r.ancho / 2)), x2 = Math.max(...delEje.map(r => r.x + r.ancho / 2));
    svg.appendChild(svgEl('line', { class: 'vd-eje', x1, y1: e.y, x2, y2: e.y }));
  });
  geo.ruedas.forEach(r => dibujarRueda(svg, r));
  if (geo.auxilios.length) {
    const a = geo.auxilios[0];
    const et = svgEl('text', { class: 'vd-txt-suave', x: a.x + a.ancho / 2, y: a.y - 8, 'text-anchor': 'middle' }); et.textContent = 'AUXILIO'; svg.appendChild(et);
    geo.auxilios.forEach(r => dibujarRueda(svg, r));
  }
  $('vd-diagrama').replaceChildren(svg);
}

// ── Panel del neumático ──
function frase(nombre, semanas, yaPaso) {
  if (yaPaso) return html`<li>${nombre}: ya se alcanzó.</li>`;
  if (nulo(semanas)) return '';
  return html`<li>${nombre}: en unas ${fmtNum(semanas, 1)} semanas.</li>`;
}

function seccionMedicion(fila) {
  if (!fila || nulo(fila.promedio)) return html`<p class="vd-p-nota">Este neumático todavía no tiene mediciones.</p>`;
  return html`<table class="vd-mm-tabla"><thead><tr><th scope="col">Huella 1</th><th scope="col">Huella 2</th><th scope="col">Huella 3</th><th scope="col">Promedio</th></tr></thead>
    <tbody><tr><td>${fmtNum(fila.mm1, 1)}</td><td>${fmtNum(fila.mm2, 1)}</td><td>${fmtNum(fila.mm3, 1)}</td><td>${fmtNum(fila.promedio, 1)} mm</td></tr></tbody></table>
    <p class="vd-p-nota">Medido el ${fmtFecha(fila.ultima_medicion_at)}${!nulo(fila.odometro_km) ? html` · ${fmtNum(fila.odometro_km)} km` : ''}</p>`;
}

function seccionTasa(fila, u) {
  if (!fila || nulo(fila.promedio)) return '';
  const tasa = fila.tasa_mm_semana;
  if (nulo(tasa)) return html`<p class="vd-p-nota">Todavía no hay mediciones suficientes para calcular la velocidad de desgaste (hacen falta al menos dos fechas distintas en los últimos 90 días).</p>`;
  if (Number(tasa) <= 0) return html`<p class="vd-p-texto">El desgaste no avanza en las últimas mediciones (${fmtNum(tasa, 2)} mm por semana).</p>`;
  const yaCritico = Number(fila.promedio) < u.critico, yaRetiro = Number(fila.promedio) <= u.retiro;
  return html`<p class="vd-p-texto">Se gasta ${fmtNum(tasa, 2)} mm por semana.</p>
    <ul class="vd-alertas">${frase(`Nivel crítico (${fmtNum(u.critico, 1)} mm)`, fila.semanas_hasta_critico, yaCritico)}${frase(`Retiro (${fmtNum(u.retiro, 1)} mm)`, fila.semanas_hasta_retiro, yaRetiro)}</ul>`;
}

function seccionAlertas(pos) {
  const al = datos.alertas.filter(a => Number(a.posicion) === pos).sort((a, b) => Number(b.severidad) - Number(a.severidad));
  if (!al.length) return html`<p class="vd-p-nota">Sin alertas activas.</p>`;
  const cls = { 3: 'red', 2: 'orange', 1: 'gray' }, sim = { 3: '✕', 2: '▲', 1: 'i' }, lbl = { 3: 'Crítica', 2: 'Media', 1: 'Informativa' };
  return html`<ul class="vd-alertas">${al.map(a => html`<li>${chip(cls[a.severidad] || 'gray', lbl[a.severidad] || 'Aviso', sim[a.severidad] || 'i')} ${a.mensaje}</li>`)}</ul>`;
}

function eventosDe(pos, fila) {
  return datos.eventos.filter(e =>
    (fila && !nulo(fila.neumatico_id) && e.neumatico_id === fila.neumatico_id)
    || (fila && fila.idneumatico && e.idneumatico === fila.idneumatico)
    || e.posicion_origen === pos || e.posicion_destino === pos).slice(0, 5);
}

function seccionEventos(pos, fila) {
  const ev = eventosDe(pos, fila);
  if (!ev.length) return html`<p class="vd-p-nota">Sin eventos registrados para este neumático.</p>`;
  return html`<ul class="vd-eventos">${ev.map(e => html`<li><strong>${fmtFecha(e.created_at)}</strong> · ${TIPO_LABEL[e.tipo] || e.tipo}${!nulo(e.odometro_km) ? html` · ${fmtNum(e.odometro_km)} km` : ''}${e.notas ? html` · ${e.notas}` : ''}</li>`)}</ul>`;
}

function acciones(pos) {
  if (!puedeOperar()) return '';
  const args = JSON.stringify([vehiculoId, pos]);
  const cambiar = html`<button type="button" class="btn" data-action="neumatico-cambiar" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}" data-args="${args}">Cambiar neumático</button>`;
  // Rotar: el usuario elige la posición de destino; el botón lleva data-args='[vehiculoId, posA, posB]' (se actualiza al elegir).
  const destinos = [...datos.layout.ruedas, ...datos.layout.auxilios].filter(r => r.posicion !== pos);
  const rotar = html`<div class="vd-rotar">
    <label for="vd-rotar-destino">Rotar con la posición</label>
    <select id="vd-rotar-destino" class="select-filter"><option value="">Elegí la posición…</option>${destinos.map(r => html`<option value="${r.posicion}">${r.auxilio ? 'Auxilio (P' + r.posicion + ')' : `P${r.posicion} · ${r.etiqueta}`}</option>`)}</select>
    <button type="button" class="btn" id="vd-rotar-btn" data-action="neumatico-rotar-pos" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}" data-destino="" data-args="${JSON.stringify([vehiculoId, pos, null])}">Rotar</button></div>`;
  return html`<div class="vd-p-acciones">${cambiar}</div>${rotar}`;
}

function renderPanel() {
  const body = $('vd-panel-body');
  if (nulo(seleccion)) {
    setHtml(body, html`<p class="vd-panel-vacio">Tocá una rueda del diagrama para ver su estado, sus mediciones y sus alertas.</p>`);
    return;
  }
  const pos = seleccion;
  const { u, porPos, ref } = datos;
  const fila = porPos.get(pos);
  const r = [...datos.layout.ruedas, ...datos.layout.auxilios].find(x => x.posicion === pos);
  const { nivel } = datosDeFila(fila, u);
  const info = NIVEL_INFO[nivel];
  const ind = fila ? evaluarDesgaste(fila, ref) : null;
  const detalle = [fila && fila.marca, fila && fila.modelo].filter(Boolean).join(' ');
  setHtml(body, html`
    <div class="vd-p-head">
      <div><h3 id="vd-panel-titulo" tabindex="-1">${r && r.auxilio ? 'Neumático auxilio' : `Posición ${pos}`}</h3>
        <div class="vd-p-sub">${r ? r.etiqueta : ''}${detalle ? html` · ${detalle}` : ''}${fila && fila.vida ? ` · reencauche ${fila.vida}` : ''}${fila && fila.idneumatico ? html` · ${fila.idneumatico}` : ''}</div></div>
      <button type="button" class="icon-btn" data-action="detalleCerrarPanel" aria-label="Cerrar detalle del neumático">&times;</button>
    </div>
    <div class="vd-p-estado">${chip(NIVEL_CLS[nivel], info.texto, info.simbolo)}${ind && ind.mayorAlNormal ? chip('orange', 'Desgaste mayor al normal', '!') : ''}</div>
    ${ind && ind.mayorAlNormal ? html`<p class="vd-p-razon">${ind.razon}</p>` : ''}
    <h4>Última medición</h4>${seccionMedicion(fila)}
    <h4>Velocidad de desgaste</h4>${seccionTasa(fila, u)}
    <h4>Alertas</h4>${seccionAlertas(pos)}
    <h4>Evolución del desgaste</h4><div id="vd-chart-wrap"><p class="vd-p-nota">Cargando mediciones…</p></div>
    <h4>Historial reciente</h4>${seccionEventos(pos, fila)}
    ${acciones(pos)}`);
  cargarGrafico(pos, fila);
}

async function medicionesDe(pos) {
  if (cacheMediciones.has(pos)) return cacheMediciones.get(pos);
  const { data, error } = await db.from('mediciones').select('mm1,mm2,mm3,promedio,created_at')
    .eq('vehiculo_id', vehiculoId).eq('posicion', pos).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  cacheMediciones.set(pos, data || []);
  return data || [];
}

async function cargarGrafico(pos, fila) {
  const mi = ++tokenGrafico;
  let med;
  try { med = await medicionesDe(pos); } catch (e) {
    if (mi === tokenGrafico && $('vd-chart-wrap')) setHtml($('vd-chart-wrap'), html`<p class="vd-p-nota">${userError(e)}</p>`);
    return;
  }
  const wrap = $('vd-chart-wrap');
  if (mi !== tokenGrafico || !wrap) return;
  const d = datosGrafico(serieDesgaste(med), datos.u, fila ? fila.tasa_mm_semana : null);
  if (!d) { setHtml(wrap, html`<p class="vd-p-nota">Todavía no hay mediciones para graficar.</p>`); return; }
  wrap.replaceChildren(construirGrafico(d));
}

const COLOR_UMBRAL = { bajo: '#c98a00', critico: '#e06a00', retiro: '#b3261e' };
function construirGrafico(d) {
  const p0 = d.puntos[0], pn = d.puntos[d.puntos.length - 1];
  const svg = svgEl('svg', { class: 'vd-chart', viewBox: `0 0 ${d.ancho} ${d.alto}`, role: 'img',
    'aria-label': `Gráfico de desgaste: ${plural(d.puntos.length, 'medición', 'mediciones')}, de ${fmtNum(p0.mm, 1)} mm el ${fmtFecha(p0.fecha)} a ${fmtNum(pn.mm, 1)} mm el ${fmtFecha(pn.fecha)}. Las líneas horizontales marcan los umbrales bajo, crítico y de retiro${d.proyeccion ? '; la línea punteada es la proyección' : ''}.` });
  const m = d.margen;
  d.ejeY.forEach(t => {
    svg.appendChild(svgEl('line', { class: 'vd-g-grid', x1: m.l, y1: t.y, x2: d.ancho - m.r, y2: t.y }));
    const e = svgEl('text', { class: 'vd-g-eje', x: m.l - 5, y: t.y + 3, 'text-anchor': 'end' }); e.textContent = fmtNum(t.mm); svg.appendChild(e);
  });
  d.umbrales.forEach(t => {
    svg.appendChild(svgEl('line', { class: 'vd-g-umbral', x1: m.l, y1: t.y, x2: d.ancho - m.r, y2: t.y, stroke: COLOR_UMBRAL[t.clave] }));
    const e = svgEl('text', { class: 'vd-g-eje', x: d.ancho - m.r - 2, y: t.y - 3, 'text-anchor': 'end', fill: COLOR_UMBRAL[t.clave], 'font-weight': '600' });
    e.textContent = `${t.etiqueta} ${fmtNum(t.mm, 1)}`; svg.appendChild(e);
  });
  d.ejeX.forEach((t, i) => {
    const e = svgEl('text', { class: 'vd-g-eje', x: t.x, y: d.alto - 8, 'text-anchor': i === 0 ? 'start' : 'end' }); e.textContent = fmtFecha(t.t); svg.appendChild(e);
  });
  if (d.puntos.length > 1) svg.appendChild(svgEl('path', { class: 'vd-g-serie', d: d.linea }));
  if (d.proyeccion) svg.appendChild(svgEl('line', { class: 'vd-g-proy', x1: d.proyeccion.x1, y1: d.proyeccion.y1, x2: d.proyeccion.x2, y2: d.proyeccion.y2 }));
  d.puntos.forEach(p => {
    const c = svgEl('circle', { class: 'vd-g-punto', cx: p.x, cy: p.y, r: 3.2 });
    const t = svgEl('title'); t.textContent = `${fmtFecha(p.fecha)}: ${fmtMm(p.mm)}`; c.appendChild(t); svg.appendChild(c);
  });
  return svg;
}

// ── Selección ──
function seleccionarRueda(pos) {
  const pos2 = Number(pos);
  if (!datos) return;
  ultimoFoco = document.activeElement && document.activeElement.closest && document.activeElement.closest('.vd-rueda');
  seleccion = pos2;
  document.querySelectorAll('#vd-diagrama .vd-rueda').forEach(g => {
    const on = Number(g.dataset.pos) === pos2;
    g.classList.toggle('sel', on); g.setAttribute('aria-pressed', String(on));
    if (on && !ultimoFoco) ultimoFoco = g;
  });
  renderPanel();
  $('vd-panel').classList.add('abierto'); $('vd-backdrop').classList.add('abierto');
  const tit = $('vd-panel-titulo');
  if (tit) tit.focus();
}

function cerrarPanel() {
  seleccion = null; tokenGrafico++;
  $('vd-panel').classList.remove('abierto'); $('vd-backdrop').classList.remove('abierto');
  document.querySelectorAll('#vd-diagrama .vd-rueda').forEach(g => { g.classList.remove('sel'); g.setAttribute('aria-pressed', 'false'); });
  renderPanel();
  if (ultimoFoco && ultimoFoco.isConnected) ultimoFoco.focus();
  ultimoFoco = null;
}

export async function load() {
  if (nulo(vehiculoId)) { switchView('vehiculos'); return; }
  setHtml($('vd-cab'), estadoCarga('Cargando el vehículo…'));
  $('vd-resumen').replaceChildren(); $('vd-diagrama').replaceChildren(); $('vd-leyenda').replaceChildren();
  await contextoListo();
  const [v, est, al, ev] = await Promise.all([
    db.from('vehiculos').select(SEL_VEHICULO).eq('id', vehiculoId).maybeSingle(),
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_alertas').select('*').eq('vehiculo_id', vehiculoId).order('severidad', { ascending: false }),
    db.from('eventos_neumatico').select('id,neumatico_id,idneumatico,tipo,posicion_origen,posicion_destino,odometro_km,notas,created_at')
      .eq('vehiculo_id', vehiculoId).order('created_at', { ascending: false }).limit(100),
  ]);
  if (v.error || est.error || al.error) { showToast(userError(v.error || est.error || al.error), true); setHtml($('vd-cab'), estadoError('', 'recargarVehiculoDetalle')); return; }
  if (!v.data) { setHtml($('vd-cab'), estadoVacio('No encontramos ese vehículo', 'Puede que ya no exista o que no tengas acceso.', { label: 'Volver a vehículos', action: 'detalleVolver', primaria: true })); return; }
  const filas = (est.rows || []).filter(f => String(f.vehiculo_id) === String(vehiculoId));
  const ref = referenciaTasas(filtrarFilas(est.rows || []));
  const posiciones = filas.map(f => f.posicion);
  const layout = layoutRuedas(posiciones, v.data.tipo_ruedas);
  datos = {
    veh: v.data, filas, alertas: al.data || [], eventos: ev.error ? [] : (ev.data || []), ref,
    layout, geo: geometriaDiagrama(layout), u: umbralesDe(filas[0]), porPos: new Map(filas.map(f => [Number(f.posicion), f])),
  };
  cabecera(); resumen(); leyenda(); dibujarDiagrama();
  if (!nulo(seleccion) && !datos.porPos.has(seleccion)) seleccion = null;
  renderPanel();
}

registerActions({
  verVehiculoDetalle: id => abrirDetalle(Number(id)),
  detalleVolver: () => switchView('vehiculos'),
  detalleRueda: pos => seleccionarRueda(pos),
  detalleCerrarPanel: () => cerrarPanel(),
  recargarVehiculoDetalle: () => { cacheMediciones.clear(); return load(); },
});

export function init() {
  const dia = $('vd-diagrama');
  dia.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest && e.target.closest('.vd-rueda');
    if (!g) return;
    e.preventDefault();
    seleccionarRueda(g.dataset.pos);
  });
  // Acciones del taller: si nadie las registró, aviso en vez de error en consola.
  $('vd-panel').addEventListener('click', e => {
    const b = e.target.closest('[data-action^="neumatico-"]');
    if (!b) return;
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, b.dataset.action)) { e.stopPropagation(); showToast('No disponible'); return; }
    if (b.dataset.action === 'neumatico-rotar-pos' && !b.dataset.destino) { e.stopPropagation(); showToast('Elegí la posición con la que querés rotar', true); }
  }, true);
  $('vd-panel').addEventListener('change', e => {
    if (e.target.id !== 'vd-rotar-destino') return;
    const b = $('vd-rotar-btn');
    b.dataset.destino = e.target.value;
    b.dataset.args = JSON.stringify([vehiculoId, Number(b.dataset.posicion), e.target.value ? Number(e.target.value) : null]);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !nulo(seleccion) && $('view-vehiculo-detalle').classList.contains('active')) cerrarPanel();
  });
}

registerView('vehiculo-detalle', 'Vehículo', load);
