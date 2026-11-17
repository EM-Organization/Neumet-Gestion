import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast, userError } from '../core/ui.js';
import { currentClienteId, onLogout } from '../core/auth.js';
import { devolverFoco } from '../core/foco.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { comaDecimal } from '../domain/formato.js';
import { CAMPOS_UMBRAL, validarUmbrales } from '../domain/umbrales.js';
import { argsAlertaConfigurar, mensajeErrorConfigurar } from '../domain/empresa.js';

// Empresa > Umbrales (docs/17 §4.3): el administrador de empresa edita los umbrales de desgaste de su empresa.
// Escribe con la RPC alerta_configurar (la base decide quién puede); no hace UPDATE directo sobre clientes.
const $ = id => document.getElementById(id);
const COLS = CAMPOS_UMBRAL.map(c => c.key).join(',');
const err = msg => { const el = $('emp-umb-error'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };

function render(c) {
  setHtml($('emp-umb-campos'), joinHtml(CAMPOS_UMBRAL.map(f => html`<div class="field">
    <label for="eu-${f.key}">${f.lbl}</label>
    <input type="text" inputmode="decimal" id="eu-${f.key}" data-umbral="${f.key}" value="${comaDecimal(c[f.key] ?? '')}"/>
    <div class="ficha-ayuda">${f.ayuda}</div>
  </div>`)));
}

export async function loadEmpresaUmbrales() {
  err('');
  const { data, error } = await db.from('clientes').select('id,' + COLS).eq('id', currentClienteId).maybeSingle();
  if (error || !data) { if (error) userError(error); err('No se pudieron cargar los umbrales. Actualizar para reintentar.'); return; }
  render(data);
}

async function guardar() {
  const raw = {};
  document.querySelectorAll('#emp-umb-campos [data-umbral]').forEach(i => { raw[i.dataset.umbral] = i.value; });
  const v = validarUmbrales(raw);
  if (!v.ok) { err(v.error); return; }
  err('');
  const btn = $('emp-umb-guardar');
  const enfocado = document.activeElement && document.activeElement.id; // campo desde el que se guardó (Enter) o el botón
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const { error } = await db.rpc('alerta_configurar', argsAlertaConfigurar(currentClienteId, v.valores));
    if (error) { err(mensajeErrorConfigurar(error)); return; }
    showToast('Umbrales actualizados');
    await loadEmpresaUmbrales();
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar umbrales';
    // La recarga repinta los campos: el foco vuelve al mismo campo (o al botón) para seguir con el teclado.
    devolverFoco(enfocado && `#${enfocado}`, '#emp-umb-guardar');
  }
}

ACTIONS.loadEmpresaUmbrales = registerView('empresa-umbrales', 'Umbrales', loadEmpresaUmbrales, { soloEmpresa: true });
onLogout(() => { setHtml($('emp-umb-campos'), html``); err(''); });

export function init() {
  // Enter en cualquier campo guarda (sin buscar el botón).
  $('emp-umb-form').addEventListener('submit', e => { e.preventDefault(); guardar(); });
}
