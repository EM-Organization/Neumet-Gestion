// Inicio: panel de decisión. Lo urgente arriba (requieren atención, próximos cambios), el resumen de la flota, las últimas
// mediciones y enlace directo al detalle de cada vehículo. El buscador de vehículos es el de la barra superior. Usa las vistas SQL v_estado_neumaticos,
// v_alertas y v_salud_dispositivos y la función ultimas_mediciones (security invoker: la RLS decide qué ve cada rol; la
// sucursal elegida se aplica además aquí). Los dispositivos solo se gestionan desde administración.
import { tipoLayout } from '../domain/distribucion.js';
import { ESTADOS, estadoDeBase } from '../domain/estado-desgaste.js';
import { estadoContable } from '../domain/auxilio.js';
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate, setStatus } from '../core/ui.js';
import { isClienteMode, currentClienteNombre, currentSucursalId, esUsuarioSucursal } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { contextoListo, filtrarFilas, filtrarConsulta, hayFiltroSeccional, sucursalSeleccionada, nombreSucursal } from '../core/seccional.js';
import { registerActions } from '../core/actions.js';
import { enSucursal, AYUDA_TODAS_SUCURSALES } from '../domain/seccional.js';
import { chip, estadoVacio, estadoCarga, estadoError, miniVehiculo } from '../core/componentes.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  estadoInicio, resumenNeumaticos, requierenAtencion, proximosCambios, resumenDispositivos, ultimaMedicion,
  clientesConUrgencias, textoSemanas, ultimasMediciones, MAX_ULTIMAS, cifrasVisibles, peorCambio,
} from '../domain/inicio.js';
import { fmtNum, fmtFecha, fmtFechaLarga, plural } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, resumenPosiciones, modeloMini, agruparPorVehiculo } from '../domain/posicion.js';
import { textoAvisoInicio } from '../domain/calidad.js';
import { sinReconocer, partesRecuadro } from '../domain/alertas.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 20000;

const verVehiculo = id => JSON.stringify([id]);
const matricula = p => (p ? html`<span class="dash-fleet-pat">${p}</span>` : '');

// Botón «Ver coche 106»: abre el detalle del vehículo y, si se indica, deja seleccionada esa rueda.
const textoVer = nombre => { const t = etiquetaCoche(nombre); return /^Coche /.test(t) ? `Ver coche ${t.slice(6)}` : 'Ver vehículo'; };
const botonVer = (v, pos) => html`<button type="button" class="inicio-ver" data-action="verVehiculo" data-args="${JSON.stringify(pos == null ? [v.vehiculo_id] : [v.vehiculo_id, pos])}">${textoVer(v.nombre)}</button>`;

// Mini vehículo de un vehículo con sus ruedas coloreadas; `filas` = v_estado_neumaticos de ese vehículo.
// tipo_ruedas por vehículo (el estado de neumáticos no lo trae): define el chasis dibujado y el nombre de la posición.
let tipos = new Map();
let filtroSucursal = ''; // nombre de la sucursal elegida en la barra (vacío = todas); solo para nombrarla en los estados vacíos
const tipoDe = id => tipos.get(id);
const miniDe = (filas, destacadas, id) => miniVehiculo(modeloMini(filas, { destacadas, tipo: tipoDe(id) }));

// Fila con mini vehículo: [mini] [nombre, detalle, posiciones] [dato] [Ver coche N]. `extra` va bajo el texto.
function filaMini(v, filas, { destacadas = [], detalle, pos = '', dato = '', extra = '', cls = '', nivel = '' }) {
  return html`<li class="inicio-fila inicio-fila-mini ${cls}">
    ${miniDe(filas, destacadas, v.vehiculo_id)}
    <div class="inicio-fila-txt"><span class="inicio-fila-nom">${nivel === 'limite' ? html`<span class="inicio-punto limite" aria-hidden="true"></span>` : ''}${etiquetaCoche(v.nombre)} ${matricula(v.patente)}</span>
      ${detalle ? html`<span class="inicio-fila-causa">${nivel === 'limite' ? html`<span class="sr-only">${ESTADOS.limite.texto}: </span>` : ''}${detalle}</span>` : ''}
      ${pos ? html`<span class="inicio-fila-pos">${pos}</span>` : ''}${extra}</div>
    ${dato}${botonVer(v, destacadas.length ? destacadas[0] : null)}</li>`;
}

function filaAtencion(v, porVeh) {
  const filas = porVeh.get(v.vehiculo_id) || [];
  return filaMini(v, filas, { destacadas: v.posiciones, detalle: v.causa, pos: resumenPosiciones(v.posiciones, tipoDe(v.vehiculo_id)), nivel: v.nivel === 'limite' ? 'limite' : '' });
}

function filaProximo(p, porVeh) {
  const filas = porVeh.get(p.vehiculo_id) || [];
  return filaMini(p, filas, {
    destacadas: [p.posicion], detalle: `${nombrePosicion(p.posicion, tipoDe(p.vehiculo_id))}${p.mm !== null ? ` · ${fmtNum(p.mm, 1)} mm` : ''}`,
    dato: html`<span class="inicio-semanas">${textoSemanas(p.semanas)}</span>`,
  });
}

function filaCliente(r) {
  return html`<li><button type="button" class="inicio-fila" data-action="abrirFichaCliente" data-args="${JSON.stringify([r.cliente_id])}">
    <span class="inicio-fila-txt"><span class="inicio-fila-nom">${r.nombre}</span>
      <span class="inicio-fila-causa">${plural(r.n_critico, 'neumático en desgaste límite', 'neumáticos en desgaste límite')} · ${plural(r.n_alertas_sev3, 'alerta de desgaste límite', 'alertas de desgaste límite')}</span></span>
    <span class="inicio-fila-ir" aria-hidden="true">›</span></button></li>`;
}

const segmento = (cls, pct, etiqueta) => (pct > 0 ? html`<span class="inicio-seg ${cls}" style="width:${pct}%" title="${etiqueta}"></span>` : '');
const cifra = (cls, n, etiqueta) => html`<li class="inicio-cifra"><span class="inicio-punto ${cls}" aria-hidden="true"></span><strong>${fmtNum(n)}</strong> ${etiqueta}</li>`;

const bajo = e => e.texto.toLowerCase();

// Una cifra por estado, por clave de resumenNeumaticos. Las que valen 0 no se dibujan (cifrasVisibles, domain/inicio.js).
const cifrasDe = rs => ({
  nuevo: cifra('ok', rs.nuevo, bajo(ESTADOS.bueno)),
  poco_desgaste: cifra('bajo', rs.poco_desgaste, bajo(ESTADOS.poco)),
  mayor_desgaste: cifra('mayor', rs.mayor_desgaste, bajo(ESTADOS.mayor)),
  desgaste_limite: cifra('limite', rs.desgaste_limite, bajo(ESTADOS.limite)),
  desconocido: cifra('neutral', rs.desconocido, bajo(ESTADOS.sinDatos)),
});

function bloqueResumen(rs, ult) {
  const buenos = rs.nuevo + rs.poco_desgaste;
  // «en buen estado o con poco desgaste»: la suma lleva «con» antes del segundo nombre.
  const buenoOPoco = `${ESTADOS.bueno.texto.toLowerCase()} o con ${ESTADOS.poco.texto.toLowerCase()}`;
  const frase = buenos === rs.total ? `Los ${fmtNum(rs.total)} neumáticos están en ${buenoOPoco}` : `${fmtNum(buenos)} de ${fmtNum(rs.total)} neumáticos están en ${buenoOPoco}`;
  const { claves, vacio } = cifrasVisibles(rs);
  const cifras = cifrasDe(rs);
  return html`<section class="inicio-card" aria-labelledby="inicio-h-resumen">
    <div class="inicio-resumen-cab"><h3 id="inicio-h-resumen" class="inicio-h">${frase}</h3>
      ${ult ? html`<span class="inicio-meta">Última medición ${relDate(ult)}</span>` : ''}</div>
    <div class="inicio-barra" role="img" aria-label="${`${ESTADOS.bueno.texto} ${rs.nuevo}, ${bajo(ESTADOS.poco)} ${rs.poco_desgaste}, ${bajo(ESTADOS.mayor)} ${rs.mayor_desgaste}, ${bajo(ESTADOS.limite)} ${rs.desgaste_limite}, ${bajo(ESTADOS.sinDatos)} ${rs.desconocido}`}">
      ${segmento('ok', rs.pct.nuevo, ESTADOS.bueno.texto)}${segmento('bajo', rs.pct.poco_desgaste, ESTADOS.poco.texto)}${segmento('mayor', rs.pct.mayor_desgaste, ESTADOS.mayor.texto)}${segmento('limite', rs.pct.desgaste_limite, ESTADOS.limite.texto)}${segmento('neutral', rs.pct.desconocido, ESTADOS.sinDatos.texto)}</div>
    ${vacio ? html`<p class="inicio-linea">Sin neumáticos medidos</p>` : html`<ul class="inicio-cifras">${joinHtml(claves.map(k => cifras[k]))}</ul>`}
  </section>`;
}

function bloqueAtencion(at, alertas, porVeh) {
  const abiertas = sinReconocer(alertas);
  const recuadro = partesRecuadro(alertas).map((p, i) => html`${i ? ' · ' : ''}${chip(p.color, p.texto, p.simbolo)}`);
  return html`<section class="inicio-card" aria-labelledby="inicio-h-atencion">
    <h3 id="inicio-h-atencion" class="inicio-h">Requieren atención</h3>
    ${recuadro.length ? html`<p class="inicio-linea">${recuadro}</p>` : ''}
    ${at.items.length
      ? html`<ul class="inicio-lista">${joinHtml(at.items.map(v => filaAtencion(v, porVeh)))}</ul>${at.total > at.items.length ? html`<p class="inicio-meta">${at.total - at.items.length} más en Alertas.</p>` : ''}`
      : estadoVacio('Ningún vehículo requiere atención.')}
    <button type="button" class="inicio-enlace" data-action="alertasVerAbiertas">Ver alertas abiertas (${fmtNum(abiertas)}) ›</button>
  </section>`;
}

function bloqueProximos(px, porVeh) {
  return html`<section class="inicio-card" aria-labelledby="inicio-h-proximos">
    <h3 id="inicio-h-proximos" class="inicio-h">Próximos cambios</h3>
    ${px.items.length
      ? html`<ul class="inicio-lista">${joinHtml(px.items.map(p => filaProximo(p, porVeh)))}</ul>${px.total > px.items.length ? html`<p class="inicio-meta">${px.total - px.items.length} más.</p>` : ''}`
      : estadoVacio('Ningún neumático cerca del desgaste límite.')}
  </section>`;
}

// El cliente ve el estado de sus equipos como dato (sin enlace: no gestiona hardware); administración abre Dispositivos.
function lineaDispositivos(d, cliente) {
  const enlace = txt => (cliente ? txt : html`<button type="button" class="inicio-enlace" data-action="irA" data-args='["dispositivos"]'>${txt} ›</button>`);
  if (!d.total) return cliente ? '' : html`<p class="inicio-linea">Sin dispositivos registrados. ${enlace('Ver dispositivos')}</p>`;
  return html`<p class="inicio-linea">Dispositivos: ${fmtNum(d.activos)} de ${fmtNum(d.total)} activos${d.inactivos
    ? html` · ${enlace(plural(d.inactivos, 'sin actividad', 'sin actividad'))}` : ''}</p>`;
}

const signo = dif => (dif > 0 ? '+' : dif < 0 ? '\u2212' : '');
const textoDif = dif => `${signo(dif)}${fmtNum(Math.abs(dif), 1)}`;

// Una fila por vehículo: su peor cambio (posición, estado y caída en mm) y la fecha de la medición. «Ver coche N» abre la
// ficha con esa rueda seleccionada. Los mm son promedios de la visita, no huellas: por eso el bloque lleva el «(informativo)».
const textoPeorCambio = (p, tipo) => [
  nombrePosicion(p.posicion, tipo), ESTADOS[p.estado].texto,
  p.comparativa ? `${textoDif(p.comparativa.dif)} mm` : 'Sin medición previa',
].join(' · ');

function filaMedida(v, porVeh) {
  // Colores del estado actual del vehículo (v_estado_neumaticos, con las tres huellas). Si el vehículo no tiene filas ahí,
  // solo se conoce la posición: no hay huellas, así que no hay mínimo ni estado y el mini sale sin color (RN-01).
  const filasEstado = porVeh.get(v.vehiculo_id) || [];
  const filas = filasEstado.length ? filasEstado : v.neumaticos.map(n => ({ posicion: n.posicion }));
  const estadoDe = pos => {
    const f = filasEstado.find(x => Number(x.posicion) === Number(pos));
    return f ? estadoDeBase(estadoContable(f)) : 'sinDatos';
  };
  const peor = peorCambio(v.neumaticos.map(n => ({ posicion: n.posicion, estado: estadoDe(n.posicion), comparativa: n.comparativa })));
  const coche = v.numero && etiquetaCoche(v.numero) !== etiquetaCoche(v.nombre) ? `Coche ${v.numero} · ` : '';
  return filaMini(v, filas, {
    destacadas: peor ? [peor.posicion] : [], detalle: peor ? textoPeorCambio(peor, tipoDe(v.vehiculo_id)) : '',
    pos: `${coche}${fmtFecha(v.medido_at)}`,
  });
}

// `ultimas` = filas de ultimas_mediciones; null si la consulta falló (el resto de Inicio sigue mostrándose).
// Estado vacío que, con una sucursal elegida, la nombra y dice cómo ver el resto (docs/14 §1).
const vacioFiltrado = (titulo, ayuda) => (filtroSucursal
  ? estadoVacio(enSucursal(titulo.replace(/ registradas?$/, ''), filtroSucursal), AYUDA_TODAS_SUCURSALES)
  : estadoVacio(titulo, ayuda));

function bloqueUltimas(ultimas, porVeh) {
  const lista = ultimas === null ? [] : ultimasMediciones(ultimas);
  return html`<section class="inicio-card" aria-labelledby="inicio-h-ultimas">
    <h3 id="inicio-h-ultimas" class="inicio-h">Últimas mediciones</h3>
    ${ultimas === null ? estadoError('', 'loadInicio')
      : lista.length ? html`<ul class="inicio-lista">${joinHtml(lista.map(v => filaMedida(v, porVeh)))}</ul>
        <p class="inicio-meta">Peor cambio de cada vehículo frente a su medición anterior, en mm de promedio (informativo).</p>`
      : vacioFiltrado('Sin mediciones registradas')}
  </section>`;
}

// Aviso sobrio y solo si hay mediciones sospechosas por resolver; lleva a la lista de revisión.
function avisoRevision(n) {
  const t = textoAvisoInicio(n);
  return t ? html`<p class="inicio-aviso" role="status">${t}. <button type="button" class="inicio-enlace" data-action="irA" data-args='["calidad"]'>Revisar ›</button></p>` : '';
}

// Orden: Requieren atención (todo el ancho), aviso de revisión, Próximos cambios y resumen de la flota (dos columnas),
// Últimas mediciones y, al final, clientes y dispositivos.
export function render(datos) {
  tipos = datos.tiposRuedas || new Map();
  filtroSucursal = datos.sucursal || '';
  const estado = estadoInicio(datos);
  if (estado !== 'con_datos') return html`${avisoRevision(datos.revision)}${estadoSinFlota(datos, estado)}`;
  return contenidoFlota(datos);
}

// Estados sin neumáticos que mostrar: sin vehículos, o con vehículos pero sin mediciones.
function estadoSinFlota({ vehiculosTotal = 0 }, estado) {
  const cliente = isClienteMode();
  if (estado === 'vacio') {
    if (filtroSucursal) return vacioFiltrado('Sin vehículos registrados');
    return estadoVacio('Sin vehículos registrados',
      cliente ? 'Los vehículos aparecerán aquí cuando se registren y se midan.' : 'Registrar un cliente, cargar sus vehículos y asignar un dispositivo.',
      cliente ? null : { label: 'Ir a Clientes', action: 'irA', args: ['clientes'], primaria: true });
  }
  if (filtroSucursal && !vehiculosTotal) return vacioFiltrado('Sin mediciones registradas');
  return estadoVacio(vehiculosTotal ? `${plural(vehiculosTotal, 'vehículo registrado', 'vehículos registrados')}, sin mediciones` : 'Sin mediciones registradas',
    'El estado de los neumáticos se muestra desde la primera medición.',
    cliente ? null : { label: 'Ver dispositivos', action: 'irA', args: ['dispositivos'], primaria: true });
}

function contenidoFlota({ estadoRows, alertas, salud, resumen, ultimas = [], revision }) {
  const cliente = isClienteMode();
  const rs = resumenNeumaticos(estadoRows);
  const at = requierenAtencion(estadoRows);
  const px = proximosCambios(estadoRows);
  const clientes = !cliente ? clientesConUrgencias(resumen) : [];
  const porVeh = agruparPorVehiculo(estadoRows);
  return html`${bloqueAtencion(at, alertas, porVeh)}
    ${avisoRevision(revision)}
    <div class="inicio-cols">${bloqueProximos(px, porVeh)}${bloqueResumen(rs, ultimaMedicion(estadoRows))}</div>
    ${bloqueUltimas(ultimas, porVeh)}
    ${clientes.length ? html`<section class="inicio-card" aria-labelledby="inicio-h-clientes"><h3 id="inicio-h-clientes" class="inicio-h">Clientes con más urgencias</h3><ul class="inicio-lista">${joinHtml(clientes.map(filaCliente))}</ul></section>` : ''}
    ${lineaDispositivos(resumenDispositivos(salud), cliente)}`;
}

export async function load() {
  const cont = $('inicio-contenido');
  await contextoListo();
  const sel = hayFiltroSeccional() ? sucursalSeleccionada() : '';
  $('inicio-title').textContent = 'Inicio';
  $('inicio-subtitle').textContent = [isClienteMode() ? currentClienteNombre : '', esUsuarioSucursal() && nombreSucursal(currentSucursalId) ? `Sucursal ${nombreSucursal(currentSucursalId)}` : '', fmtFechaLarga(new Date()), sel ? nombreSucursal(sel) : ''].filter(Boolean).join(' · ');
  cont.setAttribute('aria-busy', 'true');
  setHtml(cont, estadoCarga('Cargando…'));
  const [est, al, sa, res, veh, dis, ult, vtp, rev] = await Promise.all([
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').order('tipo').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_salud_dispositivos').select('dispositivo_id,cliente_id,estado'),
    isClienteMode() ? Promise.resolve({ data: [] }) : db.from('v_resumen_flota_cliente').select('*').order('nombre'),
    // Cuenta de vehículos activos: distingue "sin vehículos" de "vehículos todavía sin neumáticos medidos".
    filtrarConsulta(db.from('vehiculos').select('id', { count: 'exact', head: true }).eq('activo', true)),
    sel ? filtrarConsulta(db.from('dispositivos').select('id')) : Promise.resolve({ data: null }),
    // Últimos vehículos medidos con la medición anterior de cada neumático; si falla, solo ese bloque muestra el error.
    db.rpc('ultimas_mediciones', { p_limite: MAX_ULTIMAS, p_sucursal: sel ? Number(sel) : null }),
    // Solo para dibujar el chasis correcto; si falla, se deduce de las posiciones.
    fetchAll((from, to) => filtrarConsulta(db.from('vehiculos').select('id,tipo_ruedas,distribucion').eq('activo', true)).order('id').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    // Mediciones sospechosas por resolver (la RLS limita el alcance). Si falla, solo se omite el aviso.
    db.from('mediciones').select('id,vehiculo_id,calidad').eq('calidad', 'sospechosa').limit(1000),
  ]);
  cont.setAttribute('aria-busy', 'false');
  const err = est.error || al.error || sa.error || res.error || veh.error || dis.error;
  if (err) { setStatus(false); showToast(userError(err), true); setHtml(cont, estadoError('', 'loadInicio')); return; }
  setStatus(true);
  let salud = sa.data || [];
  if (dis.data) { const ok = new Set(dis.data.map(d => String(d.id))); salud = salud.filter(f => ok.has(String(f.dispositivo_id))); }
  setHtml(cont, render({
    estadoRows: filtrarFilas(est.rows), alertas: filtrarFilas(al.rows), salud, resumen: res.data || [],
    vehiculosTotal: veh.count ?? 0, ultimas: ult.error ? null : (ult.data || []),
    revision: rev.error ? 0 : filtrarFilas((rev.data || []).filter(r => r.calidad === 'sospechosa')).length,
    tiposRuedas: vtp.error ? new Map() : new Map(vtp.rows.map(v => [v.id, tipoLayout(v)])),
    sucursal: sel ? nombreSucursal(sel) : '',
  }));
}

registerActions({
  loadInicio: () => load(),
  // Salta a otra vista desde un botón con data-action.
  irA: vista => switchView(vista),
});

registerView('inicio', 'Inicio', load);
export function init() {}
