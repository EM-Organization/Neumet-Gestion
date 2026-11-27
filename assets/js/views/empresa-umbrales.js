import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { currentClienteId, onLogout } from '../core/auth.js';
import { devolverFoco } from '../core/foco.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { comaDecimal } from '../domain/formato.js';
import { CAMPOS_UMBRAL, camposBasicos, validarUmbrales } from '../domain/umbrales.js';
import { argsAlertaConfigurar, mensajeErrorConfigurar } from '../domain/empresa.js';
import { opcionesMoneda, validarMoneda, traducirErrorMoneda, monedaInicial } from '../domain/costos.js';
import { ESTADOS } from '../domain/estado-desgaste.js';

// Empresa > Umbrales (docs/17 §4.3): el administrador de empresa edita los umbrales de desgaste de su empresa.
// Escribe con la RPC alerta_configurar (la base decide quién puede); no hace UPDATE directo sobre clientes.
// La tarjeta «Moneda de los costos» (F8 ola 4) va en la misma vista y escribe con cliente_fijar_moneda, con guarda propia.
const $ = id => document.getElementById(id);
const COLS = CAMPOS_UMBRAL.map(c => c.key).join(',');
const err = msg => { const el = $('emp-umb-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
const errMoneda = msg => { const el = $('emp-moneda-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
// Códigos que traducirErrorMoneda explica; cualquier otro es un fallo inesperado y se registra en consola.
const CODIGOS_MONEDA = ['42501', '23514'];

const campoHtml = (c, f) => html`<div class="field">
    <label for="eu-${f.key}">${f.lbl}</label>
    <input type="text" inputmode="decimal" id="eu-${f.key}" data-umbral="${f.key}" value="${comaDecimal(c[f.key] ?? '')}"/>
    <div class="ficha-ayuda">${f.ayuda}</div>
  </div>`;

// Todos los ajustes a la vista, en tres grupos: los estados de desgaste con su escala, y los demás por tema.
const GRUPOS_AJUSTE = [
  { titulo: 'Alertas y mediciones', keys: ['alerta_histeresis_mm', 'caida_brusca_mm', 'irregularidad_mm', 'dias_sin_medir_alerta'] },
  { titulo: 'Rotación', keys: ['swap_km', 'direccion_aviso_mm', 'direccion_limite_mm'] },
];
// La escala sigue el orden de los campos (de mayor a menor huella); entre dos estados va el valor que los separa.
const ESCALA = [
  { estado: 'bueno' }, { corte: 'umbral_bajo_mm' }, { estado: 'poco' }, { corte: 'umbral_critico_mm' },
  { estado: 'mayor' }, { corte: 'umbral_retiro_mm' }, { estado: 'limite' },
];

const escalaHtml = () => html`<div class="umb-escala" aria-hidden="true">${joinHtml(ESCALA.map(p => (p.estado
  ? html`<span class="umb-tramo umb-${p.estado}">${ESTADOS[p.estado].texto}</span>`
  : html`<span class="umb-corte" data-corte="${p.corte}"></span>`)))}</div>`;

function pintarEscala() {
  document.querySelectorAll('#emp-umb-campos [data-corte]').forEach(el => {
    const valor = $('eu-' + el.dataset.corte)?.value.trim();
    el.textContent = valor ? `${valor} mm` : '—';
  });
}

function render(c) {
  const campo = key => campoHtml(c, CAMPOS_UMBRAL.find(f => f.key === key));
  setHtml($('emp-umb-campos'), joinHtml([
    escalaHtml(),
    html`<div class="umb-estados">${joinHtml(camposBasicos().map(f => campoHtml(c, f)))}</div>`,
    html`<div class="umb-grupos">${joinHtml(GRUPOS_AJUSTE.map(g => html`<fieldset class="umb-grupo"><legend>${g.titulo}</legend>${joinHtml(g.keys.map(campo))}</fieldset>`))}</div>`,
  ]));
  pintarEscala();
}

// Enfoca el campo del error, para que se vea dónde corregir (el aviso queda en la barra de guardado, siempre a la vista).
function mostrarCampo(key) {
  const campo = $('eu-' + key);
  if (campo) campo.focus();
}

// Sin moneda guardada, la lista muestra USD (el respaldo de los formularios de costo).
function renderMoneda(actual) {
  const valor = monedaInicial(actual);
  setHtml($('emp-moneda'), joinHtml(opcionesMoneda(valor).map(m => html`<option value="${m}">${m}</option>`)));
  $('emp-moneda').value = valor;
}

async function cargarUmbrales() {
  err('');
  const { data, error } = await db.from('clientes').select('id,moneda_default,' + COLS).eq('id', currentClienteId).maybeSingle();
  if (error || !data) { if (error) userError(error); err('No se pudieron cargar los umbrales. Actualizar para reintentar.'); return; }
  render(data);
  renderMoneda(data.moneda_default);
}

export function loadEmpresaUmbrales() { return cargarUmbrales(); }

async function guardarMoneda() {
  const v = validarMoneda($('emp-moneda').value);
  if (!v.ok) { errMoneda(v.error); return; }
  errMoneda('');
  const btn = $('emp-moneda-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const { error } = await db.rpc('cliente_fijar_moneda', { p_cliente_id: currentClienteId, p_moneda: v.moneda });
    if (error) {
      if (!CODIGOS_MONEDA.includes(error.code)) console.error(error);
      errMoneda(traducirErrorMoneda(error));
      return;
    }
    showToast('Moneda actualizada');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar moneda';
  }
}

async function guardar() {
  const raw = {};
  document.querySelectorAll('#emp-umb-campos [data-umbral]').forEach(i => { raw[i.dataset.umbral] = i.value; });
  const v = validarUmbrales(raw);
  if (!v.ok) { err(v.error); mostrarCampo(v.campo); return; }
  err('');
  const btn = $('emp-umb-guardar');
  const enfocado = document.activeElement && document.activeElement.id; // campo desde el que se guardó (Enter) o el botón
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const { error } = await db.rpc('alerta_configurar', argsAlertaConfigurar(currentClienteId, v.valores));
    if (error) { err(mensajeErrorConfigurar(error)); return; }
    showToast('Umbrales actualizados');
    await cargarUmbrales();
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar umbrales';
    // La recarga repinta los campos: el foco vuelve al mismo campo (o al botón) para seguir con el teclado.
    devolverFoco(enfocado && `#${enfocado}`, '#emp-umb-guardar');
  }
}

ACTIONS.loadEmpresaUmbrales = registerView('empresa-umbrales', 'Umbrales', loadEmpresaUmbrales, { soloEmpresa: true });
onLogout(() => { setHtml($('emp-umb-campos'), html``); err(''); setHtml($('emp-moneda'), html``); errMoneda(''); });

export function init() {
  $('emp-umb-campos').addEventListener('input', pintarEscala);
  // Enter en cualquier campo guarda (sin buscar el botón).
  $('emp-umb-form').addEventListener('submit', e => { e.preventDefault(); guardar(); });
  $('emp-moneda-form').addEventListener('submit', e => { e.preventDefault(); guardarMoneda(); });
}
