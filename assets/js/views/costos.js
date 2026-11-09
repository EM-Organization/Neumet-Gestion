// Modal «Registrar costo» de un neumático (RPC costo_registrar). Lo abren el panel de la rueda y Ciclo de vida; quien
// lo abre pasa `alGuardar` para recargar su vista. La autorización real vive en la base (admin o perfil global del
// cliente): aquí solo se oculta la acción a quien no puede (puedeGestionarCostos).
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { isClienteMode, esAdmin, currentSucursalId } from '../core/auth.js';
import { ACTIONS, registerActions } from '../core/actions.js';
import { CONCEPTOS, MONEDA_DEFECTO, validarCosto, traducirErrorCosto, ERROR_GENERICO_COSTO, puedeGestionarCostos } from '../domain/costos.js';

const $ = id => document.getElementById(id);
const hoyISO = () => new Date().toISOString().slice(0, 10);
let ctx = null;

export const puedeVerCostos = () => puedeGestionarCostos({ admin: esAdmin(), cliente: isClienteMode(), sucursalId: currentSucursalId });

const err = msg => { const el = $('costo-error'); el.textContent = msg || ''; };

// Abre el formulario para un neumático. `etiqueta`: texto que lo identifica (posición, marca, quema).
export function abrirRegistroCosto({ neumaticoId, etiqueta = '', alGuardar = null }) {
  if (!puedeVerCostos() || neumaticoId === null || neumaticoId === undefined) return;
  ctx = { neumaticoId, alGuardar };
  $('costo-sub').textContent = etiqueta;
  setHtml($('costo-concepto'), joinHtml([html`<option value="">Elegir concepto</option>`, ...CONCEPTOS.map(c => html`<option value="${c.id}">${c.label}</option>`)]));
  $('costo-monto').value = '';
  $('costo-moneda').value = MONEDA_DEFECTO;
  $('costo-fecha').value = hoyISO();
  $('costo-fecha').max = hoyISO();
  $('costo-notas').value = '';
  err('');
  $('modal-costo').classList.add('show');
}

registerActions({
  costoCerrar() { $('modal-costo').classList.remove('show'); ctx = null; },
  async costoGuardar() {
    if (!ctx) return;
    const r = validarCosto({
      neumaticoId: ctx.neumaticoId, concepto: $('costo-concepto').value, monto: $('costo-monto').value,
      moneda: $('costo-moneda').value, fecha: $('costo-fecha').value, notas: $('costo-notas').value,
    }, { hoy: hoyISO() });
    if (!r.ok) { err(r.error); return; }
    const btn = $('costo-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const { error } = await db.rpc('costo_registrar', r.args);
      if (error) {
        const m = traducirErrorCosto(error);
        if (m === ERROR_GENERICO_COSTO) console.error(error); // los rechazos de negocio (permiso, datos) no son fallos
        err(m); showToast(m, true);
        return;
      }
      const alGuardar = ctx.alGuardar;
      ACTIONS.costoCerrar();
      showToast('Costo registrado');
      if (alGuardar) await alGuardar();
    } finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  },
});

export function init() { /* sin listeners propios: todo va por data-action */ }
