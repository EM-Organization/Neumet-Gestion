// Pestaña Recauchutado de Neumáticos: procesos por carcasa (enviar -> dictamen -> aceptar o rechazar). Solo admin y perfil global; la
// autorización real vive en las RPC recauchutado_* (docs/08 apéndice L).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode, currentClienteId, esAdmin, esAdminEmpresa, onLogout } from '../core/auth.js';
import { ACTIONS, registerActions } from '../core/actions.js';
import { registerView, vistaActiva, reloadActiveView } from '../core/nav.js';
import { fmtFecha } from '../domain/formato.js';
import { pestanasVisibles, PESTANA_RECAUCHUTADO } from '../domain/neumaticos.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { ordenarCubiertas, etiquetaCubierta } from '../domain/stock-cubiertas.js';
import { claveBusqueda } from '../domain/vehiculo-busqueda.js';
import {
  etiquetaEstado, etiquetaBanda, accionesDe, cubiertasEnviables, validarEnvio, validarDictamen, validarRechazo, validarAceptacion,
  traducirErrorRecauchutado, ERROR_GENERICO_RECAUCHUTADO, proveedoresUsados, avisoEnvio, identificadorCubierta,
} from '../domain/recauchutado.js';

const $ = id => document.getElementById(id);
const hoyISO = () => new Date().toISOString().slice(0, 10);
// El equipo Neumet no opera dentro de una empresa (docs/17 P1): ve los procesos en solo lectura. Las cuatro RPC
// recauchutado_* pierden su rama de admin en el PR 11 (C2).
const puedeGestionar = () => esAdminEmpresa();

let procesos = [], cubiertas = [], sucursales = [], clientes = [], modal = null, cargaN = 0, guardando = false;

const nombreCliente = id => (clientes.find(c => String(c.id) === String(id)) || {}).nombre || '';
const etiquetaProceso = p => `${p.numero_quema || p.idneumatico || 'Sin quema'} · ${p.marca || 'Sin marca'}${p.modelo ? ' ' + p.modelo : ''}`;
// Tras el turno del observador de core/modal-a11y.js, que al abrir enfoca el primer campo.
const enfocar = id => setTimeout(() => { const el = $(id); if (el && el.getClientRects().length) el.focus(); }, 60);
const err = msg => { $('reca-error').textContent = msg || ''; };
const fechaTxt = f => (f ? fmtFecha(new Date(f + 'T00:00:00')) : '—');
const MAX_LISTA_RECA = 50;

// Texto visible de una cubierta en el buscador del modal (mismo formato que en el selector de Montar).
const textoCubierta = c => etiquetaCubierta(c, sucursales);

function filtrarCubiertasReca(libres, texto) {
  const needle = claveBusqueda(texto);
  if (!needle) return (libres || []).slice();
  return (libres || []).filter(c => claveBusqueda(textoCubierta(c)).includes(needle));
}

function pintarCubiertas(libres, texto, seleccionadaId) {
  const filtradas = ordenarCubiertas(filtrarCubiertasReca(libres, texto)).slice(0, MAX_LISTA_RECA);
  const lista = $('reca-cubierta-lista');
  if (!filtradas.length) {
    setHtml(lista, html`<div class="reca-cubierta-vacio">${libres.length ? 'Ninguna cubierta coincide. Cambiar la búsqueda.' : 'Sin cubiertas disponibles.'}</div>`);
    $('reca-cubierta').value = '';
    return;
  }
  setHtml(lista, html`${filtradas.map(c => html`<label class="reca-cubierta-fila"><input type="radio" name="reca-cubierta-opt" value="${c.id}" ${String(seleccionadaId) === String(c.id) ? 'checked' : ''} data-change="recaCubiertaElegir"/>
    <span class="reca-cubierta-txt">${textoCubierta(c)}</span></label>`)}${
    libres.length > MAX_LISTA_RECA ? html`<div class="reca-cubierta-vacio">Se muestran ${filtradas.length} de ${libres.length}. Usar el buscador para acotar.</div>` : ''}`);
  $('reca-cubierta').value = seleccionadaId === undefined || seleccionadaId === null ? '' : String(seleccionadaId);
}

function fijarCubierta(id) {
  if (!modal || modal.modo !== 'enviar') return;
  $('reca-cubierta').value = String(id);
  modal.cubiertaId = Number(id);
}

const recaFiltrarCubiertas = () => {
  if (!modal || modal.modo !== 'enviar') return;
  pintarCubiertas(modal.libres || [], $('reca-cubierta-buscar').value, modal.cubiertaId);
};

function render() {
  const lista = $('reca-lista');
  $('btn-reca-enviar').style.display = puedeGestionar() ? '' : 'none';
  if (!procesos.length) {
    setHtml(lista, html`<div class="empty-state"><div class="empty-title">Sin recauchutados registrados</div><div class="empty-sub">${puedeGestionar() ? 'Usar «Enviar a recauchutar» con una cubierta del stock.' : 'Los procesos los registra el administrador de empresa.'}</div></div>`);
    return;
  }
  // El equipo Neumet ve procesos de varios clientes: el cliente va bajo la cubierta (como en Stock) para no tocar la grilla de 6 columnas.
  const ver = esAdmin();
  setHtml(lista, html`${ver ? html`<p class="stk-resumen">Vista de solo lectura: los procesos los gestiona el administrador de cada empresa.</p>` : ''}<ul class="stk-lista reca-lista" aria-label="Recauchutados">
    <li class="stk-cab reca-fila" aria-hidden="true"><span>Cubierta${ver ? ' y cliente' : ''}</span><span>Proveedor</span><span>Estado</span><span>Envío</span><span>Banda</span><span></span></li>
    ${procesos.map(p => html`<li class="stk-fila reca-fila" data-proceso="${p.id}">
      <span class="stk-quema">${identificadorCubierta(p)}<span class="stk-sub">${p.marca || 'Sin marca'}${p.modelo ? ' ' + p.modelo : ''}</span>${ver ? html`<span class="stk-sub">${nombreCliente(p.cliente_id) || 'Sin cliente'}</span>` : ''}</span>
      <span class="stk-desc">${p.proveedor}</span>
      <span class="stk-cond"><span class="badge">${etiquetaEstado(p.estado)}</span>${p.motivo ? html`<span class="stk-sub">${p.motivo}</span>` : ''}</span>
      <span class="stk-loc">${fechaTxt(p.fecha_envio)}</span>
      <span class="stk-compra">${etiquetaBanda(p.vida_nueva !== null && p.vida_nueva !== undefined ? p.vida_nueva : p.vida_origen)}</span>
      <span class="stk-acc">${puedeGestionar() ? accionesDe(p.estado).map(a => html`<button type="button" class="btn ghost stk-btn" data-action="recaAbrir" data-args='["${a.id}",${p.id}]'>${a.label}</button>`) : ''}</span>
    </li>`)}</ul>`);
}

export async function loadRecauchutado() {
  const mio = ++cargaN;
  setHtml($('reca-lista'), html`<div class="loading-state"><div class="spinner"></div></div>`);
  const [rp, rc, rs, rcl] = await Promise.all([
    fetchAll((from, to) => {
      let q = db.from('recauchutados')
        .select('id,cliente_id,neumatico_id,idneumatico,numero_quema,marca,modelo,vida_origen,vida_nueva,proveedor,estado,fecha_envio,fecha_cierre,motivo')
        .order('id', { ascending: false }).range(from, to);
      if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
      return q;
    }, { pageSize: PAGE_SIZE, max: 5000 }),
    fetchAll((from, to) => {
      let q = db.from('neumaticos').select('id,cliente_id,numero_quema,idneumatico,marca,modelo,vida,estado')
        .is('vehiculo_id', null).eq('estado', 'almacenado').order('id').range(from, to);
      if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
      return q;
    }, { pageSize: PAGE_SIZE, max: 50000 }),
    db.from('sucursales').select('id,nombre,cliente_id').order('nombre'),
    esAdmin() ? db.from('clientes').select('id,nombre').is('deleted_at', null).order('nombre') : Promise.resolve({ data: [] }),
  ]);
  if (mio !== cargaN) return;
  if (rp.error || rc.error) { showToast(userError(rp.error || rc.error), true); return false; }
  procesos = rp.rows || [];
  cubiertas = rc.rows || [];
  sucursales = rs.error ? [] : (rs.data || []);
  clientes = rcl.error ? [] : (rcl.data || []);
  render();
  return true;
}

const opcionesSucursal = clienteId => joinHtml([
  html`<option value="">Sin sucursal</option>`,
  sucursales.filter(s => String(s.cliente_id) === String(clienteId)).map(s => html`<option value="${s.id}">${s.nombre}</option>`),
]);

const GRUPOS_CAMPOS = ['reca-g-cubierta', 'reca-g-proveedor', 'reca-g-dictamen', 'reca-g-motivo', 'reca-g-banda', 'reca-g-costo', 'reca-g-sucursal'];
const CAMPOS_POR_MODO = {
  enviar: ['reca-g-cubierta', 'reca-g-proveedor'],
  dictamen: ['reca-g-dictamen', 'reca-g-motivo', 'reca-g-sucursal'],
  aceptar: ['reca-g-banda', 'reca-g-costo', 'reca-g-sucursal'],
  rechazar: ['reca-g-motivo', 'reca-g-sucursal'],
};
const TITULOS = { enviar: 'Enviar a recauchutar', dictamen: 'Registrar dictamen', aceptar: 'Aceptar recauchutado', rechazar: 'Rechazar recauchutado' };

function mostrarCampos(modo, apto) {
  const visibles = new Set(CAMPOS_POR_MODO[modo]);
  // En el dictamen, motivo y sucursal solo aplican si no es apto.
  if (modo === 'dictamen' && apto !== 'no') { visibles.delete('reca-g-motivo'); visibles.delete('reca-g-sucursal'); }
  GRUPOS_CAMPOS.forEach(id => { $(id).style.display = visibles.has(id) ? '' : 'none'; });
}

registerActions({
  // `cubiertaId` viene de la fila de Stock («Enviar a recauchutar»): el modal abre con la cubierta ya elegida.
  async recaEnviar(cubiertaId) {
    if (!puedeGestionar()) return;
    const elegida = cubiertaId === undefined || cubiertaId === null ? null : Number(cubiertaId);
    // Desde Stock la pestaña Recauchutado puede no haberse abierto: se leen cubiertas y procesos antes de ofrecer el modal.
    // Si la lectura falla ya avisó con su propio mensaje: no se suma un segundo aviso («ya no se puede enviar»).
    if (elegida !== null && await loadRecauchutado() === false) return;
    const libres = cubiertasEnviables(cubiertas, procesos);
    modal = { modo: 'enviar', libres, cubiertaId: elegida };
    $('reca-title').textContent = TITULOS.enviar; $('reca-sub').textContent = '';
    $('reca-cubierta-buscar').value = '';
    setHtml($('reca-proveedores'), joinHtml(proveedoresUsados(procesos).map(n => html`<option value="${n}"></option>`)));
    ['reca-proveedor', 'reca-motivo', 'reca-banda-marca', 'reca-banda-modelo', 'reca-profundidad', 'reca-costo'].forEach(id => { $(id).value = ''; });
    $('reca-moneda').value = 'UYU'; $('reca-fecha').value = hoyISO(); $('reca-fecha').max = hoyISO();
    if (elegida !== null) {
      if (!libres.some(c => c.id === elegida)) { modal = null; showToast('La cubierta ya no se puede enviar a recauchutar', true); return; }
      $('reca-cubierta-buscar').value = textoCubierta(libres.find(c => c.id === elegida));
    }
    pintarCubiertas(libres, $('reca-cubierta-buscar').value, modal.cubiertaId);
    mostrarCampos('enviar'); err('');
    $('reca-guardar').textContent = 'Enviar';
    $('modal-reca').classList.add('show');
    enfocar(elegida !== null ? 'reca-proveedor' : 'reca-cubierta-buscar');
  },
  recaAbrir(modo, id) {
    const p = procesos.find(x => x.id === id);
    if (!p || !puedeGestionar()) return;
    modal = { modo, id, cliente: p.cliente_id };
    $('reca-title').textContent = TITULOS[modo]; $('reca-sub').textContent = etiquetaProceso(p);
    ['reca-motivo', 'reca-banda-marca', 'reca-banda-modelo', 'reca-profundidad', 'reca-costo'].forEach(x => { $(x).value = ''; });
    $('reca-dictamen').value = 'apto';
    $('reca-moneda').value = 'UYU'; $('reca-fecha').value = hoyISO(); $('reca-fecha').max = hoyISO();
    setHtml($('reca-sucursal'), opcionesSucursal(p.cliente_id));
    mostrarCampos(modo, 'apto'); err('');
    $('reca-guardar').textContent = modo === 'aceptar' ? 'Aceptar' : modo === 'rechazar' ? 'Rechazar' : 'Guardar';
    $('modal-reca').classList.add('show');
    enfocar({ dictamen: 'reca-dictamen', aceptar: 'reca-profundidad', rechazar: 'reca-motivo' }[modo]);
  },
  recaDictamenCambio() { mostrarCampos('dictamen', $('reca-dictamen').value); },
  recaCubiertaElegir(id) { fijarCubierta(id); },
  recaCerrar() { $('modal-reca').classList.remove('show'); modal = null; },
  // Guarda de rol: defensa en profundidad (el botón no se ofrece al equipo Neumet y la RPC lo rechaza); ningún test la cubre.
  async recaGuardar() {
    if (!modal || guardando || !puedeGestionar()) return; // `guardando`: un segundo Enter mientras se guarda no repite el envío
    const f = { fecha: $('reca-fecha').value, sucursalId: $('reca-sucursal').value };
    let r, rpc;
    if (modal.modo === 'enviar') {
      r = validarEnvio({ neumaticoId: $('reca-cubierta').value, proveedor: $('reca-proveedor').value, fecha: f.fecha }, { hoy: hoyISO() });
      rpc = 'recauchutado_enviar';
    } else if (modal.modo === 'dictamen') {
      r = validarDictamen({ id: modal.id, apto: $('reca-dictamen').value === 'apto', motivo: $('reca-motivo').value, ...f }, { hoy: hoyISO() });
      rpc = 'recauchutado_dictaminar';
    } else if (modal.modo === 'rechazar') {
      r = validarRechazo({ id: modal.id, motivo: $('reca-motivo').value, ...f }, { hoy: hoyISO() });
      rpc = 'recauchutado_rechazar';
    } else {
      r = validarAceptacion({ id: modal.id, profundidad: $('reca-profundidad').value, bandaMarca: $('reca-banda-marca').value,
        bandaModelo: $('reca-banda-modelo').value, costo: $('reca-costo').value, moneda: $('reca-moneda').value, ...f }, { hoy: hoyISO() });
      rpc = 'recauchutado_aceptar';
    }
    if (!r.ok) { err(r.error); return; }
    // Solo el envío nombra cubierta y proveedor; el resto de los pasos conserva el aviso genérico.
    const aviso = modal.modo === 'enviar' ? avisoEnvio(cubiertas.find(c => c.id === r.args.p_neumatico_id) || {}, r.args.p_proveedor) : 'Recauchutado actualizado';
    const btn = $('reca-guardar'); const txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando…'; guardando = true;
    try {
      const { error } = await db.rpc(rpc, r.args);
      if (error) {
        const m = traducirErrorRecauchutado(error);
        if (m === ERROR_GENERICO_RECAUCHUTADO) console.error(error); // los rechazos de negocio no son fallos
        err(m); showToast(m, true);
        return;
      }
      ACTIONS.recaCerrar();
      showToast(aviso);
      document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
      // El envío puede haberse iniciado desde Stock: se refresca la vista que está a la vista.
      if (vistaActiva() === 'recauchutado') await loadRecauchutado(); else reloadActiveView();
    } finally { btn.disabled = false; btn.textContent = txt; guardando = false; }
  },
  loadRecauchutado,
});

// Cuelga del menú Neumáticos (pestaña Recauchutado): el ítem resaltado es `stock`.
registerView('recauchutado', 'Recauchutado', loadRecauchutado, { menu: 'stock', vetoA: { vista: 'stock', cuando: () => !pestanasVisibles({ admin: esAdmin(), adminEmpresa: esAdminEmpresa() }).includes(PESTANA_RECAUCHUTADO) } });
onLogout(() => { procesos = []; cubiertas = []; sucursales = []; clientes = []; modal = null; });

export function init() {
  // «Enter» en cualquier campo guarda (docs/14 §5, regla 3).
  $('reca-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS.recaGuardar(); });
  $('reca-cubierta-buscar').addEventListener('input', recaFiltrarCubiertas);
}
