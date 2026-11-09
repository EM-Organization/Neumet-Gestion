// Vista Recauchutado: procesos por carcasa (enviar -> dictamen -> aceptar o rechazar). Solo admin y perfil global; la
// autorización real vive en las RPC recauchutado_* (docs/08 apéndice L).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { isClienteMode, currentClienteId, currentSucursalId, esAdmin, onLogin, onLogout } from '../core/auth.js';
import { ACTIONS, registerActions } from '../core/actions.js';
import { registerView } from '../core/nav.js';
import { fmtFecha } from '../domain/formato.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import {
  etiquetaEstado, accionesDe, cubiertasEnviables, validarEnvio, validarDictamen, validarRechazo, validarAceptacion,
  traducirErrorRecauchutado, ERROR_GENERICO_RECAUCHUTADO,
} from '../domain/recauchutado.js';

const $ = id => document.getElementById(id);
const hoyISO = () => new Date().toISOString().slice(0, 10);
const puedeGestionar = () => esAdmin() || (isClienteMode() && currentSucursalId === null);

let procesos = [], cubiertas = [], sucursales = [], modal = null, cargaN = 0;

const etiquetaProceso = p => `${p.numero_quema || p.idneumatico || 'Sin quema'} · ${p.marca || 'Sin marca'}${p.modelo ? ' ' + p.modelo : ''}`;
const err = msg => { $('reca-error').textContent = msg || ''; };
const fechaTxt = f => (f ? fmtFecha(new Date(f + 'T00:00:00')) : '—');

function render() {
  const lista = $('reca-lista');
  $('btn-reca-enviar').style.display = puedeGestionar() ? '' : 'none';
  if (!procesos.length) {
    setHtml(lista, html`<div class="empty-state"><div class="empty-title">Sin recauchutados registrados</div><div class="empty-sub">Usar «Enviar a recauchutar» con una cubierta del stock.</div></div>`);
    return;
  }
  setHtml(lista, html`<ul class="stk-lista reca-lista" aria-label="Recauchutados">
    <li class="stk-cab reca-fila" aria-hidden="true"><span>Cubierta</span><span>Proveedor</span><span>Estado</span><span>Envío</span><span>Vida</span><span></span></li>
    ${procesos.map(p => html`<li class="stk-fila reca-fila" data-proceso="${p.id}">
      <span class="stk-quema">${etiquetaProceso(p)}</span>
      <span class="stk-desc">${p.proveedor}</span>
      <span class="stk-cond"><span class="badge">${etiquetaEstado(p.estado)}</span>${p.motivo ? html`<span class="stk-sub">${p.motivo}</span>` : ''}</span>
      <span class="stk-loc">${fechaTxt(p.fecha_envio)}</span>
      <span class="stk-compra">${p.vida_nueva !== null && p.vida_nueva !== undefined ? html`Recauchutado nº ${p.vida_nueva}` : html`Vida ${p.vida_origen}`}</span>
      <span class="stk-acc">${puedeGestionar() ? accionesDe(p.estado).map(a => html`<button type="button" class="btn ghost stk-btn" data-action="recaAbrir" data-args='["${a.id}",${p.id}]'>${a.label}</button>`) : ''}</span>
    </li>`)}</ul>`);
}

export async function loadRecauchutado() {
  const mio = ++cargaN;
  setHtml($('reca-lista'), html`<div class="loading-state"><div class="spinner"></div></div>`);
  const [rp, rc, rs] = await Promise.all([
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
  ]);
  if (mio !== cargaN) return;
  if (rp.error || rc.error) { showToast(userError(rp.error || rc.error), true); return; }
  procesos = rp.rows || [];
  cubiertas = rc.rows || [];
  sucursales = rs.error ? [] : (rs.data || []);
  render();
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
  recaEnviar() {
    if (!puedeGestionar()) return;
    const libres = cubiertasEnviables(cubiertas, procesos);
    modal = { modo: 'enviar' };
    $('reca-title').textContent = TITULOS.enviar; $('reca-sub').textContent = '';
    setHtml($('reca-cubierta'), joinHtml([html`<option value="">Elegir cubierta</option>`,
      libres.map(c => html`<option value="${c.id}">${c.numero_quema || c.idneumatico || 'Sin quema'} · ${c.marca || 'Sin marca'}${c.modelo ? ' ' + c.modelo : ''} (vida ${c.vida})</option>`)]));
    ['reca-proveedor', 'reca-motivo', 'reca-banda-marca', 'reca-banda-modelo', 'reca-profundidad', 'reca-costo'].forEach(id => { $(id).value = ''; });
    $('reca-moneda').value = 'UYU'; $('reca-fecha').value = hoyISO(); $('reca-fecha').max = hoyISO();
    mostrarCampos('enviar'); err('');
    $('reca-guardar').textContent = 'Enviar';
    $('modal-reca').classList.add('show');
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
  },
  recaDictamenCambio() { mostrarCampos('dictamen', $('reca-dictamen').value); },
  recaCerrar() { $('modal-reca').classList.remove('show'); modal = null; },
  async recaGuardar() {
    if (!modal) return;
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
    const btn = $('reca-guardar'); const txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const { error } = await db.rpc(rpc, r.args);
      if (error) {
        const m = traducirErrorRecauchutado(error);
        if (m === ERROR_GENERICO_RECAUCHUTADO) console.error(error); // los rechazos de negocio no son fallos
        err(m); showToast(m, true);
        return;
      }
      ACTIONS.recaCerrar();
      showToast('Recauchutado actualizado');
      document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
      await loadRecauchutado();
    } finally { btn.disabled = false; btn.textContent = txt; }
  },
  loadRecauchutado,
});

registerView('recauchutado', 'Recauchutado', loadRecauchutado);
onLogin(() => {
  const item = document.querySelector('.nav-item[data-view="recauchutado"]');
  if (item) item.style.display = puedeGestionar() ? '' : 'none';
});
onLogout(() => {
  procesos = []; cubiertas = []; sucursales = []; modal = null;
  const item = document.querySelector('.nav-item[data-view="recauchutado"]');
  if (item) item.style.display = 'none';
});

export function init() { /* todo va por data-action */ }
