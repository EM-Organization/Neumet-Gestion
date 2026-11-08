// Inicio: panel de decisión. Buscador de vehículos, proporciones de la flota, vehículos que requieren atención y
// próximos cambios y últimas mediciones, con enlace directo al detalle de cada vehículo. Usa las vistas SQL v_estado_neumaticos,
// v_alertas y v_salud_dispositivos y la función ultimas_mediciones (security invoker: la RLS decide qué ve cada rol; la
// sucursal elegida se aplica además aquí). Los dispositivos solo se gestionan desde administración.
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate, setStatus } from '../core/ui.js';
import { isClienteMode, currentClienteNombre, onLogin } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { contextoListo, filtrarFilas, filtrarConsulta, hayFiltroSeccional, sucursalSeleccionada, nombreSucursal } from '../core/seccional.js';
import { registerActions } from '../core/actions.js';
import { estadoVacio, estadoCarga, estadoError, miniVehiculo } from '../core/componentes.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  estadoInicio, resumenNeumaticos, requierenAtencion, proximosCambios, resumenDispositivos, ultimaMedicion,
  clientesConUrgencias, textoSemanas, ultimasMediciones, MAX_ULTIMAS,
} from '../domain/inicio.js';
import { fmtNum, fmtFecha, fmtFechaLarga, plural } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';
import { nombrePosicion, resumenPosiciones, modeloMini, agruparPorVehiculo } from '../domain/posicion.js';

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
const tipoDe = id => tipos.get(id);
const miniDe = (filas, destacadas, id) => miniVehiculo(modeloMini(filas, { destacadas, tipo: tipoDe(id) }));

// Fila con mini vehículo: [mini] [nombre, detalle, posiciones] [dato] [Ver coche N]. `extra` va bajo el texto.
function filaMini(v, filas, { destacadas = [], detalle, pos = '', dato = '', extra = '', cls = '', nivel = '' }) {
  return html`<li class="inicio-fila inicio-fila-mini ${cls}">
    ${miniDe(filas, destacadas, v.vehiculo_id)}
    <div class="inicio-fila-txt"><span class="inicio-fila-nom">${nivel === 'critico' ? html`<span class="inicio-punto critico" aria-hidden="true"></span>` : ''}${etiquetaCoche(v.nombre)} ${matricula(v.patente)}</span>
      ${detalle ? html`<span class="inicio-fila-causa">${nivel === 'critico' ? html`<span class="sr-only">Crítico: </span>` : ''}${detalle}</span>` : ''}
      ${pos ? html`<span class="inicio-fila-pos">${pos}</span>` : ''}${extra}</div>
    ${dato}${botonVer(v, destacadas.length ? destacadas[0] : null)}</li>`;
}

function filaAtencion(v, porVeh) {
  const filas = porVeh.get(v.vehiculo_id) || [];
  return filaMini(v, filas, { destacadas: v.posiciones, detalle: v.causa, pos: resumenPosiciones(v.posiciones, tipoDe(v.vehiculo_id)), nivel: v.nivel === 'critico' ? 'critico' : '' });
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
      <span class="inicio-fila-causa">${plural(r.n_critico, 'neumático crítico', 'neumáticos críticos')} · ${plural(r.n_alertas_sev3, 'alerta crítica', 'alertas críticas')}</span></span>
    <span class="inicio-fila-ir" aria-hidden="true">›</span></button></li>`;
}

const segmento = (cls, pct, etiqueta) => (pct > 0 ? html`<span class="inicio-seg ${cls}" style="width:${pct}%" title="${etiqueta}"></span>` : '');
const cifra = (cls, n, etiqueta) => html`<li class="inicio-cifra"><span class="inicio-punto ${cls}" aria-hidden="true"></span><strong>${fmtNum(n)}</strong> ${etiqueta}</li>`;

function bloqueResumen(rs, ult) {
  const frase = rs.ok === rs.total ? `Los ${fmtNum(rs.total)} neumáticos están en buen estado` : `${fmtNum(rs.ok)} de ${fmtNum(rs.total)} neumáticos en buen estado`;
  return html`<section class="inicio-card" aria-labelledby="inicio-h-resumen">
    <div class="inicio-resumen-cab"><h3 id="inicio-h-resumen" class="inicio-h">${frase}</h3>
      ${ult ? html`<span class="inicio-meta">Última medición ${relDate(ult)}</span>` : ''}</div>
    <div class="inicio-barra" role="img" aria-label="${`OK ${rs.ok}, desgaste bajo ${rs.bajo}, críticos ${rs.critico}, sin datos ${rs.sin_datos}`}">
      ${segmento('ok', rs.pct.ok, 'OK')}${segmento('bajo', rs.pct.bajo, 'Desgaste bajo')}${segmento('critico', rs.pct.critico, 'Crítico')}${segmento('sin', rs.pct.sin_datos, 'Sin datos')}</div>
    <ul class="inicio-cifras">${cifra('ok', rs.ok, 'OK')}${cifra('bajo', rs.bajo, 'desgaste bajo')}${cifra(rs.critico ? 'critico' : 'cero', rs.critico, rs.critico === 1 ? 'crítico' : 'críticos')}${cifra('sin', rs.sin_datos, 'sin datos')}</ul>
  </section>`;
}

function bloqueAtencion(at, nAlertas, porVeh) {
  return html`<section class="inicio-card" aria-labelledby="inicio-h-atencion">
    <h3 id="inicio-h-atencion" class="inicio-h">Requieren atención</h3>
    ${at.items.length
      ? html`<ul class="inicio-lista">${joinHtml(at.items.map(v => filaAtencion(v, porVeh)))}</ul>${at.total > at.items.length ? html`<p class="inicio-meta">${at.total - at.items.length} más en Alertas.</p>` : ''}`
      : estadoVacio('Ningún vehículo requiere atención.')}
    <button type="button" class="inicio-enlace" data-action="irA" data-args='["alertas"]'>Ver todas las alertas${nAlertas ? ` (${fmtNum(nAlertas)})` : ''} ›</button>
  </section>`;
}

function bloqueProximos(px, porVeh) {
  return html`<section class="inicio-card" aria-labelledby="inicio-h-proximos">
    <h3 id="inicio-h-proximos" class="inicio-h">Próximos cambios</h3>
    ${px.items.length
      ? html`<ul class="inicio-lista">${joinHtml(px.items.map(p => filaProximo(p, porVeh)))}</ul>${px.total > px.items.length ? html`<p class="inicio-meta">${px.total - px.items.length} más.</p>` : ''}`
      : estadoVacio('Ningún neumático cerca del nivel crítico.')}
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

function neumaticoMedido(n, id) {
  const c = n.comparativa;
  return html`<li class="um-neu"><span class="um-pos">${nombrePosicion(n.posicion, tipoDe(id))}</span>${c
    ? html`<span class="um-mm">${fmtNum(c.antes, 1)} → ${fmtNum(c.ahora, 1)} mm</span><span class="um-dif ${c.nivel}">${c.nivel === 'alto' ? html`<span class="sr-only">Desgaste alto: </span>` : ''}${textoDif(c.dif)}</span>`
    : html`<span class="um-mm">${fmtNum(n.mm, 1)} mm</span><span class="um-sin">Sin previa</span>`}</li>`;
}

function filaMedida(v, porVeh) {
  // Colores del estado actual del vehículo; sin esas filas, los mm de esta visita.
  const filas = porVeh.get(v.vehiculo_id) || v.neumaticos.map(n => ({ posicion: n.posicion, promedio: n.mm }));
  const coche = v.numero && etiquetaCoche(v.numero) !== etiquetaCoche(v.nombre) ? `Coche ${v.numero} · ` : '';
  return html`<li class="um-fila">
    <div class="um-cab">${miniDe(filas, [], v.vehiculo_id)}
      <div class="inicio-fila-txt"><span class="inicio-fila-nom">${etiquetaCoche(v.nombre)} ${matricula(v.patente)}</span>
        <span class="inicio-fila-causa">${coche}${fmtFecha(v.medido_at)}</span></div>
      ${botonVer(v, null)}</div>
    <ul class="um-neus">${joinHtml(v.neumaticos.map(n => neumaticoMedido(n, v.vehiculo_id)))}</ul></li>`;
}

// `ultimas` = filas de ultimas_mediciones; null si la consulta falló (el resto de Inicio sigue mostrándose).
function bloqueUltimas(ultimas, porVeh) {
  const lista = ultimas === null ? [] : ultimasMediciones(ultimas);
  return html`<section class="inicio-card" aria-labelledby="inicio-h-ultimas">
    <h3 id="inicio-h-ultimas" class="inicio-h">Últimas mediciones</h3>
    ${ultimas === null ? estadoError('', 'loadInicio')
      : lista.length ? html`<ul class="inicio-lista">${joinHtml(lista.map(v => filaMedida(v, porVeh)))}</ul>
        <p class="inicio-meta">Medición anterior → última · diferencia en mm.</p>`
      : estadoVacio('Sin mediciones registradas')}
  </section>`;
}

export function render({ estadoRows, alertas, salud, resumen, vehiculosTotal = 0, ultimas = [], tiposRuedas = new Map() }) {
  tipos = tiposRuedas;
  const cliente = isClienteMode();
  const estado = estadoInicio({ vehiculosTotal, estadoRows, alertas, salud });
  if (estado === 'vacio') {
    return estadoVacio('Sin vehículos registrados',
      cliente ? 'Los vehículos aparecerán aquí cuando se registren y se midan.' : 'Registrar un cliente, cargar sus vehículos y asignar un dispositivo.',
      cliente ? null : { label: 'Ir a Clientes', action: 'irA', args: ['clientes'], primaria: true });
  }
  if (estado === 'sin_mediciones') {
    return estadoVacio(vehiculosTotal ? `${plural(vehiculosTotal, 'vehículo registrado', 'vehículos registrados')}, sin mediciones` : 'Sin mediciones registradas',
      'El estado de los neumáticos se muestra desde la primera medición.',
      cliente ? null : { label: 'Ver dispositivos', action: 'irA', args: ['dispositivos'], primaria: true });
  }
  const rs = resumenNeumaticos(estadoRows);
  const at = requierenAtencion(estadoRows);
  const px = proximosCambios(estadoRows);
  const clientes = !cliente ? clientesConUrgencias(resumen) : [];
  const porVeh = agruparPorVehiculo(estadoRows);
  return html`<div class="inicio-cols">${bloqueAtencion(at, alertas.length, porVeh)}${bloqueProximos(px, porVeh)}</div>
    ${bloqueResumen(rs, ultimaMedicion(estadoRows))}
    ${bloqueUltimas(ultimas, porVeh)}
    ${clientes.length ? html`<section class="inicio-card" aria-labelledby="inicio-h-clientes"><h3 id="inicio-h-clientes" class="inicio-h">Clientes con más urgencias</h3><ul class="inicio-lista">${joinHtml(clientes.map(filaCliente))}</ul></section>` : ''}
    ${lineaDispositivos(resumenDispositivos(salud), cliente)}`;
}

export async function load() {
  const cont = $('inicio-contenido');
  await contextoListo();
  const sel = hayFiltroSeccional() ? sucursalSeleccionada() : '';
  $('inicio-title').textContent = 'Inicio';
  $('inicio-subtitle').textContent = [isClienteMode() ? currentClienteNombre : '', fmtFechaLarga(new Date()), sel ? nombreSucursal(sel) : ''].filter(Boolean).join(' · ');
  cont.setAttribute('aria-busy', 'true');
  setHtml(cont, estadoCarga('Cargando…'));
  const [est, al, sa, res, veh, dis, ult, vtp] = await Promise.all([
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
    fetchAll((from, to) => filtrarConsulta(db.from('vehiculos').select('id,tipo_ruedas').eq('activo', true)).order('id').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
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
    tiposRuedas: vtp.error ? new Map() : new Map(vtp.rows.map(v => [v.id, v.tipo_ruedas])),
  }));
}

registerActions({
  loadInicio: () => load(),
  // Salta a otra vista desde un botón con data-action.
  irA: vista => switchView(vista),
});

registerView('inicio', 'Inicio', load);
onLogin(() => switchView('inicio'));
export function init() {}
