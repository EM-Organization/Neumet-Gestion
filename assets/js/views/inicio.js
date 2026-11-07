// Inicio: panel de decisión. Buscador de vehículos, proporciones de la flota, vehículos que requieren atención y
// próximos cambios, con enlace directo al detalle de cada vehículo. Usa las vistas SQL v_estado_neumaticos,
// v_alertas y v_salud_dispositivos (security_invoker: la RLS decide qué ve cada rol; la sucursal elegida se aplica además aquí).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate, setStatus } from '../core/ui.js';
import { isClienteMode, currentClienteNombre, onLogin } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { contextoListo, filtrarFilas, filtrarConsulta, hayFiltroSeccional, sucursalSeleccionada, nombreSucursal } from '../core/seccional.js';
import { registerActions } from '../core/actions.js';
import { estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  estadoInicio, resumenNeumaticos, requierenAtencion, proximosCambios, resumenDispositivos, ultimaMedicion,
  clientesConUrgencias, textoSemanas,
} from '../domain/inicio.js';
import { fmtNum, fmtFechaLarga, plural } from '../domain/formato.js';
import { etiquetaCoche } from '../domain/coche.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 20000;

const verVehiculo = id => JSON.stringify([id]);
const matricula = p => (p ? html`<span class="dash-fleet-pat">${p}</span>` : '');

function filaAtencion(v) {
  return html`<li><button type="button" class="inicio-fila" data-action="verVehiculo" data-args="${verVehiculo(v.vehiculo_id)}">
    <span class="inicio-punto ${v.nivel === 'critico' ? 'critico' : ''}" aria-hidden="true"></span>
    <span class="inicio-fila-txt"><span class="inicio-fila-nom">${etiquetaCoche(v.nombre)} ${matricula(v.patente)}</span>
      <span class="inicio-fila-causa">${v.nivel === 'critico' ? html`<span class="sr-only">Crítico: </span>` : ''}${v.causa}</span></span>
    <span class="inicio-fila-ir" aria-hidden="true">›</span></button></li>`;
}

function filaProximo(p) {
  return html`<li><button type="button" class="inicio-fila" data-action="verVehiculo" data-args="${verVehiculo(p.vehiculo_id)}">
    <span class="inicio-fila-txt"><span class="inicio-fila-nom">${etiquetaCoche(p.nombre)} ${matricula(p.patente)}</span>
      <span class="inicio-fila-causa">Posición ${p.posicion}${p.mm !== null ? ` · ${fmtNum(p.mm, 1)} mm` : ''}</span></span>
    <span class="inicio-semanas">${textoSemanas(p.semanas)}</span></button></li>`;
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

function bloqueAtencion(at, nAlertas) {
  return html`<section class="inicio-card" aria-labelledby="inicio-h-atencion">
    <h3 id="inicio-h-atencion" class="inicio-h">Requieren atención</h3>
    ${at.items.length
      ? html`<ul class="inicio-lista">${joinHtml(at.items.map(filaAtencion))}</ul>${at.total > at.items.length ? html`<p class="inicio-meta">${at.total - at.items.length} más en Alertas.</p>` : ''}`
      : estadoVacio('Ningún vehículo requiere atención.')}
    <button type="button" class="inicio-enlace" data-action="irA" data-args='["alertas"]'>Ver todas las alertas${nAlertas ? ` (${fmtNum(nAlertas)})` : ''} ›</button>
  </section>`;
}

function bloqueProximos(px) {
  return html`<section class="inicio-card" aria-labelledby="inicio-h-proximos">
    <h3 id="inicio-h-proximos" class="inicio-h">Próximos cambios</h3>
    ${px.items.length
      ? html`<ul class="inicio-lista">${joinHtml(px.items.map(filaProximo))}</ul>${px.total > px.items.length ? html`<p class="inicio-meta">${px.total - px.items.length} más.</p>` : ''}`
      : estadoVacio('Ningún neumático cerca del nivel crítico.')}
  </section>`;
}

function lineaDispositivos(d) {
  if (!d.total) return html`<p class="inicio-linea">Sin dispositivos registrados. <button type="button" class="inicio-enlace" data-action="irA" data-args='["dispositivos"]'>Ver dispositivos ›</button></p>`;
  return html`<p class="inicio-linea">Dispositivos: ${fmtNum(d.activos)} de ${fmtNum(d.total)} activos${d.inactivos
    ? html` · <button type="button" class="inicio-enlace" data-action="irA" data-args='["dispositivos"]'>${plural(d.inactivos, 'sin actividad', 'sin actividad')} ›</button>` : ''}</p>`;
}

export function render({ estadoRows, alertas, salud, resumen, vehiculosTotal = 0 }) {
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
      { label: 'Ver dispositivos', action: 'irA', args: ['dispositivos'], primaria: true });
  }
  const rs = resumenNeumaticos(estadoRows);
  const at = requierenAtencion(estadoRows);
  const px = proximosCambios(estadoRows);
  const clientes = !cliente ? clientesConUrgencias(resumen) : [];
  return html`${bloqueResumen(rs, ultimaMedicion(estadoRows))}
    <div class="inicio-cols">${bloqueAtencion(at, alertas.length)}${bloqueProximos(px)}</div>
    ${clientes.length ? html`<section class="inicio-card" aria-labelledby="inicio-h-clientes"><h3 id="inicio-h-clientes" class="inicio-h">Clientes con más urgencias</h3><ul class="inicio-lista">${joinHtml(clientes.map(filaCliente))}</ul></section>` : ''}
    ${lineaDispositivos(resumenDispositivos(salud))}`;
}

export async function load() {
  const cont = $('inicio-contenido');
  await contextoListo();
  const sel = hayFiltroSeccional() ? sucursalSeleccionada() : '';
  $('inicio-title').textContent = 'Inicio';
  $('inicio-subtitle').textContent = [isClienteMode() ? currentClienteNombre : '', fmtFechaLarga(new Date()), sel ? nombreSucursal(sel) : ''].filter(Boolean).join(' · ');
  cont.setAttribute('aria-busy', 'true');
  setHtml(cont, estadoCarga('Cargando…'));
  const [est, al, sa, res, veh, dis] = await Promise.all([
    fetchAll((from, to) => db.from('v_estado_neumaticos').select('*').order('vehiculo_id').order('posicion').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    fetchAll((from, to) => db.from('v_alertas').select('*').order('vehiculo_id').order('posicion').order('tipo').range(from, to), { pageSize: PAGE_SIZE, max: MAX_FILAS }),
    db.from('v_salud_dispositivos').select('dispositivo_id,cliente_id,estado'),
    isClienteMode() ? Promise.resolve({ data: [] }) : db.from('v_resumen_flota_cliente').select('*').order('nombre'),
    // Cuenta de vehículos activos: distingue "sin vehículos" de "vehículos todavía sin neumáticos medidos".
    filtrarConsulta(db.from('vehiculos').select('id', { count: 'exact', head: true }).eq('activo', true)),
    sel ? filtrarConsulta(db.from('dispositivos').select('id')) : Promise.resolve({ data: null }),
  ]);
  cont.setAttribute('aria-busy', 'false');
  const err = est.error || al.error || sa.error || res.error || veh.error || dis.error;
  if (err) { setStatus(false); showToast(userError(err), true); setHtml(cont, estadoError('', 'loadInicio')); return; }
  setStatus(true);
  let salud = sa.data || [];
  if (dis.data) { const ok = new Set(dis.data.map(d => String(d.id))); salud = salud.filter(f => ok.has(String(f.dispositivo_id))); }
  setHtml(cont, render({
    estadoRows: filtrarFilas(est.rows), alertas: filtrarFilas(al.rows), salud, resumen: res.data || [],
    vehiculosTotal: veh.count ?? 0,
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
