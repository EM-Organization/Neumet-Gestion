// Cambio de neumático en el taller: el gomero (cliente global o de sucursal) o el admin registra, en una sola
// pantalla, qué pasó con el neumático viejo y cuál entró. Toda la escritura pasa por la RPC atómica neumatico_cambiar
// (la autorización se verifica en la base: otro cliente u otra sucursal reciben "permiso denegado").
// Acciones: neumatico-cambiar (vehiculoId, posicion), neumatico-rotar-pos (vehiculoId, posA, posB: abre el diálogo de rotar;
// posB «disco» abre el de rotar en disco), vehiculo-alinear (vehiculoId: abre el de registrar alineación).
// Al terminar emite el evento DOM "neumet:neumatico-cambiado" y recarga la vista activa (flota/vehículo/inicio/alertas).
import { tipoLayout } from '../domain/distribucion.js';
import { db } from '../core/supabase.js';
import { html, setHtml, joinHtml } from '../core/html.js';
import { showToast } from '../core/ui.js';
import { ACTIONS } from '../core/actions.js';
import { esAdmin, esAdminEmpresa } from '../core/auth.js';
import { etiquetaCoche } from '../domain/coche.js';
import { reloadActiveView } from '../core/nav.js';
import {
  DESTINOS, nombrePos, etiquetaVida, stockDisponible, etiquetaStock, validarCambio, traducirErrorCambio, validarRotacion, avisoRotacion,
  validarDatosRotacion, traducirErrorRotacion, validarRotacionDisco, avisoRotacionDisco, validarDatosRotacionDisco,
  validarAlineacion, avisoAlineacion, validarDatosAlineacion, traducirErrorAlineacion
} from '../domain/cambio-neumatico.js';
import { motivosDelTipo, tipoMotivoCambio, TIPO_MOTIVO, MOTIVO_OTRO } from '../domain/motivos.js';
import { cargarMotivosCliente } from '../core/motivos.js';
import { fmtNum } from '../domain/formato.js';
import { cubiertasMontables, etiquetaCondicion, nombreUbicacion, SIN_SUCURSAL } from '../domain/stock-cubiertas.js';
import { MAX_LISTA, cubiertasParaMontar } from '../domain/montaje.js';

export const EVENTO_CAMBIO = 'neumet:neumatico-cambiado';
const $ = id => document.getElementById(id);
const val = id => { const el = $(id); return el ? el.value : ''; };
const NEUM_COLS = 'id,vehiculo_id,cliente_id,posicion,marca,modelo,idneumatico,vida,estado,numero_quema';
// RN-14: el motivo que viene marcado en un cambio o una baja. En la rotación no hay preselección: lo elige el operario.
const MOTIVO_PREDETERMINADO = 'desgaste';

let ctx = null; // {veh, neum, stock, cubiertas, sucursales, puedeStock}
let ocupado = false;
let rotando = false;
let rotCtx = null; // diálogo «Rotar» abierto: {vehiculoId, posA, posB, veh, tipo, coche, intercambio, catalogo, odometroObligatorio}

// Espera máxima de la base. Si vence NO se reintenta: la operación pudo haberse aplicado igual y repetirla duplicaría el cambio.
// Se recarga el detalle para que el operario vea el estado real. Configurable para las pruebas.
export const config = { timeoutMs: 20000 };
const TARDE = Symbol('tarde');
function conLimite(promesa) {
  let t;
  const limite = new Promise(res => { t = setTimeout(() => res(TARDE), config.timeoutMs); });
  // La respuesta tardía se descarta: ni éxito ni error se pintan sobre una pantalla que ya siguió adelante.
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(t));
}

function notificarCambio(detalle) {
  document.dispatchEvent(new CustomEvent(EVENTO_CAMBIO, { detail: detalle }));
  try { reloadActiveView(); } catch (e) { console.error(e); }
}

function radio(name, id, label, checked, change) {
  return html`<label class="cambio-op"><input type="radio" name="${name}" value="${id}" ${checked ? 'checked' : ''}
    data-change="${change}"/> <span>${label}</span></label>`;
}

function estado() {
  const dest = document.querySelector('input[name="cambio-destino"]:checked');
  const orig = document.querySelector('input[name="cambio-origen"]:checked');
  return {
    neum: ctx && ctx.neum, destino: dest ? dest.value : '', motivoCodigo: val('cambio-motivo'), motivoTexto: val('cambio-motivo-texto'),
    catalogo: ctx ? ctx.catalogo : [], odometroObligatorio: !!(ctx && ctx.odometroObligatorio),
    origen: orig ? orig.value : '', stockId: val('cambio-stock'), stock: ctx ? ctx.stock : [],
    marca: val('cambio-marca'), modelo: val('cambio-modelo'), odometro: val('cambio-odo'),
    numeroQuema: val('cambio-quema'), kmPrevios: val('cambio-km-previos'),
    odometroActual: ctx && ctx.veh ? ctx.veh.odometro_km : null, tipo: ctx && ctx.veh ? tipoLayout(ctx.veh) : null,
    cubiertaId: ctx ? ctx.cubiertaId : null, cubiertas: ctx ? ctx.cubiertas : [], sucursales: ctx ? ctx.sucursales : [],
    // Solo admin y perfil global gestionan el stock: ahí «Almacenar» devuelve el neumático al stock.
    devolverStock: !!(ctx && ctx.puedeStock), sucursalStock: val('cambio-retorno-suc'), quemaViejo: val('cambio-quema-viejo')
  };
}

// Lista de motivos del tipo (baja o cambio). Queda el anterior si sigue en la lista; si no, «desgaste» (RN-14).
function pintarMotivos(tipo, anterior) {
  const sel = $('cambio-motivo');
  const lista = motivosDelTipo(ctx.catalogo, tipo);
  const en = codigo => lista.some(m => m.codigo === codigo);
  setHtml(sel, joinHtml([
    html`<option value="">Elegir motivo</option>`,
    lista.map(m => html`<option value="${m.codigo}">${m.etiqueta}</option>`)
  ]));
  sel.value = en(anterior) ? anterior : (en(MOTIVO_PREDETERMINADO) ? MOTIVO_PREDETERMINADO : '');
  sel.dataset.tipo = tipo;
}

// La última lectura del vehículo es la referencia: la base no acepta una lectura menor (RN-12).
function pistaOdometro(actual, obligatorio) {
  const pref = obligatorio ? 'Obligatorio' : 'Opcional';
  const hay = actual !== null && actual !== undefined;
  return hay ? `${pref}. No puede ser menor al actual (${fmtNum(actual)} km).` : `${pref}. Lectura actual del vehículo.`;
}

function actualizar() {
  let f = estado();
  // El catálogo depende del destino (baja usa el de baja; el resto, el de cambio): al cambiar de tipo se rearma la lista.
  const tipo = tipoMotivoCambio(f.destino);
  if ($('cambio-motivo').dataset.tipo !== tipo) { pintarMotivos(tipo, f.motivoCodigo); f = estado(); }
  $('cambio-motivo-texto-wrap').style.display = f.motivoCodigo === MOTIVO_OTRO ? '' : 'none';
  $('cambio-cubierta-wrap').style.display = f.origen === 'cubierta' ? '' : 'none';
  $('cambio-stock-wrap').style.display = f.origen === 'stock' ? '' : 'none';
  $('cambio-nuevo-wrap').style.display = f.origen === 'nuevo' ? '' : 'none';
  // La cubierta del stock ya trae su quema y sus km.
  $('cambio-quema-km-wrap').style.display = f.origen === 'cubierta' ? 'none' : '';
  const vuelve = f.destino === 'almacenado' && f.devolverStock;
  $('cambio-retorno-wrap').style.display = vuelve ? 'block' : 'none';
  $('cambio-quema-viejo-wrap').style.display = vuelve && ctx && ctx.neum && !ctx.neum.numero_quema ? '' : 'none';
  const r = validarCambio(f);
  $('cambio-resumen').textContent = r.ok ? r.resumen : 'Completar los datos para ver el resumen';
  $('cambio-error').textContent = '';
  return r;
}

// Cubiertas del stock, como en Montar: el buscador filtra y ninguna viene marcada. La elegida que sale del filtro se
// desmarca, para que lo que se ve marcado sea lo que se envía.
function pintarLista() {
  const filtradas = cubiertasParaMontar(ctx.cubiertas, val('cambio-buscar'));
  const vistas = filtradas.slice(0, MAX_LISTA);
  if (ctx.cubiertaId !== null && !filtradas.some(c => String(c.id) === String(ctx.cubiertaId))) ctx.cubiertaId = null;
  if (!vistas.length) {
    setHtml($('cambio-lista'), html`<div class="mont-vacio">${ctx.cubiertas.length ? 'Ninguna cubierta coincide. Cambiar la búsqueda.' : 'Sin cubiertas en stock. Elegir un lote.'}</div>`);
    return;
  }
  setHtml($('cambio-lista'), html`${vistas.map(c => html`<label class="mont-fila"><input type="radio" name="cambio-cubierta" value="${c.id}" ${String(ctx.cubiertaId) === String(c.id) ? 'checked' : ''} data-change="neumatico-cambiar-cubierta"/>
    <span class="mont-quema">${c.numero_quema || 'Sin quema'}</span>
    <span class="mont-desc">${[c.marca, c.modelo].filter(Boolean).join(' ') || 'Sin marca'}</span>
    <span class="mont-meta">${etiquetaCondicion(c.condicion)} · ${nombreUbicacion(c.sucursal_id, ctx.sucursales)}</span></label>`)}${
    filtradas.length > vistas.length ? html`<div class="mont-vacio">Se muestran ${vistas.length} de ${filtradas.length}. Usar el buscador para acotar.</div>` : ''}`);
}

function pintar() {
  const { veh, neum, stock, cubiertas, sucursales } = ctx;
  const hayStock = stock.length > 0, hayCubiertas = cubiertas.length > 0;
  $('cambio-sub').textContent = veh && veh.nombre ? etiquetaCoche(veh.nombre) : 'Registro del cambio hecho en el taller';
  setHtml($('cambio-actual'), html`<div>Neumático actual en <strong>${nombrePos(neum.posicion, tipoLayout(veh))}</strong>:
    <strong>${[neum.marca, neum.modelo].filter(Boolean).join(' ') || 'Sin marca'}</strong>
    · ${neum.estado || 'montado'} · ${etiquetaVida(neum.vida)}${neum.numero_quema ? html` · quema ${neum.numero_quema}` : ''}${veh && veh.odometro_km != null ? html` · vehículo con ${fmtNum(veh.odometro_km)} km` : ''}</div>`);
  setHtml($('cambio-destinos'), joinHtml(DESTINOS.map((d, i) => radio('cambio-destino', d.id, d.label, i === 0, 'neumatico-cambiar-resumen'))));
  setHtml($('cambio-origenes'), joinHtml([
    hayCubiertas ? radio('cambio-origen', 'cubierta', 'Cubierta del stock', true, 'neumatico-cambiar-resumen') : '',
    hayStock ? radio('cambio-origen', 'stock', 'Lote del stock', !hayCubiertas, 'neumatico-cambiar-resumen') : '',
    radio('cambio-origen', 'nuevo', 'Ingresar uno nuevo', !hayStock && !hayCubiertas, 'neumatico-cambiar-resumen')
  ]));
  // Nada viene elegido: ni la cubierta ni el lote. Solo el origen por defecto queda fijado (arriba).
  ctx.cubiertaId = null; $('cambio-buscar').value = ''; pintarLista();
  setHtml($('cambio-retorno-suc'), joinHtml([html`<option value="">${SIN_SUCURSAL}</option>`,
    sucursales.map(x => html`<option value="${x.id}">${x.nombre}</option>`)]));
  $('cambio-quema-viejo').value = '';
  setHtml($('cambio-stock'), joinHtml([html`<option value="">Elegir lote</option>`,
    stock.map(s => html`<option value="${s.id}">${etiquetaStock(s)}</option>`)]));
  $('cambio-stock').value = '';
  pintarMotivos(tipoMotivoCambio(DESTINOS[0].id), MOTIVO_PREDETERMINADO); // el primer destino (baja) viene marcado
  $('cambio-motivo-texto').value = '';
  $('cambio-marca').value = ''; $('cambio-modelo').value = ''; $('cambio-odo').value = '';
  $('cambio-quema').value = ''; $('cambio-km-previos').value = '0';
  $('cambio-odo-opt').textContent = ctx.odometroObligatorio ? '(obligatorio)' : '(opcional)';
  $('cambio-odo-hint').textContent = pistaOdometro(veh.odometro_km, ctx.odometroObligatorio);
  $('cambio-confirmar').disabled = false;
  actualizar();
}

const AVISO_EN_CURSO = 'Esperar a que termine el cambio en curso';

async function abrir(vehiculoId, posicion) {
  // Un cambio en vuelo es de otro neumático: abrir otro modal ahora haría que su respuesta cerrara el equivocado.
  if (ocupado) { showToast(AVISO_EN_CURSO, true); return; }
  if (!Number.isInteger(vehiculoId) || !Number.isInteger(posicion)) { showToast('Elegir el neumático a cambiar', true); return; }
  const [rv, rn] = await Promise.all([
    db.from('vehiculos').select('id,nombre,cliente_id,odometro_km,tipo_ruedas,distribucion').eq('id', vehiculoId).maybeSingle(),
    db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vehiculoId).eq('posicion', posicion).maybeSingle()
  ]);
  if (rv.error || rn.error) { console.error(rv.error || rn.error); showToast('No se pudo cargar el neumático. Reintentar', true); return; }
  const neum = rn.data, veh0 = rv.data || {};
  if (!neum) { showToast(`No hay un neumático montado en ${nombrePos(posicion, tipoLayout(veh0))}`, true); return; }
  if (neum.estado === 'baja') { showToast(`El neumático de ${nombrePos(posicion, tipoLayout(veh0))} ya está dado de baja`, true); return; }
  const veh = rv.data || { id: vehiculoId };
  // El stock es del cliente del vehículo; la RLS ya limita qué ve cada perfil (el de sucursal no ve ninguno).
  const puedeStock = esAdminEmpresa();
  const [rs, rc, rsu, rm] = await Promise.all([
    db.from('stock_neumaticos').select('id,marca,modelo,cantidad,precio_unidad').eq('cliente_id', neum.cliente_id).gte('cantidad', 1),
    puedeStock
      ? db.from('neumaticos').select('id,numero_quema,marca,modelo,condicion,sucursal_id,vehiculo_id,estado')
        .is('vehiculo_id', null).eq('estado', 'almacenado').eq('cliente_id', neum.cliente_id).order('numero_quema')
      : Promise.resolve({ data: [] }),
    puedeStock ? db.from('sucursales').select('id,nombre').eq('cliente_id', neum.cliente_id).order('nombre') : Promise.resolve({ data: [] }),
    cargarMotivosCliente(neum.cliente_id)
  ]);
  // Sin catálogo ni flag el diálogo no se abre: no se adivina si el odómetro es obligatorio.
  if (!rm) { showToast('No se pudieron cargar los motivos. Reintentar', true); return; }
  const stock = rs.error ? [] : stockDisponible(rs.data);
  const cubiertas = rc.error ? [] : cubiertasMontables(rc.data);
  const sucursales = rsu.error ? [] : (rsu.data || []);
  // Un cambio pudo empezar mientras se cargaba este: no se reemplaza el contexto del que está en vuelo.
  if (ocupado) { showToast(AVISO_EN_CURSO, true); return; }
  ctx = { veh, neum: { ...neum, vehiculo_id: vehiculoId }, stock, cubiertas, cubiertaId: null, sucursales, puedeStock, catalogo: rm.catalogo, odometroObligatorio: rm.odometroObligatorio };
  pintar();
  $('modal-cambio').classList.add('show');
}

// El equipo Neumet no opera dentro de una empresa (docs/17 P1): la acción no se ofrece en la interfaz y además se rechaza aquí,
// porque un botón ajeno con este data-action (o una vista que no filtre) no debe abrir el modal.
ACTIONS['neumatico-cambiar'] = async function (vehiculoId, posicion) { if (esAdmin()) return; await abrir(Number(vehiculoId), Number(posicion)); };
ACTIONS['neumatico-cambiar-resumen'] = function () { if (ctx) actualizar(); };
ACTIONS['neumatico-cambiar-cubierta'] = function (id) { if (ctx) { ctx.cubiertaId = Number(id); actualizar(); } };
ACTIONS['neumatico-cambiar-cerrar'] = function () { $('modal-cambio').classList.remove('show'); ctx = null; };

// Guarda de rol: defensa en profundidad (el botón no se ofrece al equipo Neumet y la RPC lo rechaza); ningún test la cubre.
// Se envía desde el submit del formulario (Enter o clic): un solo camino, protegido por `ocupado` contra el doble envío.
ACTIONS['neumatico-cambiar-confirmar'] = async function () {
  if (!ctx || ocupado || esAdmin()) return;
  // Enter con una sola coincidencia en el buscador elige esa cubierta y envía (docs/14 §5, regla 3), igual que en Montar.
  // Exige texto: sin él, una única cubierta del stock se enviaría con un Enter suelto.
  let f = estado();
  if (f.origen === 'cubierta' && f.cubiertaId === null && val('cambio-buscar').trim()) {
    const unica = cubiertasParaMontar(ctx.cubiertas, val('cambio-buscar'));
    if (unica.length === 1) { ctx.cubiertaId = unica[0].id; pintarLista(); f = estado(); }
  }
  const r = validarCambio(f);
  if (!r.ok) {
    $('cambio-error').textContent = r.error; showToast(r.error, true);
    // Sin cubierta ni lote elegidos, el foco va al campo que falta
    if (f.origen === 'cubierta' && f.cubiertaId === null) $('cambio-buscar').focus();
    else if (f.origen === 'stock' && f.stockId === '') $('cambio-stock').focus();
    return;
  }
  ocupado = true; $('cambio-confirmar').disabled = true;
  const mio = ctx; // la respuesta solo toca el modal del neumático que la originó
  const { posicion, vehiculo_id: vehiculoId } = ctx.neum, ctxTipo = tipoLayout(ctx.veh);
  const coche = ctx.veh && ctx.veh.nombre ? etiquetaCoche(ctx.veh.nombre) : '';
  try {
    const res = await conLimite(db.rpc('neumatico_cambiar', r.params));
    if (res === TARDE) {
      if (ctx === mio) ACTIONS['neumatico-cambiar-cerrar']();
      showToast(`No se pudo confirmar el cambio${coche ? ' en ' + coche : ''}. Revisar el vehículo antes de reintentar`, true);
      try { reloadActiveView(); } catch (e) { console.error(e); }
      return;
    }
    if (res.error) throw res.error;
    if (ctx === mio) ACTIONS['neumatico-cambiar-cerrar']();
    showToast(`Cambio registrado en ${coche ? coche + ', ' : ''}${nombrePos(posicion, ctxTipo)}: el neumático nuevo ya figura montado`);
    document.dispatchEvent(new CustomEvent('neumet:stock-cambiado'));
    notificarCambio({ vehiculoId, posicion, resultado: res.data });
  } catch (e) {
    console.error(e);
    const msg = traducirErrorCambio(e);
    if (ctx === mio) $('cambio-error').textContent = msg;
    showToast(msg, true);
    if (ctx === mio) $('cambio-confirmar').disabled = false;
  } finally { ocupado = false; }
};

// Rotar entre dos posiciones (RN-12, RN-14), rotar en disco (RN-15) y registrar alineación (RN-16) comparten el diálogo
// #modal-rotar. El modo va en rotCtx.modo: 'posicion' | 'disco' | 'alineacion'. Cada modo tiene su tipo de motivo del
// catálogo, su llamada a la base y su aviso; el resto (odómetro, motivo, Enter) es el mismo.
const MODO = Object.freeze({ posicion: 'posicion', disco: 'disco', alineacion: 'alineacion' });
// Valor del select «Rotar con la posición» que elige la rotación en disco (no es una posición).
const DESTINO_DISCO = 'disco';
const TEXTO_MODO = Object.freeze({
  posicion: { titulo: 'Rotar neumáticos', boton: 'Rotar', nombre: 'la rotación', sub: 'Rotación entre posiciones del vehículo' },
  disco: { titulo: 'Rotar en disco', boton: 'Rotar', nombre: 'la rotación' },
  alineacion: { titulo: 'Registrar alineación', boton: 'Registrar alineación', nombre: 'la alineación', sub: 'Alineación del vehículo' }
});
const TIPO_MOTIVO_MODO = Object.freeze({ posicion: TIPO_MOTIVO.rotar, disco: TIPO_MOTIVO.rotarDisco, alineacion: TIPO_MOTIVO.alinear });
const VALIDAR_MODO = Object.freeze({ posicion: validarDatosRotacion, disco: validarDatosRotacionDisco, alineacion: validarDatosAlineacion });

// Una operación a la vez (`rotando`), para los tres modos: una sola variable del módulo, no una por modo.
// Diseño de concurrencia (docs/13 §1.b), con la prueba que lo cubre en tests/smoke/vehiculo.flow.js:
//   - Doble envío (dos Enter, Enter y clic): la guarda `rotando` deja salir una sola llamada a la RPC. La base también
//     es idempotente 30 s (duplicada: true).
//   - Enter mantenido (e.repeat): se ignora en el formulario, como en Montar.
//   - Operaciones distintas: abrir otra (p. ej. «Registrar alineación») con un disco en vuelo avisa y no toca rotCtx.
//   - Fallo a mitad (22023, 23514, red): el diálogo sigue abierto con el error en línea, un solo toast, y el botón vuelve.
//   - Respuesta que nunca llega: conLimite corta; el botón queda habilitado tras la recarga del detalle.
//   - Cerrar sesión en vuelo: la respuesta tardía solo toca el diálogo que la originó (rotCtx === mio).
function estadoRotar() {
  return {
    catalogo: rotCtx ? rotCtx.catalogo : [], motivoCodigo: val('rotar-motivo'), motivoTexto: val('rotar-motivo-texto'),
    odometro: val('rotar-odo'), odometroActual: rotCtx ? (rotCtx.veh.odometro_km ?? null) : null,
    odometroObligatorio: !!(rotCtx && rotCtx.odometroObligatorio)
  };
}

// Aviso del resumen (antes de confirmar): lo que va a pasar con la base todavía sin responder.
function resumenRotar() {
  const c = rotCtx;
  if (c.modo === MODO.disco) return avisoRotacionDisco(c.posA, c.tipo);
  if (c.modo === MODO.alineacion) return avisoAlineacion(c.cantidad);
  return avisoRotacion(c.posA, c.posB, c.tipo, !!c.intercambio);
}

function actualizarRotar() {
  const f = estadoRotar();
  $('rotar-motivo-texto-wrap').style.display = f.motivoCodigo === MOTIVO_OTRO ? '' : 'none';
  const r = VALIDAR_MODO[rotCtx.modo](f);
  $('rotar-resumen').textContent = r.ok ? resumenRotar() : 'Completar los datos para ver el resumen';
  $('rotar-error').textContent = '';
  return r;
}

function pintarRotar() {
  const { modo, catalogo, odometroObligatorio, veh, posA, tipo, coche } = rotCtx;
  const texto = TEXTO_MODO[modo];
  $('rotar-title').textContent = texto.titulo;
  $('rotar-confirmar').textContent = texto.boton;
  $('rotar-sub').textContent = modo === MODO.disco ? `${nombrePos(posA, tipo)}: se invierten interior y exterior` : (coche || texto.sub);
  setHtml($('rotar-motivo'), joinHtml([
    html`<option value="">Elegir motivo</option>`,
    motivosDelTipo(catalogo, TIPO_MOTIVO_MODO[modo]).map(m => html`<option value="${m.codigo}">${m.etiqueta}</option>`)
  ]));
  // Sin preselección: el motivo de una rotación o una alineación lo elige el operario (RN-14).
  $('rotar-motivo').value = '';
  $('rotar-motivo-texto').value = '';
  $('rotar-odo').value = '';
  $('rotar-odo-opt').textContent = odometroObligatorio ? '(obligatorio)' : '(opcional)';
  $('rotar-odo-hint').textContent = pistaOdometro(veh.odometro_km, odometroObligatorio);
  $('rotar-confirmar').disabled = false;
  actualizarRotar();
}

// Abre el diálogo en su modo. La base vuelve a validar todo al enviar; aquí solo se evita abrir con datos que no sirven.
async function abrirRotar(modo, vehiculoId, posA, posB) {
  if (esAdmin()) return;
  if (rotando) { showToast('Esperar a que termine la rotación', true); return; }
  rotando = true;
  const btn = $(modo === MODO.alineacion ? 'vd-alinear-btn' : 'vd-rotar-btn');
  if (btn) btn.disabled = true;
  try {
    const vid = Number(vehiculoId);
    const [rn, rv] = await Promise.all([
      db.from('neumaticos').select(NEUM_COLS).eq('vehiculo_id', vid),
      db.from('vehiculos').select('id,nombre,cliente_id,odometro_km,tipo_ruedas,distribucion').eq('id', vid).maybeSingle()
    ]);
    if (rn.error || rv.error) { console.error(rn.error || rv.error); showToast('No se pudieron cargar los neumáticos. Reintentar', true); return; }
    // Un vehículo que la RLS oculta llega sin datos: las posiciones se validan antes que el vehículo, así el aviso
    // es «No hay neumático en …» (como antes del diálogo) y no se abre nada ni se llama a la base.
    const veh = rv.data;
    const tipo = veh ? tipoLayout(veh) : null;
    const neums = rn.data || [];
    const d = { modo, vehiculoId: vid, posA: null, posB: null, intercambio: null, cantidad: 0 };
    if (modo === MODO.posicion) {
      const r = validarRotacion(neums, vid, posA, posB, tipo);
      if (!r.ok) { showToast(r.error, true); return; }
      Object.assign(d, { posA: r.params.p_pos_a, posB: r.params.p_pos_b, intercambio: r.intercambio });
    } else if (modo === MODO.disco) {
      const r = validarRotacionDisco(neums, vid, posA, tipo);
      if (!r.ok) { showToast(r.error, true); return; }
      d.posA = Number(posA);
    } else {
      const r = validarAlineacion(neums, vid);
      if (!r.ok) { showToast(r.error, true); return; }
      d.cantidad = r.cantidad;
    }
    if (!veh) { showToast('No se encontró el vehículo. Actualizar la pantalla', true); return; }
    const motivos = await cargarMotivosCliente(veh.cliente_id);
    if (!motivos) { showToast('No se pudieron cargar los motivos. Reintentar', true); return; }
    rotCtx = {
      ...d, veh, tipo, coche: veh.nombre ? etiquetaCoche(veh.nombre) : '',
      catalogo: motivos.catalogo, odometroObligatorio: motivos.odometroObligatorio
    };
    pintarRotar();
    // El foco inicial lo pone modal-a11y (data-foco-inicial="rotar-motivo" en index.html). Enfocar aquí un campo lo dejaría
    // como «previo» y, al cerrar, el foco no volvería al botón que abrió el diálogo.
    $('modal-rotar').classList.add('show');
  } finally { rotando = false; if (btn && btn.isConnected) btn.disabled = false; }
}

ACTIONS['neumatico-rotar-pos'] = async function (vehiculoId, posA, posB) {
  if (posB === DESTINO_DISCO) return abrirRotar(MODO.disco, vehiculoId, posA);
  return abrirRotar(MODO.posicion, vehiculoId, posA, posB);
};
// «Registrar alineación» (cabecera del vehículo): un solo lugar, sin motivo preseleccionado.
ACTIONS['vehiculo-alinear'] = function (vehiculoId) { return abrirRotar(MODO.alineacion, vehiculoId); };

// Llamada a la base de cada modo. El odómetro y el motivo vienen de validarDatos* y se pasan tal cual.
function llamadaRotar(c, p) {
  if (c.modo === MODO.disco) return { rpc: 'neumatico_rotar_disco', args: { p_vehiculo_id: c.vehiculoId, p_posicion: c.posA, ...p } };
  if (c.modo === MODO.alineacion) return { rpc: 'vehiculo_alinear', args: { p_vehiculo_id: c.vehiculoId, ...p } };
  return { rpc: 'neumatico_rotar', args: { p_vehiculo_id: c.vehiculoId, p_pos_a: c.posA, p_pos_b: c.posB, ...p } };
}

// Aviso del resultado. La base manda: la alineación cuenta los neumáticos que informa, y una respuesta «duplicada»
// muestra el mismo aviso (para el operario la operación ya quedó registrada).
function avisoExito(c, data) {
  const coche = c.coche ? ` en ${c.coche}` : '';
  if (c.modo === MODO.disco) return `${avisoRotacionDisco(c.posA, c.tipo)}${coche}`;
  if (c.modo === MODO.alineacion) return `${avisoAlineacion(data && Number.isInteger(data.neumaticos) ? data.neumaticos : c.cantidad)}${coche}`;
  const hubo = data && typeof data.intercambio === 'boolean' ? data.intercambio : !!c.intercambio;
  return `Rotación registrada${coche}: ${avisoRotacion(c.posA, c.posB, c.tipo, hubo)}`;
}

// Qué recarga el detalle y dónde cae el foco (vehiculo-detalle lee rotacion o posicion del evento).
const detalleCambio = c => (c.modo === MODO.disco ? { vehiculoId: c.vehiculoId, posicion: c.posA }
  : c.modo === MODO.alineacion ? { vehiculoId: c.vehiculoId } : { vehiculoId: c.vehiculoId, rotacion: [c.posA, c.posB] });

// Envío desde el diálogo (Enter o clic en el botón). La base manda: odómetro, motivo y posiciones se vuelven a validar allí.
ACTIONS['neumatico-rotar-confirmar'] = async function () {
  if (!rotCtx || rotando || esAdmin()) return;
  const r = actualizarRotar();
  if (!r.ok) { $('rotar-error').textContent = r.error; showToast(r.error, true); return; }
  rotando = true; $('rotar-confirmar').disabled = true;
  const mio = rotCtx; // la respuesta solo toca el diálogo de la operación que la originó
  const coche = mio.coche ? ` en ${mio.coche}` : '';
  const { rpc, args } = llamadaRotar(mio, r.params);
  try {
    const res = await conLimite(db.rpc(rpc, args));
    if (res === TARDE) {
      if (rotCtx === mio) ACTIONS['neumatico-rotar-cerrar']();
      showToast(`No se pudo confirmar ${TEXTO_MODO[mio.modo].nombre}${coche}. Revisar el vehículo antes de reintentar`, true);
      try { reloadActiveView(); } catch (e) { console.error(e); }
      return;
    }
    if (res.error) throw res.error;
    if (rotCtx === mio) ACTIONS['neumatico-rotar-cerrar']();
    showToast(avisoExito(mio, res.data));
    notificarCambio(detalleCambio(mio));
  } catch (e) {
    console.error(e);
    const msg = mio.modo === MODO.alineacion ? traducirErrorAlineacion(e) : traducirErrorRotacion(e);
    if (rotCtx === mio) $('rotar-error').textContent = msg;
    showToast(msg, true);
    if (rotCtx === mio) $('rotar-confirmar').disabled = false;
  } finally { rotando = false; }
};
ACTIONS['neumatico-rotar-resumen'] = function () { if (rotCtx) actualizarRotar(); };
ACTIONS['neumatico-rotar-cerrar'] = function () { $('modal-rotar').classList.remove('show'); rotCtx = null; };

export function init() {
  // «Enter» en cualquier campo envía (docs/14 §5 r.3); el clic en «Confirmar cambio» llega también como submit.
  $('cambio-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['neumatico-cambiar-confirmar'](); });
  // El buscador filtra mientras se escribe (data-change solo dispara al salir del campo), como en Montar.
  $('cambio-buscar').addEventListener('input', () => { if (ctx) { pintarLista(); actualizar(); } });
  // Enter mantenido (autorepetición): solo cuenta la primera pulsación.
  $('cambio-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
  $('rotar-form').addEventListener('submit', e => { e.preventDefault(); ACTIONS['neumatico-rotar-confirmar'](); });
  $('rotar-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
}
