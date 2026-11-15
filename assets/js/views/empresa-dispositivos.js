import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { setStatus, showToast, userError } from '../core/ui.js';
import { chip, estadoVacio, estadoCarga, estadoError, filaEstado } from '../core/componentes.js';
import { fmtNum, fmtFechaHora } from '../domain/formato.js';
import { currentClienteId, onLogout } from '../core/auth.js';
import { registerView } from '../core/nav.js';
import { ACTIONS } from '../core/actions.js';
import { infoEstado, filtrarSalud, textoDias } from '../domain/salud.js';

// Empresa > Dispositivos (docs/17 §4.3, P6): los medidores de la empresa en solo lectura. El hardware lo gestiona el equipo
// Neumet: aquí no hay alta, edición ni baja. Lee v_salud_dispositivos (la RLS filtra por cliente).
const SIMBOLO = { activo: '✓', sin_actividad: '▲', caido: '✕', nunca: '–' };
const $ = id => document.getElementById(id);

export async function loadEmpresaDispositivos() {
  setHtml($('tbody-empresa-dispositivos'), filaEstado(6, estadoCarga('Cargando…')));
  const { data, error } = await db.from('v_salud_dispositivos')
    .select('dispositivo_id,cliente_id,mac_address,nombre,activo,ultima_actividad_at,total_mediciones,dias_sin_actividad,estado')
    .eq('cliente_id', currentClienteId)
    .order('dias_sin_actividad', { ascending: false, nullsFirst: false });
  if (error) { setStatus(false); showToast(userError(error), true); setHtml($('tbody-empresa-dispositivos'), filaEstado(6, estadoError('', 'loadEmpresaDispositivos'))); return; }
  setStatus(true);
  const lista = filtrarSalud(data || []);
  if (!lista.length) { setHtml($('tbody-empresa-dispositivos'), filaEstado(6, estadoVacio('Sin dispositivos registrados', 'Los dispositivos los registra el equipo Neumet.'))); return; }
  setHtml($('tbody-empresa-dispositivos'), joinHtml(lista.map(r => {
    const i = infoEstado(r.estado);
    return html`<tr data-estado="${r.estado}">
      <td>${chip(i.cls, i.lbl, SIMBOLO[r.estado] || '●')}</td>
      <td><span class="mono-cell salud-mac">${r.mac_address}</span></td>
      <td>${r.nombre ? r.nombre : html`<span class="salud-muted">—</span>`}</td>
      <td class="mono-cell salud-fecha">${r.ultima_actividad_at ? fmtFechaHora(r.ultima_actividad_at) : 'Sin mediciones'}</td>
      <td class="salud-num">${textoDias(r)}</td>
      <td class="salud-num">${fmtNum(r.total_mediciones || 0)}${r.activo === false ? html` <span class="badge gray">Desactivado</span>` : ''}</td>
    </tr>`;
  })));
}

ACTIONS.loadEmpresaDispositivos = loadEmpresaDispositivos;
registerView('empresa-dispositivos', 'Dispositivos de la empresa', loadEmpresaDispositivos, { soloEmpresa: true });
onLogout(() => { setHtml($('tbody-empresa-dispositivos'), html``); });
export function init() {}
