// Buscador de vehículos por matrícula, número de coche o número de quema (abre el vehículo donde está montado el neumático). Lo comparten la barra superior (todas las pantallas) y Inicio:
// cada <form data-buscador> con su <input> y su <ul class="busq-resultados"> se monta con initBuscador().
// Tiene su propio catálogo de vehículos (paginado, sin depender de que Vehículos esté cargada ni del estado de los
// neumáticos, que es una consulta pesada): se carga al iniciar sesión y se renueva cada 5 minutos o al invalidarlo.
// Enter abre el detalle si hay una coincidencia; si hay varias, muestra la lista. Atajo "/" para enfocarlo.
import { db } from './supabase.js';
import { html, setHtml, joinHtml } from './html.js';
import { isClienteMode, currentClienteId, currentSucursalId, onLogin, onLogout } from './auth.js';
import { runAction, registerActions } from './actions.js';
import { filtrarFilas, listaSucursales } from './seccional.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';
import { quemaCoincidente } from '../domain/vehiculo-busqueda.js';
import { resolverBusquedaConStock, etiquetaCondicion, nombreUbicacion } from '../domain/stock-cubiertas.js';
import { etiquetaCoche } from '../domain/coche.js';

const COLS = 'id,nombre,patente,numero,activo,cliente_id,sucursal_id';
const VIGENCIA_MS = 5 * 60 * 1000;
const MAX_RESULTADOS = 8;
const MAX_VEHICULOS = 50000;

let catalogo = [];
let cubiertas = [];
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

// Números de quema de los neumáticos montados, por vehículo. La RLS acota qué ve cada perfil; si la consulta falla
// la búsqueda por matrícula y número de coche sigue funcionando.
async function traerQuemas() {
  const r = await fetchAll((from, to) => {
    let q = db.from('neumaticos').select('vehiculo_id,numero_quema').eq('estado', 'montado')
      .not('numero_quema', 'is', null).order('id').range(from, to);
    if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
    return q;
  }, { pageSize: PAGE_SIZE, max: MAX_VEHICULOS });
  if (r.error) return new Map();
  const porVehiculo = new Map();
  for (const n of r.rows) {
    if (!n.numero_quema) continue;
    if (!porVehiculo.has(n.vehiculo_id)) porVehiculo.set(n.vehiculo_id, []);
    porVehiculo.get(n.vehiculo_id).push(n.numero_quema);
  }
  return porVehiculo;
}

// Cubiertas en stock con quema (neumáticos sin vehículo): solo las ve el admin o el perfil global (la RLS devuelve 0 filas
// al de sucursal, que ni siquiera hace la consulta). Si falla, la búsqueda de vehículos sigue funcionando.
async function traerCubiertas() {
  if (isClienteMode() && currentSucursalId !== null) return [];
  const r = await fetchAll((from, to) => {
    let q = db.from('neumaticos').select('id,numero_quema,marca,modelo,condicion,sucursal_id,cliente_id,clientes(nombre),sucursales(nombre)')
      .is('vehiculo_id', null).not('numero_quema', 'is', null).order('id').range(from, to);
    if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
    return q;
  }, { pageSize: PAGE_SIZE, max: MAX_VEHICULOS });
  return r.error ? [] : r.rows;
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
      if (r.error) { fallo = true; catalogo = []; cubiertas = []; } else {
        let quemas = new Map();
        try { quemas = await traerQuemas(); } catch (_e) { /* sin quemas: se busca igual por matrícula y coche */ }
        catalogo = r.rows.map(v => (quemas.has(v.id) ? { ...v, quemas: quemas.get(v.id) } : v));
        try { cubiertas = await traerCubiertas(); } catch (_e) { cubiertas = []; }
      }
    } catch (_e) { fallo = true; catalogo = []; }
    cargadoEn = Date.now(); enCurso = false;
    return !fallo;
  })();
  return promesa;
}

// Tras alta, edición o baja de un vehículo: el catálogo se vuelve a pedir en la próxima búsqueda.
export function invalidarCatalogo() { cargadoEn = 0; }
// Un cambio de neumático puede traer otro número de quema (evento de views/cambio-neumatico.js; sin importarlo: core no depende de views).
document.addEventListener('neumet:neumatico-cambiado', invalidarCatalogo);
// Alta, traslado o eliminación de una cubierta en stock (views/stock.js).
document.addEventListener('neumet:stock-cambiado', invalidarCatalogo);

// Vehículos buscables: el cliente solo busca activos; la sucursal elegida acota.
const visibles = () => filtrarFilas(catalogo.filter(v => !isClienteMode() || v.activo !== false), 'id');

function metaDe(v, texto) {
  const partes = [v.patente || 'Sin matrícula'];
  // El nombre ya muestra "Coche 106"; el número se repite solo si es otro dato (vehículos anteriores).
  const coche = v.numero !== null && v.numero !== undefined && v.numero !== '' ? `Coche ${v.numero}` : '';
  if (coche && coche !== etiquetaCoche(v.nombre)) partes.push(coche);
  const quema = quemaCoincidente(v, texto);
  if (quema) partes.push(`Quema ${quema}`);
  if (!isClienteMode() && v.clientes && v.clientes.nombre) partes.push(v.clientes.nombre);
  if (v.activo === false) partes.push('Inactivo');
  return partes.join(' · ');
}

const opcionVehiculo = (v, texto) => html`<li><button type="button" class="busq-op" data-action="verVehiculo" data-args="${JSON.stringify([v.id])}">
  <span class="busq-nom">${etiquetaCoche(v.nombre)}</span><span class="busq-meta">${metaDe(v, texto)}</span></button></li>`;

// Cubierta en stock: abre Stock filtrado por su quema.
const metaCubierta = c => [`En stock`, [c.marca, c.modelo].filter(Boolean).join(' ') || 'Sin marca', etiquetaCondicion(c.condicion),
  c.sucursales && c.sucursales.nombre ? c.sucursales.nombre : nombreUbicacion(c.sucursal_id, listaSucursales()), !isClienteMode() && c.clientes && c.clientes.nombre].filter(Boolean).join(' · ');
const opcionCubierta = c => html`<li><button type="button" class="busq-op" data-action="verStockQuema" data-args="${JSON.stringify([c.numero_quema])}">
  <span class="busq-nom">Quema ${c.numero_quema}</span><span class="busq-meta">${metaCubierta(c)}</span></button></li>`;
const opcion = (it, texto) => (it.tipo === 'cubierta' ? opcionCubierta(it.cubierta) : opcionVehiculo(it.vehiculo, texto));

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
    return resolverBusquedaConStock(visibles(), cubiertas, texto, MAX_RESULTADOS);
  }

  function pintar(r) {
    if (!r || r.accion === 'vacio') { cerrar(); return; }
    if (r.accion === 'ninguno') { mensaje('Ningún vehículo coincide.'); return; }
    const resto = r.total - r.items.length;
    setHtml(lista, joinHtml([
      r.items.map(v => opcion(v, input.value)),
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
    if (r.accion === 'abrir-stock') { runAction('verStockQuema', [r.cubierta.numero_quema]); limpiarTodos(); input.blur(); return; }
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
onLogout(() => { catalogo = []; cubiertas = []; promesa = null; enCurso = false; fallo = false; cargadoEn = 0; limpiarTodos(); });
