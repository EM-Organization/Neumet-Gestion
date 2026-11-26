// Detalle de un vehículo: cabecera, diagrama SVG de ruedas coloreado por desgaste y panel del neumático seleccionado.
// Datos: vehiculos, neumaticos (n.º de quema y km previos), v_estado_neumaticos, v_alertas, v_mediciones_neumatico (mediciones del neumático montado) y eventos_neumatico (la RLS filtra por cliente/seccional).
// Posiciones sin neumático: ruedas punteadas «vacías» con la acción «Montar neumático» (views/montar-neumatico.js); un coche
// sin neumáticos muestra un estado vacío con «Cargar neumáticos». «Retirar neumático» deja la posición libre.
// Contrato con el flujo de taller: los botones del panel llevan data-action="neumatico-cambiar" / "neumatico-rotar-pos"
// con data-vehiculo-id y data-posicion (y data-args='[vehiculoId, posicion]'). Esta vista NO implementa esas acciones:
// si no están registradas en ACTIONS muestra el aviso "No disponible". Tras operar, la acción puede llamar a
// ACTIONS.recargarVehiculoDetalle() para refrescar el diagrama.
import { tipoLayout } from '../domain/distribucion.js';
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { svgEl } from '../core/svg.js';
import { showToast, userError } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import {
  registerView, switchView, setTitulo, onSalirVista, onEntrarVista, vistaActiva, etiquetaVista,
} from '../core/nav.js';
import { ACTIONS, registerActions } from '../core/actions.js';
import { esAdmin, esAdminEmpresa } from '../core/auth.js';
import { contextoListo, filtrarFilas, nombreSucursal } from '../core/seccional.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { fmtNum, fmtFecha, plural } from '../domain/formato.js';
import { severidadLabel } from '../domain/flota.js';
import { partesRecuadro } from '../domain/alertas.js';
import { TIPO_LABEL } from '../domain/ciclo-vida.js';
import { etiquetaMotivo } from '../domain/motivos.js';
import { cargarMotivosCliente } from '../core/motivos.js';
import { COLUMNAS_KM, resumenKm, indexarKm } from '../domain/km-cubierta.js';
import { COLUMNAS_COSTO, resumenCosto, indexarCostos } from '../domain/costos.js';
import { abrirRegistroCosto, puedeVerCostos, puedeRegistrarCosto } from './costos.js';
import { layoutRuedas, geometriaDiagrama, umbralesDe } from '../domain/vehiculo-diagrama.js';
import { referenciaTasas } from '../domain/desgaste-flota.js';
import { huellaMinima } from '../domain/desgaste.js';
import { serieDesgaste, datosGrafico, tooltipPunto } from '../domain/grafico-desgaste.js';
import {
  umbralesEstado, wearStatus, ESTADOS, BANDERA, ORDEN_ESTADOS, rangoEstado, etiquetaChip, contarEstadosFilas, estadoVehiculo, estadoContable, banderaDeFila as banderaDe, fmtMedida,
} from '../domain/estado-desgaste.js';
import { TOKENS } from '../domain/tokens-detalle.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePos, etiquetaVida } from '../domain/cambio-neumatico.js';
import { agruparPorNeumatico, soloObservadas, textoObservaciones, detalleObservaciones } from '../domain/calidad.js';
import { listaCalidad, SEL_CALIDAD } from './calidad.js';

const $ = id => document.getElementById(id);
const nulo = v => v === null || v === undefined;
const MAX_FILAS = 20000;
const SEL_VEHICULO = 'id,nombre,patente,numero,tipo_ruedas,distribucion,activo,cliente_id,sucursal_id,odometro_km,odometro_actualizado_at,clientes(nombre)';

let vehiculoId = null;
let filtro = null; // estado elegido en los chips ('limite'|'mayor'|'poco'|'bueno'|'sinDatos'|'acelerado'); solo atenúa, no cambia la selección
let datos = null; // { veh, filas, alertas, eventos, ref, layout, geo, u, th, porPos, obs, calPorPos }
let calAbierto = false; // detalle de «mediciones con observaciones» desplegado (se conserva al recargar tras una acción)
let seleccion = null;
let focoTrasCarga = null; // rueda a enfocar cuando el detalle se redibuje tras una rotación o un cambio
let preseleccion = null; // rueda a seleccionar al terminar de cargar (enlace desde Inicio)
let ultimoFoco = null;
let tokenGrafico = 0;
let tokenCarga = 0; // dos load() superpuestos (rotación + recarga manual): solo el último pinta
let entradaPorUrl = false; // true si este load() arrancó leyendo ?vehiculo de la URL
let origen = 'inicio'; // vista a la que regresa la miga (Inicio, Vehículos, Alertas, Flota…)
const cacheMediciones = new Map();

const URL_VEHICULO = 'vehiculo';
const URL_POS = 'pos';

// En iframes con srcdoc (smoke) history.replaceState rechaza una URL distinta a about:srcdoc.
const urlSoportada = () => location.protocol !== 'about:';

export function leerUrl() {
  if (!urlSoportada()) return { vehiculo: null, pos: null };
  const params = new URLSearchParams(location.search);
  return {
    vehiculo: params.get(URL_VEHICULO),
    pos: params.get(URL_POS),
  };
}

function escribirUrl() {
  if (!urlSoportada()) return;
  const params = new URLSearchParams();
  if (vehiculoId) params.set(URL_VEHICULO, vehiculoId);
  if (!nulo(seleccion)) params.set(URL_POS, seleccion);
  const query = params.toString();
  const url = query ? `${location.pathname}?${query}` : location.pathname;
  history.replaceState(null, '', url);
}

function limpiarUrl() {
  if (urlSoportada() && location.search) history.replaceState(null, '', location.pathname);
}

// Quien puede operar sobre neumáticos (cambiar, rotar, retirar, montar): el cliente. El equipo Neumet solo mira (docs/17 PR 9).
const puedeOperar = () => !esAdmin();

export function abrirDetalle(id, pos = null, origenForzado = null, esUrl = false) {
  const activa = vistaActiva();
  if (origenForzado) {
    origen = origenForzado;
  } else if (activa && activa !== 'vehiculo-detalle') {
    origen = activa;
  } else if (!activa) {
    origen = 'inicio';
  }
  vehiculoId = id;
  seleccion = null; filtro = null;
  preseleccion = nulo(pos) ? null : Number(pos);
  entradaPorUrl = esUrl;
  cacheMediciones.clear();
  escribirUrl();
  switchView('vehiculo-detalle'); // el menú resalta Vehículos (registerView con menu)
}

// Estado y bandera de un neumático. El estado sale de wearStatus con la HUELLA MÍNIMA (RN-01) y los umbrales del cliente;
// la bandera, de evaluarDesgaste (desgaste irregular o tasa alta frente a la flota). No se calculan en ningún otro lugar.
function estadoDeFila(f) {
  const mm = huellaMinima(f);
  const id = wearStatus(mm, datos.th);
  return { mm: nulo(mm) ? null : Number(mm), id, ...ESTADOS[id] };
}
const banderaDeFila = f => banderaDe(f, datos.ref);

// Etiqueta de estado (alto 28): símbolo + texto; el color nunca va solo.
function tagEstado(id) {
  const e = ESTADOS[id];
  return html`<span class="vd-tag est-${e.estilo}">${id === 'sinDatos' ? html`<span class="vd-chip-rayas" aria-hidden="true"></span>` : html`<span class="vd-chip-sim" aria-hidden="true">${e.simbolo}</span>`}${e.texto}</span>`;
}
const tagBandera = () => html`<span class="vd-tag vd-tag-flag"><span class="vd-flag-dot" aria-hidden="true">${BANDERA.simbolo}</span>${BANDERA.texto}</span>`;

function cabecera() {
  const { veh, filas } = datos;
  const sem = estadoVehiculo(filas, datos.th);
  const ult = filas.reduce((m, f) => (f.ultima_medicion_at && (!m || f.ultima_medicion_at > m) ? f.ultima_medicion_at : m), null);
  const sucursal = !nulo(veh.sucursal_id) ? nombreSucursal(veh.sucursal_id) : '';
  const recuadro = partesRecuadro(datos.alertas).map((p, i) => html`${i ? ' · ' : ''}${chip(p.color, p.texto, p.simbolo)}`);
  const dato = (t, v) => html`<div><dt>${t}</dt><dd>${v}</dd></div>`;
  setHtml($('vd-cab'), html`
    <div class="vd-cab-titulo"><h2>${etiquetaCoche(veh.nombre)}</h2>${filas.length ? tagEstado(sem) : chip('gray', 'Sin neumáticos', '–')}${veh.activo === false ? chip('gray', 'Inactivo', '–') : ''}
      ${puedeOperar() ? html`<button type="button" class="btn ghost" data-action="vehiculo-cambiar-distribucion" data-vehiculo-id="${vehiculoId}">Distribución y servicio</button>` : ''}
      ${esAdminEmpresa() ? html`<button type="button" class="btn ghost" data-action="openCicloVida" data-args="[${vehiculoId}, true]">Odómetro y ciclo de vida</button>` : ''}
      ${esAdminEmpresa() ? html`<button type="button" class="btn ghost vd-cab-eliminar" data-action="vehiculo-eliminar" data-vehiculo-id="${vehiculoId}">Eliminar vehículo</button>` : ''}</div>
    ${recuadro.length ? html`<p class="vd-p-nota">${recuadro}</p>` : ''}
    <dl class="vd-datos">
      ${dato('Matrícula', veh.patente || '—')}
      ${veh.numero && String(veh.numero) !== String(veh.nombre) ? dato('Número de coche', veh.numero) : ''}
      ${sucursal ? dato('Sucursal', sucursal) : ''}
      ${dato('Odómetro', !nulo(veh.odometro_km) ? html`${fmtNum(veh.odometro_km)} km${veh.odometro_actualizado_at ? html` <small>(al ${fmtFecha(veh.odometro_actualizado_at)})</small>` : ''}` : 'Sin registrar')}
      ${dato('Última medición', ult ? fmtFecha(ult) : 'Nunca')}
    </dl>`);
  setTitulo(etiquetaCoche(veh.nombre), origen); // migas: Origen › Coche NNN
}

// Posiciones del tipo de vehículo sin neumático montado (el auxilio vacío no cuenta: es opcional).
const posicionesVacias = () => datos.layout.ruedas.filter(r => !datos.porPos.has(r.posicion));

function resumen() {
  const { filas } = datos;
  if (!filas.length) {
    setHtml($('vd-resumen'), html`<div class="vd-vacio"><div class="vd-vacio-titulo">Sin neumáticos montados</div>
      <p class="vd-vacio-texto">Cargar los neumáticos de este vehículo para registrar mediciones y ver su estado.</p>
      ${puedeOperar() ? html`<button type="button" class="btn primary" data-action="neumatico-montar" data-vehiculo-id="${vehiculoId}">Cargar neumáticos</button>` : ''}</div>`);
    return;
  }
  // Los chips son la leyenda y el filtro a la vez: un chip por estado con neumáticos, de lo más urgente a lo mejor.
  // La suma de los estados es el total (el auxilio cuenta como mucho «poco desgaste», PR 140); la bandera no es un estado, se cuenta aparte.
  const th = datos.th;
  const n = contarEstadosFilas(filas, th);
  const acelerados = filas.filter(f => banderaDeFila(f).mayorAlNormal).length;
  const chipFiltro = (clave, etiqueta, contenido) => html`<button type="button" class="vd-chip ${clave === 'acelerado' ? 'vd-chip-flag' : `est-${ESTADOS[clave].estilo}`}"
    data-action="detalleFiltro" data-args="${JSON.stringify([clave])}" data-filtro="${clave}" aria-pressed="${filtro === clave}" aria-label="${etiqueta}">${contenido}</button>`;
  const chipEst = id => {
    const e = ESTADOS[id];
    const marca = id === 'sinDatos' ? html`<span class="vd-chip-rayas" aria-hidden="true"></span>` : html`<span class="vd-chip-sim" aria-hidden="true">${e.simbolo}</span>`;
    const rango = rangoEstado(id, th);
    return chipFiltro(id, etiquetaChip(id, n[id], th), html`${marca}<span aria-hidden="true">${fmtNum(n[id])} ${e.texto}</span>${rango ? html`<span class="vd-chip-rango" aria-hidden="true">${rango}</span>` : ''}`);
  };
  setHtml($('vd-resumen'), joinHtml([
    html`<button type="button" class="vd-chip vd-chip-total" data-action="detalleFiltro" data-args="[null]">${plural(n.total, 'neumático', 'neumáticos')}</button>`,
    ...ORDEN_ESTADOS.filter(id => n[id] > 0).map(chipEst),
    acelerados ? chipFiltro('acelerado', `${plural(acelerados, 'neumático', 'neumáticos')} con ${BANDERA.texto.toLowerCase()}`,
      html`<span class="vd-flag-dot" aria-hidden="true">${BANDERA.simbolo}</span><span aria-hidden="true">${fmtNum(acelerados)} ${BANDERA.texto}</span>`) : '',
    puedeOperar() && posicionesVacias().length ? html`<button type="button" class="btn ghost vd-montar-mas" data-action="neumatico-montar" data-vehiculo-id="${vehiculoId}">Montar neumático</button>` : '',
  ]));
}

// El filtro atenúa sin tocar la selección ni el panel; las ruedas atenuadas siguen siendo tocables.
function coincideFiltro(fila) {
  if (filtro === null) return true;
  if (filtro === 'acelerado') return banderaDeFila(fila).mayorAlNormal;
  return estadoContable(fila, datos.th) === filtro; // el mismo estado contable que cuentan los chips
}
function aplicarFiltro() {
  document.querySelectorAll('#vd-resumen [data-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtro === filtro)));
  document.querySelectorAll('#vd-diagrama .vd-rueda[data-pos], #vd-diagrama .vd-bandera[data-pos]').forEach(g => {
    const fila = datos.porPos.get(Number(g.dataset.pos));
    g.classList.toggle('dim', !!fila && !coincideFiltro(fila));
  });
}

const dondeDe = r => (r.auxilio ? 'Auxilio' : `P${r.posicion} · ${nombrePos(r.posicion, tipoLayout(datos.veh))}`);

// Texto del tooltip: «P3 · Eje 2 izquierda exterior · 4,7 mm · Mayor desgaste[ · Desgaste acelerado]».
function etiquetaTooltip(r, e, ind) {
  return [dondeDe(r), nulo(e.mm) ? e.texto : `${fmtMedida(e.mm)} mm · ${e.texto}`, ind && ind.mayorAlNormal ? BANDERA.texto : null].filter(Boolean).join(' · ');
}

// Texto para lectores: «Posición P3, Eje 2 izquierda exterior, 4,7 milímetros, mayor desgaste[, desgaste acelerado][, seleccionado]».
function etiquetaAria(r, e, ind, sel) {
  const lugar = r.auxilio ? 'Auxilio' : `Posición P${r.posicion}, ${nombrePos(r.posicion, tipoLayout(datos.veh))}`;
  const medida = nulo(e.mm) ? 'sin datos' : `${fmtMedida(e.mm)} milímetros, ${e.texto.toLowerCase()}`;
  return `${lugar}, ${medida}${ind && ind.mayorAlNormal ? `, ${BANDERA.texto.toLowerCase()}` : ''}${sel ? ', seleccionado' : ''}`;
}

// Posición sin neumático: contorno punteado, sin color de desgaste. Selecciona la rueda y el panel ofrece montarlo.
function dibujarRuedaVacia(svg, r) {
  const sel = r.posicion === seleccion;
  const donde = nombrePos(r.posicion, tipoLayout(datos.veh));
  const etq = `${donde}: vacía. Elegir para montar un neumático.`;
  const g = svgEl('g', {
    class: `vd-rueda vd-vacia${sel ? ' sel' : ''}`, tabindex: '0', role: 'button', 'aria-pressed': String(sel), 'aria-label': etq,
    'data-action': 'detalleRueda', 'data-args': JSON.stringify([r.posicion]), 'data-pos': String(r.posicion),
  });
  const t = svgEl('title'); t.textContent = etq; g.appendChild(t);
  g.appendChild(svgEl('rect', { class: 'vd-goma vd-goma-vacia', x: r.x, y: r.y, width: r.ancho, height: r.alto, rx: 6 }));
  const txt = (cls, y, s) => { const e = svgEl('text', { class: cls, x: r.x + r.ancho / 2, y }); e.textContent = s; g.appendChild(e); };
  txt('vd-pos', r.y + 12, r.auxilio ? 'AUX' : `P${r.posicion}`);
  txt('vd-mas', r.y + 33, '+');
  txt('vd-sim', r.y + 46, 'Vacía');
  svg.appendChild(g);
}

// Cada rueda devuelve su insignia de bandera (si la tiene): se dibujan todas al final para que ninguna rueda las tape.
function dibujarRueda(svg, r, banderas) {
  const { porPos } = datos;
  const fila = porPos.get(r.posicion);
  if (!fila) { dibujarRuedaVacia(svg, r); return; }
  const e = estadoDeFila(fila);
  const ind = banderaDeFila(fila);
  const sel = r.posicion === seleccion;
  const g = svgEl('g', {
    class: `vd-rueda est-${e.estilo}${sel ? ' sel' : ''}${coincideFiltro(fila) ? '' : ' dim'}`,
    tabindex: '0', role: 'button', 'aria-pressed': String(sel),
    'aria-label': etiquetaAria(r, e, ind, sel),
    'data-action': 'detalleRueda', 'data-args': JSON.stringify([r.posicion]), 'data-pos': String(r.posicion),
  });
  // TODO(neumet-web: TODO-TOOLTIP-FOCUS): el <title> SVG solo se ve al pasar el mouse; con teclado la misma información la
  // anuncia el aria-label. Un tooltip visible al enfocar exige un componente propio y no está definido en la spec (§5.2).
  const t = svgEl('title'); t.textContent = etiquetaTooltip(r, e, ind); g.appendChild(t);
  g.appendChild(svgEl('rect', { class: 'vd-goma', x: r.x, y: r.y, width: r.ancho, height: r.alto, rx: 6 }));
  const txt = (cls, y, s) => { const el = svgEl('text', { class: cls, x: r.x + r.ancho / 2, y }); el.textContent = s; g.appendChild(el); };
  // La etiqueta de posición baja a y+14: la insignia (metida 4 px en el borde superior) no debe cubrirla.
  txt('vd-pos', r.y + 14, r.auxilio ? 'AUX' : `P${r.posicion}`);
  txt('vd-mm', r.y + 31, nulo(e.mm) ? '—' : fmtMedida(e.mm));
  txt('vd-sim', r.y + 46, e.simbolo);
  svg.appendChild(g);
  if (ind.mayorAlNormal) banderas.push({ r, fila });
}

// Insignia de «Desgaste acelerado»: círculo r=8 con aro blanco, centrado a 4 px por encima del borde (metido 4 dentro).
function dibujarBandera(svg, { r, fila }) {
  const b = TOKENS.flag;
  const g = svgEl('g', { class: `vd-bandera${coincideFiltro(fila) ? '' : ' dim'}`, 'data-pos': String(r.posicion), 'aria-hidden': 'true' });
  const cx = r.x + r.ancho / 2, cy = r.y + b.overlapIntoTirePx - b.badgeDiameterPx / 2;
  g.appendChild(svgEl('circle', { cx, cy, r: b.badgeDiameterPx / 2 - b.ringPx / 2 }));
  const s = svgEl('text', { x: cx, y: cy + 3.6 }); s.textContent = BANDERA.simbolo; g.appendChild(s);
  svg.appendChild(g);
}

function dibujarDiagrama() {
  const { geo } = datos;
  const svg = svgEl('svg', { class: 'vd-svg', viewBox: `0 0 ${geo.ancho} ${geo.alto}`, role: 'group', 'aria-label': 'Vehículo visto desde arriba, con el frente hacia arriba. Cada rueda es un botón.' });
  const defs = svgEl('defs');
  // Rayado de «Sin datos» a 45°, grosor 1 y separación 5; los colores salen de las variables CSS (.vd-hatch-*).
  const pat = svgEl('pattern', { id: 'vd-sin-datos', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(svgEl('rect', { class: 'vd-hatch-fondo', width: 5, height: 5 }));
  pat.appendChild(svgEl('line', { class: 'vd-hatch-raya', x1: 0, y1: 0, x2: 0, y2: 5 }));
  defs.appendChild(pat); svg.appendChild(defs);
  const banderas = [];
  const c = geo.chasis;
  svg.appendChild(svgEl('rect', { class: 'vd-chasis', x: c.x, y: c.y, width: c.ancho, height: c.alto, rx: 10 }));
  svg.appendChild(svgEl('rect', { class: 'vd-cabina', x: geo.cabina.x, y: geo.cabina.y, width: geo.cabina.ancho, height: geo.cabina.alto, rx: 10 }));
  const frente = svgEl('text', { class: 'vd-txt-suave', x: c.x + c.ancho / 2, y: c.y + 27, 'text-anchor': 'middle' }); frente.textContent = 'FRENTE'; svg.appendChild(frente);
  geo.ejes.forEach(e => {
    const delEje = geo.ruedas.filter(r => r.eje === e.eje);
    const x1 = Math.min(...delEje.map(r => r.x + r.ancho / 2)), x2 = Math.max(...delEje.map(r => r.x + r.ancho / 2));
    svg.appendChild(svgEl('line', { class: 'vd-eje', x1, y1: e.y, x2, y2: e.y }));
  });
  geo.ruedas.forEach(r => dibujarRueda(svg, r, banderas));
  if (geo.auxilios.length) {
    const a = geo.auxilios[0];
    const et = svgEl('text', { class: 'vd-txt-suave', x: a.x + a.ancho / 2, y: a.y - 8, 'text-anchor': 'middle' }); et.textContent = 'AUXILIO'; svg.appendChild(et);
    geo.auxilios.forEach(r => dibujarRueda(svg, r, banderas));
  }
  banderas.forEach(b => dibujarBandera(svg, b));
  $('vd-diagrama').replaceChildren(svg);
}

// ── Panel del neumático ──
function frase(nombre, semanas, yaPaso) {
  if (yaPaso) return html`<li>${nombre}: ya se alcanzó.</li>`;
  if (nulo(semanas)) return '';
  return html`<li>${nombre}: en unas ${fmtNum(semanas, 1)} semanas.</li>`;
}

function seccionMedicion(fila) {
  if (!fila || nulo(huellaMinima(fila))) return html`<p class="vd-p-nota">Este neumático todavía no tiene mediciones completas (faltan huellas).</p>`;
  // Encabezados cortos: a 390 px la palabra «Promedio» se parte («PROMEDI» / «O»). El texto visible es «Prom.»; el nombre
  // accesible sigue siendo «Promedio» (aria-label), y la nota de abajo explica que es informativo.
  return html`<table class="vd-mm-tabla"><thead><tr><th scope="col">Interna</th><th scope="col">Centro</th><th scope="col">Externa</th><th scope="col">Mínimo</th><th scope="col" title="Promedio" aria-label="Promedio">Prom.</th></tr></thead>
    <tbody><tr><td>${fmtMedida(fila.mm1)}</td><td>${fmtMedida(fila.mm2)}</td><td>${fmtMedida(fila.mm3)}</td><td>${fmtMedida(huellaMinima(fila))}</td><td>${fmtMedida(fila.promedio)}</td></tr></tbody></table>
    <p class="vd-p-nota">El mínimo decide el estado; el promedio es informativo.</p>
    <p class="vd-p-nota">Medido el ${fmtFecha(fila.ultima_medicion_at)}${!nulo(fila.odometro_km) ? html` · ${fmtNum(fila.odometro_km)} km` : ''}</p>`;
}

function seccionTasa(fila, u, razonMostrada) {
  if (!fila || nulo(huellaMinima(fila))) return '';
  const tasa = fila.tasa_mm_semana;
  if (nulo(tasa)) return html`<p class="vd-p-nota">Mediciones insuficientes para calcular la velocidad de desgaste (se necesitan dos fechas distintas en los últimos 90 días).</p>`;
  if (Number(tasa) <= 0) return html`<p class="vd-p-texto">El desgaste no avanza en las últimas mediciones (${fmtNum(tasa, 2)} mm por semana).</p>`;
  // El «ya se alcanzó» sale del mismo estado que el resto de la pantalla (wearStatus por huella mínima), no de otra comparación.
  const est = wearStatus(huellaMinima(fila), datos.th);
  const yaCritico = est === 'mayor' || est === 'limite', yaRetiro = est === 'limite';
  return html`${razonMostrada ? '' : html`<p class="vd-p-texto">Se gasta ${fmtNum(tasa, 2)} mm por semana.</p>`}
    <ul class="vd-alertas">${frase(`${ESTADOS.poco.texto} / ${ESTADOS.mayor.texto.toLowerCase()} (${fmtNum(u.critico, 1)} mm)`, fila.semanas_hasta_critico, yaCritico)}${frase(`${ESTADOS.limite.texto} (${fmtNum(u.retiro, 1)} mm)`, fila.semanas_hasta_retiro, yaRetiro)}</ul>`;
}

// Datos propios del neumático montado: número de quema y km (previos + tramos montados, calculados en v_km_cubierta).
function seccionNeumatico(fila) {
  const n = fila && !nulo(fila.neumatico_id) ? datos.neumPorId.get(fila.neumatico_id) : null;
  if (!n) return html`<p class="vd-p-nota">${ESTADOS.sinDatos.texto} del neumático.</p>`;
  const k = resumenKm(datos.km.get(n.id));
  const dato = (t, v) => html`<div><dt>${t}</dt><dd>${v}</dd></div>`;
  const km = v => (v === null ? 'Sin dato' : `${fmtNum(v)} km`);
  return html`<dl class="vd-datos vd-datos-neum">
    ${dato('Número de quema', n.numero_quema || 'Sin registrar')}
    ${dato('Km que ya traía', `${fmtNum(n.km_previos || 0)} km`)}
    ${k.disponible ? html`${dato('Km recorridos', km(k.recorridos))}
    ${dato('En el tramo actual', km(k.tramoActual))}
    ${dato('Km totales', km(k.totales))}` : ''}
  </dl>${k.nota ? html`<p class="vd-p-nota">${k.nota}</p>` : ''}${seccionCosto(n)}`;
}

// Costo y costo por km del neumático (v_costo_cubierta). Sin fila (perfil de sucursal, vista no disponible): no se muestra.
function seccionCosto(n) {
  if (!puedeVerCostos()) return '';
  const c = resumenCosto(datos.costo.get(n.id));
  if (!c.disponible) return '';
  const dato = (t, v) => html`<div><dt>${t}</dt><dd>${v}</dd></div>`;
  return html`<dl class="vd-datos vd-datos-neum vd-costo">
    ${dato('Costo', c.textoCosto)}
    ${dato('Costo por km', c.textoCpk)}
  </dl>${c.nota ? html`<p class="vd-p-nota">${c.nota}</p>` : ''}
  ${puedeRegistrarCosto() ? html`<button type="button" class="btn ghost vd-costo-btn" data-action="detalleRegistrarCosto" data-args="[${n.id}]">Registrar costo</button>` : ''}`;
}

function etiquetasPanel(fila, r) {
  const tags = [];
  if (r && !r.auxilio) tags.push(html`<span class="vd-etiqueta vd-etiqueta-pos">P${r.posicion}</span>`);
  const detalle = [fila && fila.marca, fila && fila.modelo].filter(Boolean).join(' ');
  if (detalle) tags.push(html`<span class="vd-etiqueta vd-etiqueta-neum">${detalle}</span>`);
  if (fila && !nulo(fila.vida)) tags.push(html`<span class="vd-etiqueta vd-etiqueta-vida">${etiquetaVida(fila.vida)}</span>`);
  return joinHtml(tags);
}

function seccionAlertas(pos) {
  const al = datos.alertas.filter(a => Number(a.posicion) === pos).sort((a, b) => Number(b.severidad) - Number(a.severidad));
  if (!al.length) return html`<p class="vd-p-nota">Sin alertas activas.</p>`;
  const cls = { 3: 'red', 2: 'orange', 1: 'gray' }, sim = { 3: '✕', 2: '▲', 1: 'i' };
  return html`<ul class="vd-alertas">${al.map(a => html`<li>${chip(cls[a.severidad] || 'gray', severidadLabel(a.severidad), sim[a.severidad] || 'i')} ${a.mensaje}</li>`)}</ul>`;
}

// Mediciones con observaciones del neumático montado ahí (sospechosas e invalidadas) y acciones para resolverlas.
function seccionCalidad(pos) {
  const rows = datos.calPorPos.get(pos) || [];
  if (!rows.length) return '';
  return html`<h4>Calidad de las mediciones</h4>
    <p class="vd-p-nota">${textoObservaciones(rows.length)} · ${detalleObservaciones(rows)}</p>${listaCalidad(rows, { tipos: datos.tipos })}`;
}

// Indicador del vehículo: cuántas mediciones tienen observaciones, con el detalle desplegable.
function calidadVehiculo() {
  const el = $('vd-calidad');
  const obs = datos.obs;
  if (!obs.length) { el.replaceChildren(); return; }
  setHtml(el, html`<details class="cal-detalle"${calAbierto ? ' open' : ''}>
    <summary><strong>${textoObservaciones(obs.length)}</strong> <span class="cal-resumen">${detalleObservaciones(obs)}</span></summary>
    ${listaCalidad(obs, { tipos: datos.tipos })}</details>`);
}

// Eventos del neumático montado ahí (por id o idneumatico), no de quien ocupó antes la posición.
// Sin fila de neumático (posición solo medida) se cae a la posición.
function eventosDe(pos, fila) {
  const porNeumatico = fila && (!nulo(fila.neumatico_id) || fila.idneumatico);
  return datos.eventos.filter(e => porNeumatico
    ? (!nulo(fila.neumatico_id) && e.neumatico_id === fila.neumatico_id) || (fila.idneumatico && e.idneumatico === fila.idneumatico)
    : e.posicion_origen === pos || e.posicion_destino === pos).slice(0, 5);
}

function seccionEventos(pos, fila) {
  const ev = eventosDe(pos, fila);
  if (!ev.length) return html`<p class="vd-p-nota">Sin eventos registrados para este neumático.</p>`;
  return html`<ul class="vd-eventos">${ev.map(e => html`<li><strong>${fmtFecha(e.created_at)}</strong> · ${TIPO_LABEL[e.tipo] || e.tipo}${!nulo(e.odometro_km) ? html` · ${fmtNum(e.odometro_km)} km` : ''}${e.motivo_codigo ? html` · Motivo: ${etiquetaMotivo(datos.catalogoMotivos, e.motivo_codigo, e.motivo_texto)}` : ''}${e.notas ? html` · ${e.notas}` : ''}</li>`)}</ul>`;
}

// RN-08: bajo el límite de retiro (menos de 3 mm en una huella) la cubierta se retira ya y NO se rota a otro eje.
// Por eso no se ofrece «Rotar» ni se muestra el destino; el retiro sigue en un clic, como antes.
function acciones(pos, bajoRetiro = false) {
  if (!puedeOperar()) return '';
  const args = JSON.stringify([vehiculoId, pos]);
  const cambiar = html`<button type="button" class="btn primary" data-action="neumatico-cambiar" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}" data-args="${args}">Cambiar neumático</button>`;
  const retirar = html`<button type="button" class="btn${bajoRetiro ? ' primary' : ''}" data-action="neumatico-retirar" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}">Retirar neumático</button>`;
  if (bajoRetiro) return html`<div class="vd-pie"><p class="vd-p-razon"><strong>Retirar ya.</strong> Bajo el límite de retiro no se rota a otro eje (RN-08).</p><div class="vd-p-acciones">${retirar}${cambiar}</div></div>`;
  // Rotar abre el diálogo (motivo y odómetro). El botón lleva data-args='[vehiculoId, posA, posB]', que se actualiza al elegir el destino.
  const destinos = [...datos.layout.ruedas, ...datos.layout.auxilios].filter(r => r.posicion !== pos);
  const rotar = html`<div class="vd-rotar">
    <label for="vd-rotar-destino">Rotar con la posición</label>
    <select id="vd-rotar-destino" class="select-filter"><option value="">Elegir posición…</option>${destinos.map(r => html`<option value="${r.posicion}">${nombrePos(r.posicion, tipoLayout(datos.veh))}</option>`)}</select>
    <button type="button" class="btn" id="vd-rotar-btn" data-action="neumatico-rotar-pos" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}" data-destino="" data-args="${JSON.stringify([vehiculoId, pos, null])}">Rotar</button></div>`;
  return html`<div class="vd-pie"><div class="vd-p-acciones">${cambiar}${retirar}</div>${rotar}</div>`;
}

function renderPanel() {
  const body = $('vd-panel-body');
  if (nulo(seleccion)) {
    setHtml(body, html`<p class="vd-panel-vacio">Elegir una rueda del diagrama para ver su estado, mediciones y alertas.</p>`);
    return;
  }
  const pos = seleccion;
  const { u, porPos } = datos;
  const fila = porPos.get(pos);
  const r = [...datos.layout.ruedas, ...datos.layout.auxilios].find(x => x.posicion === pos);
  const ind = fila ? banderaDeFila(fila) : null;
  if (!fila) {
    setHtml(body, html`
      <div class="vd-p-head">
        <div><h3 id="vd-panel-titulo" tabindex="-1">${nombrePos(pos, tipoLayout(datos.veh))}</h3>
          <div class="vd-p-sub">${etiquetasPanel(null, r)}</div></div>
        <button type="button" class="vd-cerrar" data-action="detalleCerrarPanel" aria-label="Cerrar detalle de la posición"><span aria-hidden="true">&times;</span></button>
      </div>
      <div class="vd-p-scroll"><div class="vd-p-estado">${chip('gray', 'Vacía', '–')}</div>
        <p class="vd-p-texto">Sin neumático montado en esta posición.</p></div>
      ${puedeOperar() ? html`<div class="vd-pie"><div class="vd-p-acciones"><button type="button" class="btn primary" data-action="neumatico-montar" data-vehiculo-id="${vehiculoId}" data-posicion="${pos}">Montar neumático</button></div></div>` : ''}`);
    return;
  }
  setHtml(body, html`
    <div class="vd-p-head">
      <div><h3 id="vd-panel-titulo" tabindex="-1">${nombrePos(pos, tipoLayout(datos.veh))}</h3>
        <div class="vd-p-sub">${etiquetasPanel(fila, r)}</div></div>
      <button type="button" class="vd-cerrar" data-action="detalleCerrarPanel" aria-label="Cerrar detalle del neumático"><span aria-hidden="true">&times;</span></button>
    </div>
    <div class="vd-p-scroll">
    <div class="vd-p-estado">${tagEstado(estadoDeFila(fila).id)}${ind && ind.mayorAlNormal ? tagBandera() : ''}</div>
    ${ind && ind.mayorAlNormal ? html`<p class="vd-p-razon"><strong>${BANDERA.texto}.</strong> ${ind.razon}</p>` : ''}
    <h4>Neumático</h4>${seccionNeumatico(fila)}
    <h4>Última medición (mm)</h4>${seccionMedicion(fila)}
    <h4>Evolución del desgaste</h4><div id="vd-chart-wrap"><p class="vd-p-nota">Cargando mediciones…</p></div>
    <h4>Velocidad de desgaste</h4>${seccionTasa(fila, u, ind && ind.mayorAlNormal)}
    <h4>Alertas</h4>${seccionAlertas(pos)}
    ${seccionCalidad(pos)}
    <h4>Historial reciente</h4>${seccionEventos(pos, fila)}
    </div>
    ${acciones(pos, estadoDeFila(fila).id === 'limite')}`);
  cargarGrafico(pos);
}

async function medicionesDe(pos) {
  if (cacheMediciones.has(pos)) return cacheMediciones.get(pos);
  // Las mediciones son del neumático montado en esa posición (no de la posición): tras un cambio no se heredan
  // las del viejo y tras una rotación acompañan al neumático. La vista resuelve la atribución (docs/08).
  const { data, error } = await db.from('v_mediciones_neumatico').select('mm1,mm2,mm3,promedio,created_at')
    .eq('vehiculo_id', vehiculoId).eq('posicion_actual', pos).eq('estado_montaje', 'montado')
    .order('created_at', { ascending: false }).order('medicion_id', { ascending: false }).limit(200);
  if (error) throw error;
  cacheMediciones.set(pos, data || []);
  return data || [];
}

async function cargarGrafico(pos) {
  const mi = ++tokenGrafico;
  let med;
  try { med = await medicionesDe(pos); } catch (e) {
    if (mi === tokenGrafico && $('vd-chart-wrap')) setHtml($('vd-chart-wrap'), html`<p class="vd-p-nota">${userError(e)}</p>`);
    return;
  }
  const wrap = $('vd-chart-wrap');
  if (mi !== tokenGrafico || !wrap) return;
  const ancho = Math.max(280, Math.min(720, Math.round(wrap.clientWidth || 480)));
  const d = datosGrafico(serieDesgaste(med), datos.th, { ancho, alto: TOKENS.chart.heightPx });
  if (!d) { setHtml(wrap, html`<p class="vd-p-nota">Sin mediciones para graficar.</p>`); return; }
  const lugar = nombrePos(pos, tipoLayout(datos.veh));
  const det = document.createElement('div');
  setHtml(det, tablaDatos(d));
  const desplegable = det.querySelector('details');
  desplegable.addEventListener('toggle', () => { det.querySelector('.vd-ver-datos').textContent = desplegable.open ? 'Ocultar datos' : 'Ver datos'; });
  wrap.replaceChildren(construirGrafico(d, lugar), det);
}

// «Ver datos» / «Ocultar datos»: la misma serie del gráfico en una tabla, para quien no ve el gráfico.
function tablaDatos(d) {
  const filas = [...d.puntos].reverse().map(p => html`<tr><td>${fmtFecha(p.fecha)}</td><td>${fmtMedida(p.mm1)}</td><td>${fmtMedida(p.mm2)}</td><td>${fmtMedida(p.mm3)}</td><td>${fmtMedida(p.valor)}</td><td>${ESTADOS[p.estado].texto}</td></tr>`);
  return html`<details class="vd-datos-det"><summary><span class="vd-ver-datos">Ver datos</span></summary>
    <div class="vd-datos-scroll"><table class="vd-datos-tabla"><caption class="sr-only">Mediciones del neumático, en milímetros</caption>
    <thead><tr><th scope="col">Fecha</th><th scope="col">Interna</th><th scope="col">Centro</th><th scope="col">Externa</th><th scope="col">Promedio</th><th scope="col">Estado</th></tr></thead>
    <tbody>${filas}</tbody></table></div></details>`;
}

function construirGrafico(d, lugar) {
  const pn = d.puntos[d.puntos.length - 1];
  const svg = svgEl('svg', { class: 'vd-chart', viewBox: `0 0 ${d.ancho} ${d.alto}`, role: 'img',
    'aria-label': `Evolución del desgaste de ${lugar}: ${plural(d.puntos.length, 'lectura', 'lecturas')}, última ${fmtMedida(pn.valor)} mm el ${fmtFecha(pn.fecha)}, estado ${ESTADOS[pn.estado].texto.toLowerCase()}` });
  const { x0, x1 } = d.area;
  // Bandas por estado (las del modelo): el color es de fondo, el rótulo con texto dice el estado; nunca solo color.
  d.bandas.forEach(b => {
    svg.appendChild(svgEl('rect', { class: `vd-g-banda est-${b.estilo}`, x: x0, y: b.y, width: x1 - x0, height: b.alto }));
  });
  d.eje.marcas.forEach(t => {
    svg.appendChild(svgEl('line', { class: 'vd-g-grid', x1: x0, y1: t.y, x2: x1, y2: t.y }));
    const e = svgEl('text', { class: 'vd-g-eje', x: x0 - 6, y: t.y + 4, 'text-anchor': 'end' }); e.textContent = fmtNum(t.mm); svg.appendChild(e);
  });
  d.ejeX.forEach((t, i) => {
    const e = svgEl('text', { class: 'vd-g-eje', x: t.x, y: d.alto - 8, 'text-anchor': d.unico ? 'middle' : (i === 0 ? 'start' : 'end') }); e.textContent = t.texto; svg.appendChild(e);
  });
  if (d.linea) svg.appendChild(svgEl('path', { class: 'vd-g-serie', d: d.linea }));
  // Los rótulos van antes de los puntos y en un sitio sin puntos (domain/grafico-desgaste.js): ningún punto los tapa (U3).
  d.bandas.filter(b => b.rotuloVisible).forEach(b => {
    const e = svgEl('text', { class: `vd-g-rotulo est-${b.estilo}`, x: b.rotuloX, y: b.rotuloY + 4, 'text-anchor': b.rotuloAncla }); e.textContent = b.rotulo; svg.appendChild(e);
  });
  d.puntos.forEach(p => {
    const c = svgEl('circle', { class: `vd-g-punto est-${p.estilo}`, cx: p.x, cy: p.y, r: p.ultimo ? TOKENS.chart.lastPointRadiusPx : TOKENS.chart.pointRadiusPx });
    const t = svgEl('title'); t.textContent = tooltipPunto(p); c.appendChild(t); svg.appendChild(c);
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
  escribirUrl();
  $('vd-panel').classList.add('abierto'); $('vd-backdrop').classList.add('abierto');
  const tit = $('vd-panel-titulo');
  if (tit) tit.focus();
  // El panel solo se desplaza si su inicio quedó fuera de la vista (docs/21 §5.6): si ya se ve, mover la página deja el
  // título bajo la barra superior. Sin animación si la persona pidió menos movimiento.
  const panel = $('vd-panel');
  if (panel && panel.scrollIntoView) {
    const barra = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vd-topbar')) || 0;
    const arriba = panel.getBoundingClientRect().top;
    if (arriba < barra || arriba > window.innerHeight) {
      const quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'start', behavior: quieto ? 'auto' : 'smooth' });
    }
  }
}

function cerrarPanel() {
  const pos = seleccion;
  seleccion = null; tokenGrafico++;
  $('vd-panel').classList.remove('abierto'); $('vd-backdrop').classList.remove('abierto');
  document.querySelectorAll('#vd-diagrama .vd-rueda').forEach(g => { g.classList.remove('sel'); g.setAttribute('aria-pressed', 'false'); });
  renderPanel();
  escribirUrl();
  // Si el diagrama se redibujó (p. ej. tras un cambio de neumático), se busca la rueda por posición.
  const destino = ultimoFoco && ultimoFoco.isConnected ? ultimoFoco : document.querySelector(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  if (destino) destino.focus();
  ultimoFoco = null;
}

export async function load() {
  if (nulo(vehiculoId)) {
    const { vehiculo, pos } = leerUrl();
    if (vehiculo) {
      vehiculoId = Number(vehiculo);
      preseleccion = nulo(pos) ? null : Number(pos);
      entradaPorUrl = true;
    } else { switchView('inicio'); return; }
  }
  const miCarga = ++tokenCarga;
  setHtml($('vd-cab'), estadoCarga('Cargando el vehículo…'));
  $('vd-resumen').replaceChildren(); $('vd-diagrama').replaceChildren(); $('vd-calidad').replaceChildren();
  await contextoListo();
  // Miga al origen mientras cargan los datos; cabecera() la actualizará con el nombre real.
  setTitulo('Vehículo', origen);
  cacheMediciones.clear();   // tras cambiar o rotar, cada posición tiene otro neumático
  const [v, est, al, ev, nm, kc, cc, cal] = await Promise.all([
    db.from('vehiculos').select(SEL_VEHICULO).eq('id', vehiculoId).maybeSingle(),
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_alertas').select('*').eq('vehiculo_id', vehiculoId).order('severidad', { ascending: false }),
    db.from('eventos_neumatico').select('id,neumatico_id,idneumatico,tipo,posicion_origen,posicion_destino,odometro_km,notas,created_at,motivo_codigo,motivo_texto')
      .eq('vehiculo_id', vehiculoId).order('created_at', { ascending: false }).limit(100),
    db.from('neumaticos').select('id,posicion,estado,numero_quema,km_previos').eq('vehiculo_id', vehiculoId),
    // Km por cubierta (previos + tramos montados, incluidos los de otros vehículos). Si falla, el panel omite los km.
    db.from('v_km_cubierta').select(COLUMNAS_KM).eq('vehiculo_id', vehiculoId),
    // Costo y costo por km (v_costo_cubierta): solo administrador y perfil global; el de sucursal no ve costos.
    puedeVerCostos() ? db.from('v_costo_cubierta').select(COLUMNAS_COSTO).eq('vehiculo_id', vehiculoId) : Promise.resolve({ data: [], error: null }),
    // Si falla (p. ej. migración de calidad sin aplicar) el detalle sigue sin el indicador.
    db.from('mediciones').select(SEL_CALIDAD).eq('vehiculo_id', vehiculoId).in('calidad', ['sospechosa', 'invalidada'])
      .order('created_at', { ascending: false }).limit(200),
  ]);
  if (miCarga !== tokenCarga) return;
  if (v.error || est.error || al.error) { showToast(userError(v.error || est.error || al.error), true); setHtml($('vd-cab'), estadoError('', 'recargarVehiculoDetalle')); return; }
  if (!v.data) {
    if (entradaPorUrl) { limpiarUrl(); switchView('inicio'); return; }
    setHtml($('vd-cab'), estadoVacio('Vehículo no encontrado', 'Puede que ya no exista o que falte acceso.', { label: `Volver a ${etiquetaVista(origen)}`, action: 'irA', args: [origen], primaria: true }));
    return;
  }
  // El historial muestra el motivo con su etiqueta. Si el catálogo no carga, se ve el código (la base no cambia).
  const motivos = await cargarMotivosCliente(v.data.cliente_id);
  if (miCarga !== tokenCarga) return;
  const filas = (est.rows || []).filter(f => String(f.vehiculo_id) === String(vehiculoId));
  const ref = referenciaTasas(filtrarFilas(est.rows || []));
  const posiciones = filas.map(f => f.posicion);
  const layout = layoutRuedas(posiciones, tipoLayout(v.data));
  const obs = cal.error ? [] : soloObservadas(cal.data || []);
  const u = umbralesDe(filas[0]); // los umbrales son del cliente (umbral_bajo / critico / retiro_mm), nunca números fijos
  datos = {
    obs, calPorPos: agruparPorNeumatico(obs, filas).porPosicion, tipos: new Map([[v.data.id, tipoLayout(v.data)]]),
    veh: v.data, filas, alertas: al.data || [], eventos: ev.error ? [] : (ev.data || []), ref, catalogoMotivos: motivos ? motivos.catalogo : [],
    neumPorId: new Map((nm.error ? [] : (nm.data || [])).map(n => [n.id, n])),
    km: indexarKm(kc.error ? [] : kc.data),
    costo: indexarCostos(cc.error ? [] : cc.data),
    layout, geo: geometriaDiagrama(layout), u, th: umbralesEstado(u), porPos: new Map(filas.map(f => [Number(f.posicion), f])),
  };
  cabecera(); resumen(); dibujarDiagrama(); calidadVehiculo();
  if (!nulo(seleccion) && !datos.porPos.has(seleccion)) {
    // La posición quedó vacía (retiro) o ya no existe: se cierra el panel (en móvil también la hoja inferior).
    seleccion = null;
    $('vd-panel').classList.remove('abierto'); $('vd-backdrop').classList.remove('abierto');
  }
  renderPanel();
  if (!nulo(focoTrasCarga)) {
    const g = document.querySelector(`#vd-diagrama .vd-rueda[data-pos="${focoTrasCarga}"]`);
    focoTrasCarga = null;
    if (g) g.focus();
  }
  if (!nulo(preseleccion)) { const p = preseleccion; preseleccion = null; if (datos.porPos.has(p)) seleccionarRueda(p); }
}

registerActions({
  verVehiculoDetalle: id => abrirDetalle(Number(id)),
  // Segundo argumento opcional: posición de la rueda que queda seleccionada al abrir (enlaces de Inicio).
  verVehiculo: (id, pos) => abrirDetalle(Number(id), pos),
  detalleRueda: pos => seleccionarRueda(pos),
  // Un chip activo se vuelve a tocar para quitar el filtro; el chip del total (sin argumento) lo limpia.
  detalleFiltro: clave => { if (!datos) return; filtro = clave && clave !== filtro ? clave : null; aplicarFiltro(); },
  detalleCerrarPanel: () => cerrarPanel(),
  detalleRegistrarCosto: id => {
    const n = datos && datos.neumPorId.get(Number(id));
    const fila = datos && datos.filas.find(f => Number(f.neumatico_id) === Number(id));
    const etiqueta = [fila && fila.marca, fila && fila.modelo].filter(Boolean).join(' ') || 'Neumático';
    abrirRegistroCosto({ neumaticoId: Number(id), etiqueta: `${etiqueta}${n && n.numero_quema ? ` · quema ${n.numero_quema}` : ''}`, alGuardar: () => load() });
  },
  recargarVehiculoDetalle: () => { cacheMediciones.clear(); return load(); },
});

export function init() {
  // Al salir del detalle se limpia el query de posición para no arrastrarlo a otras vistas.
  onSalirVista((anterior) => { if (anterior === 'vehiculo-detalle') limpiarUrl(); });
  // Si el usuario llegó con ?vehiculo=ID pero navegó a otra vista sin pasar por el detalle,
  // el query queda huérfano: se limpia al entrar a cualquier otra vista.
  onEntrarVista((v) => { if (v !== 'vehiculo-detalle') limpiarUrl(); });
  // Tras rotar o cambiar, el detalle se recarga y el foco caería en <body>: se devuelve a la rueda de origen.
  document.addEventListener('neumet:neumatico-cambiado', e => {
    const d = e.detail || {};
    if (Number(d.vehiculoId) !== Number(vehiculoId)) return; // el evento de otro vehículo no mueve el foco de este
    if (!$('view-vehiculo-detalle').classList.contains('active')) return;
    focoTrasCarga = d.rotacion ? d.rotacion[0] : (d.posicion ?? null);
  });
  // El evento «toggle» no burbujea: se escucha en captura para recordar si el detalle está desplegado.
  $('vd-calidad').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('cal-detalle')) calAbierto = e.target.open; }, true);
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
    if (b.dataset.action === 'neumatico-rotar-pos' && !b.dataset.destino) { e.stopPropagation(); showToast('Elegir la posición de destino de la rotación', true); }
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

registerView('vehiculo-detalle', 'Vehículo', load, { menu: 'vehiculos' });
