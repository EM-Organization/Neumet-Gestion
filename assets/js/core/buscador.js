// Buscador de vehículos por matrícula o número de coche. Lo comparten la barra superior (todas las pantallas) y Inicio:
// cada <form data-buscador> con su <input> y su <ul class="busq-resultados"> se monta con initBuscador().
// Tiene su propio catálogo de vehículos (paginado, sin depender de que Vehículos esté cargada ni del estado de los
// neumáticos, que es una consulta pesada): se carga al iniciar sesión y se renueva cada 5 minutos o al invalidarlo.
// Enter abre el detalle si hay una coincidencia; si hay varias, muestra la lista. Atajo "/" para enfocarlo.
import { db } from './supabase.js';
import { html, setHtml, joinHtml } from './html.js';
import { isClienteMode, currentClienteId, onLogin, onLogout } from './auth.js';
import { runAction, registerActions } from './actions.js';
import { filtrarFilas } from './seccional.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { resolverBusqueda } from '../domain/vehiculo-busqueda.js';

const COLS = 'id,nombre,patente,numero,activo,cliente_id,sucursal_id';
const VIGENCIA_MS = 5 * 60 * 1000;
const MAX_RESULTADOS = 8;
const MAX_VEHICULOS = 50000;

let catalogo = [];
let promesa = null;
let enCurso = false;
let fallo = false;
let cargadoEn = 0;
const montados = [];

function traer(conCliente) {
  return fetchAll((from, to) => {
    // Orden por id: la paginación con range() necesita un orden estable.
    let q = db.from('vehiculos').select(conCliente ? `${COLS},clientes(nombre)` : COLS).order('id').range(from, to);
    if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
    return q;
  }, { pageSize: PAGE_SIZE, max: MAX_VEHICULOS });
}

// Carga (o reutiliza) el catálogo. Devuelve true si hay catálogo utilizable.
export function cargarCatalogo(forzar = false) {
  const vigente = promesa && (enCurso || (!fallo && Date.now() - cargadoEn < VIGENCIA_MS));
  if (vigente && !forzar) return promesa;
  enCurso = true; fallo = false;
  promesa = (async () => {
    try {
      let r = await traer(true);
      if (r.error) r = await traer(false); // por si falla la relación con clientes: se busca igual, sin el nombre del cliente
      if (r.error) { fallo = true; catalogo = []; } else catalogo = r.rows;
    } catch (_e) { fallo = true; catalogo = []; }
    cargadoEn = Date.now(); enCurso = false;
    return !fallo;
  })();
  return promesa;
}

// Tras alta, edición o baja de un vehículo: el catálogo se vuelve a pedir en la próxima búsqueda.
export function invalidarCatalogo() { cargadoEn = 0; }

// Vehículos buscables: el cliente solo busca activos; la seccional elegida acota.
const visibles = () => filtrarFilas(catalogo.filter(v => !isClienteMode() || v.activo !== false), 'id');

function metaDe(v) {
  const partes = [v.patente || 'Sin matrícula'];
  if (v.numero !== null && v.numero !== undefined && v.numero !== '') partes.push(`Coche ${v.numero}`);
  if (!isClienteMode() && v.clientes && v.clientes.nombre) partes.push(v.clientes.nombre);
  if (v.activo === false) partes.push('Inactivo');
  return partes.join(' · ');
}

const opcion = v => html`<li><button type="button" class="busq-op" data-action="verVehiculo" data-args="${JSON.stringify([v.id])}">
  <span class="busq-nom">${v.nombre}</span><span class="busq-meta">${metaDe(v)}</span></button></li>`;

function montar(form) {
  const input = form.querySelector('input');
  const lista = form.querySelector('.busq-resultados');
  let ticket = 0;
  const estado = { input, lista };
  montados.push(estado);

  const cerrar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const abrir = () => { lista.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const mensaje = (txt, accion) => {
    setHtml(lista, html`<li class="busq-msg" role="status">${txt}${accion ? html` <button type="button" class="busq-reintentar" data-action="buscadorReintentar">${accion}</button>` : ''}</li>`);
    abrir();
  };
  estado.cerrar = cerrar;

  async function resolver(texto) {
    const mi = ++ticket;
    if (!texto.trim()) { cerrar(); return null; }
    if (!promesa || enCurso) mensaje('Cargando vehículos…');
    await cargarCatalogo();
    if (mi !== ticket) return null;
    if (fallo) { mensaje('No se pudo cargar la búsqueda.', 'Reintentar'); return null; }
    return resolverBusqueda(visibles(), texto, MAX_RESULTADOS);
  }

  function pintar(r) {
    if (!r || r.accion === 'vacio') { cerrar(); return; }
    if (r.accion === 'ninguno') { mensaje('Ningún vehículo coincide.'); return; }
    const resto = r.total - r.items.length;
    setHtml(lista, joinHtml([
      r.items.map(opcion),
      resto > 0 ? html`<li class="busq-msg">${resto} más: escribir más caracteres para acotar.</li>` : '',
    ]));
    abrir();
  }

  input.addEventListener('input', async () => pintar(await resolver(input.value)));
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); cargarCatalogo(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await resolver(input.value);
    if (!r) return;
    if (r.accion === 'abrir') { runAction('verVehiculo', [r.vehiculo.id]); limpiarTodos(); input.blur(); return; }
    pintar(r);
    const primero = lista.querySelector('.busq-op');
    if (r.accion === 'lista' && primero) primero.focus();
  });

  form.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !lista.hidden) { cerrar(); input.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const ops = [...lista.querySelectorAll('.busq-op')];
    if (!ops.length) return;
    e.preventDefault();
    const i = ops.indexOf(document.activeElement);
    const sig = e.key === 'ArrowDown' ? i + 1 : i - 1;
    if (sig < 0) input.focus(); else ops[Math.min(sig, ops.length - 1)].focus();
  });
}

function limpiarTodos() { montados.forEach(m => { m.input.value = ''; m.cerrar(); }); }

registerActions({ buscadorReintentar: () => { cargarCatalogo(true).then(() => montados.forEach(m => { if (m.input.value.trim()) m.input.dispatchEvent(new Event('input')); })); } });

export function initBuscador() {
  document.querySelectorAll('form[data-buscador]').forEach(montar);
  // Al elegir un resultado se limpia el buscador (después de que la acción haya leído sus datos).
  document.addEventListener('click', e => {
    if (e.target.closest('.busq-op')) { setTimeout(limpiarTodos, 0); return; }
    if (!e.target.closest('form[data-buscador]')) montados.forEach(m => m.cerrar());
  });
  // Atajo "/" desde cualquier pantalla, salvo al escribir en un campo o con un diálogo abierto.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('.modal-backdrop.show')) return;
    // Buscador visible: el de la barra, el de Inicio o el de la lista de Vehículos.
    const inp = [...montados.map(x => x.input), document.getElementById('search-vehiculos')].find(i => i && i.getClientRects().length > 0);
    if (!inp) return;
    e.preventDefault();
    inp.focus(); inp.select();
  });
}

onLogin(() => { cargarCatalogo(true); });
onLogout(() => { catalogo = []; promesa = null; enCurso = false; fallo = false; cargadoEn = 0; limpiarTodos(); });
