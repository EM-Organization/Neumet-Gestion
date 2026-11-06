// Inicio: neumáticos críticos, alertas, dispositivos sin actividad y vehículos sin medir, cada uno con enlace a la vista
// donde se resuelve. Usa las mismas vistas SQL y reglas de dominio que Flota, Alertas y Dispositivos (security_invoker:
// RLS decide qué ve cada rol; la seccional elegida se aplica además en el cliente).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError, relDate, setStatus } from '../core/ui.js';
import { isClienteMode, currentClienteNombre, onLogin } from '../core/auth.js';
import { registerView, switchView } from '../core/nav.js';
import { contextoListo, filtrarFilas, filtrarConsulta, hayFiltroSeccional, sucursalSeleccionada, nombreSucursal } from '../core/seccional.js';
import { registerActions } from '../core/actions.js';
import { chip, chipEstado, estadoVacio, estadoCarga, estadoError } from '../core/componentes.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { agruparVehiculos, kpisFlota, contarPorSeveridad } from '../domain/flota.js';
import { contarPorEstado } from '../domain/salud.js';
import { estadoInicio } from '../domain/inicio.js';
import { fmtNum, fmtFechaLarga, fmtMm, plural } from '../domain/formato.js';

const $ = id => document.getElementById(id);
const MAX_FILAS = 20000;
const MAX_VEHICULOS_LISTA = 5;

// Una tarjeta de atención: número grande + qué significa + a dónde ir. Si n=0, "Todo en orden" (texto + símbolo, no solo color).
function tarjeta({ n, titulo, ayuda, vista, urgente, cta }) {
  const estado = n > 0 ? (urgente ? chip('red', 'Requiere atención', '✕') : chip('orange', 'Revisar', '▲')) : chip('green', 'Todo en orden', '✓');
  return html`<button type="button" class="atencion-card ${n > 0 ? (urgente ? 'sev-critico' : 'sev-bajo') : 'sev-ok'}" data-action="irA" data-args="${JSON.stringify([vista])}" data-tarjeta="${vista}">
    <span class="atencion-n">${fmtNum(n)}</span>
    <span class="atencion-titulo">${titulo}</span>
    <span class="atencion-ayuda">${ayuda}</span>
    <span class="atencion-estado">${estado}</span>
    <span class="atencion-ir">${cta} →</span>
  </button>`;
}

function filaVehiculo(v) {
  const arg = JSON.stringify([v.patente || v.nombre]);
  const partes = [];
  if (v.n_critico) partes.push(plural(v.n_critico, 'neumático crítico', 'neumáticos críticos'));
  if (v.n_bajo) partes.push(`${fmtNum(v.n_bajo)} con desgaste bajo`);
  if (v.n_sin_medir) partes.push(`${fmtNum(v.n_sin_medir)} sin medir`);
  if (v.min_mm !== null) partes.push(`el más gastado: ${fmtMm(v.min_mm)}`);
  return html`<li class="atencion-veh">
    <div class="atencion-veh-info">
      <div class="dash-fleet-name">${v.nombre}${v.patente ? html`<span class="dash-fleet-pat">${v.patente}</span>` : ''} ${chipEstado(v.semaforo)}</div>
      <div class="flota-meta">${partes.join(' · ') || 'Sin mediciones todavía'}${v.ultima_medicion_at ? ` · última medición ${relDate(v.ultima_medicion_at)}` : ''}</div>
    </div>
    <button type="button" class="btn ghost" data-action="verVehiculoEnLista" data-args="${arg}">Ver vehículo</button>
  </li>`;
}

function filaCliente(r) {
  const problemas = (Number(r.n_critico) || 0) + (Number(r.n_alertas_sev3) || 0);
  return html`<li class="atencion-veh">
    <div class="atencion-veh-info">
      <div class="dash-fleet-name">${r.nombre}</div>
      <div class="flota-meta">${plural(r.n_vehiculos_activos, 'vehículo activo', 'vehículos activos')} · ${plural(r.n_critico, 'neumático crítico', 'neumáticos críticos')} · ${plural(r.n_alertas_sev3, 'alerta crítica', 'alertas críticas')}${problemas ? '' : ' · sin urgencias'}</div>
    </div>
    <button type="button" class="btn ghost" data-action="abrirFichaCliente" data-args="${JSON.stringify([r.cliente_id])}">Ver ficha</button>
  </li>`;
}

export function render({ estadoRows, alertas, salud, resumen, vehiculosTotal = 0 }) {
  const cliente = isClienteMode();
  const estado = estadoInicio({ vehiculosTotal, estadoRows, alertas, salud });
  if (estado === 'vacio') {
    return estadoVacio('Todavía no hay vehículos',
      cliente ? 'Cuando se registren tus vehículos y se midan sus neumáticos, vas a ver su estado acá.'
        : 'Registrá un cliente, cargá sus vehículos y asigná un dispositivo medidor.',
      cliente ? null : { label: 'Ir a Clientes', action: 'irA', args: ['clientes'], primaria: true });
  }
  if (estado === 'sin_mediciones') {
    return estadoVacio(vehiculosTotal ? `${plural(vehiculosTotal, 'vehículo registrado', 'vehículos registrados')}, sin mediciones todavía` : 'Todavía no hay mediciones',
      'Apenas un dispositivo mida sus neumáticos, vas a ver acá cuáles requieren atención.',
      { label: 'Ver dispositivos', action: 'irA', args: ['dispositivos'], primaria: true });
  }
  const k = kpisFlota(estadoRows, cliente ? null : resumen, '');
  const sev = contarPorSeveridad(alertas);
  const sh = contarPorEstado(salud);
  const vehiculos = agruparVehiculos(estadoRows);
  const sinMedir = vehiculos.filter(v => v.n_sin_medir > 0 || v.semaforo === 'sin_datos').length;
  const sinActividad = sh.caido + sh.sin_actividad;
  const urgentes = vehiculos.filter(v => v.semaforo === 'critico' || v.semaforo === 'bajo').slice(0, MAX_VEHICULOS_LISTA);
  const vistaFlota = cliente ? 'vehiculos' : 'flota';

  const tarjetas = joinHtml([
    tarjeta({ n: k.criticos, titulo: 'Neumáticos críticos', ayuda: 'Por debajo del límite: conviene cambiarlos.', vista: vistaFlota, urgente: true, cta: 'Ver' }),
    tarjeta({ n: alertas.length, titulo: 'Alertas activas', ayuda: `${fmtNum(sev[3])} críticas, ${fmtNum(sev[2])} medias, ${fmtNum(sev[1])} informativas.`, vista: 'alertas', urgente: sev[3] > 0, cta: 'Ver' }),
    tarjeta({ n: sinActividad, titulo: 'Dispositivos sin actividad', ayuda: `Más de 7 días sin medir${sh.nunca ? `; ${fmtNum(sh.nunca)} nunca midió` : ''}.`, vista: 'dispositivos', urgente: sh.caido > 0, cta: 'Ver' }),
    tarjeta({ n: sinMedir, titulo: 'Vehículos sin medir', ayuda: 'Con neumáticos sin ninguna medición.', vista: vistaFlota, urgente: false, cta: 'Ver' }),
  ]);

  const listaVeh = urgentes.length
    ? html`<h3 class="seccion-titulo">Vehículos que más urgen</h3><ul class="atencion-lista">${joinHtml(urgentes.map(filaVehiculo))}</ul>`
    : html`<h3 class="seccion-titulo">Vehículos que más urgen</h3>${estadoVacio('Ningún vehículo con neumáticos críticos o bajos')}`;

  const clientesTop = !cliente
    ? [...resumen].sort((a, b) => (b.n_alertas_sev3 - a.n_alertas_sev3) || (b.n_critico - a.n_critico)).slice(0, MAX_VEHICULOS_LISTA)
    : [];
  const listaCli = clientesTop.length
    ? html`<h3 class="seccion-titulo">Clientes con más urgencias</h3><ul class="atencion-lista">${joinHtml(clientesTop.map(filaCliente))}</ul>` : '';

  return html`<div class="atencion-grid">${tarjetas}</div>${listaVeh}${listaCli}`;
}

export async function load() {
  const cont = $('inicio-contenido');
  await contextoListo();
  const sel = hayFiltroSeccional() ? sucursalSeleccionada() : '';
  $('inicio-title').textContent = isClienteMode() ? `Hola, ${currentClienteNombre}` : 'Inicio';
  $('inicio-subtitle').textContent = fmtFechaLarga(new Date()) + (sel ? ` · ${nombreSucursal(sel)}` : '');
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
  // Salta a otra vista desde un botón con data-action (tarjetas de Inicio, estados vacíos).
  irA: vista => switchView(vista),
});

registerView('inicio', 'Inicio', load);
onLogin(() => switchView('inicio'));
export function init() {}
