// Carga inicial de Agencia Central: parte PURA (sin archivos, sin base). Convierte las filas del listado en un plan
// (vehículos y neumáticos con su estado, posición y notas) y lista las advertencias. Decisiones y porqués: docs/20.
// Nada de lo que hay aquí escribe: el plan lo ejecuta supabase/seed/importar-agencia-central.mjs.

export const MARCA_CARGA = 'Carga inicial Excel';
export const MOTIVO_DESCARTE = 'Descarte (carga inicial)';
export const POSICION_AUXILIO = 99; // misma convención que neumatico_montar y api_guardar_montaje (no 98)

export const COLUMNAS_OBLIGATORIAS = [
  'CODIGO', 'MARCA', 'MODELO', 'DIMENSIONES', 'TIPO BANDA', 'ESTADO NEUMATICO', 'CANTIDAD RECAPADOS CARGA',
  'CANTIDAD RECAPADOS EXTRA', 'ULTIMOS MM', 'ESTADO ACTUAL', 'INTERNO', 'DEPOSITO', 'POSICION', 'FECHA MONTAJE',
  'KM ACTUAL', 'KM TOTAL ACUMULADO',
];

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Tabla (arreglo de arreglos con la cabecera primero) -> objetos con los valores recortados y su número de fila de Excel. */
export function filasDesdeTabla(tabla) {
  if (!tabla.length) throw new Error('El listado está vacío');
  const cab = tabla[0].map((c) => txt(c));
  const faltan = COLUMNAS_OBLIGATORIAS.filter((c) => !cab.includes(c));
  if (faltan.length) throw new Error(`Faltan columnas en el listado: ${faltan.join(', ')}`);
  return tabla.slice(1)
    .map((r, i) => ({ fila: i + 2, ...Object.fromEntries(cab.map((c, j) => [c, txt(r[j])])) }))
    .filter((f) => cab.some((c) => f[c] !== '')); // descarta filas totalmente vacías
}

/** Misma normalización que `public.normalizar_patente`: mayúsculas y sin espacios. */
export const normalizarPatente = (p) => txt(p).replace(/\s+/g, '').toUpperCase() || null;

/**
 * « STU2456 | 370 » -> { patente, numero }. Sin barra: un valor solo de dígitos (hasta 4) es el número, cualquier otro la
 * patente. Si patente y número coinciden (p. ej. «MAJ2429 | MAJ2429») el número es esa misma matrícula.
 */
export function parsearInterno(valor) {
  const partes = String(valor ?? '').split('|').map(txt);
  if (partes.length > 2) return { error: 'INTERNO con más de una barra' };
  let [patente, numero] = partes.length === 2 ? partes : (/^\d{1,4}$/.test(partes[0]) ? ['', partes[0]] : [partes[0], '']);
  if (!patente && !numero) return { error: 'INTERNO vacío' };
  if (!numero) numero = patente;           // sin número: la matrícula hace de número (el panel exige uno)
  patente = normalizarPatente(patente);
  if (numero.length > 50) return { error: 'número interno demasiado largo' };
  return { patente, numero };
}

/** dd/mm/aaaa -> aaaa-mm-dd; null si vacía o inválida (calendario real, 2000 .. hoy+1). */
export function parsearFecha(valor, hoy = new Date()) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txt(valor));
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  if (a < 2000 || f.getTime() > hoy.getTime() + 86400000) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** «15.0|14.5|15.0|15.0» -> { texto, valores } o null si vacío; { invalido } si no son números. Solo para notas. */
export function parsearMm(valor) {
  const t = txt(valor);
  if (!t) return null;
  const partes = t.split('|').map((x) => x.trim());
  const valores = partes.map((x) => Number(x.replace(',', '.')));
  if (partes.some((x) => x === '') || valores.some((n) => !Number.isFinite(n) || n < 0 || n > 40)) return { invalido: t };
  return { texto: partes.join('|'), valores };
}

/** `295/80r22,5` -> `295/80R22.5`. Lo que no calza con un formato de cubierta se devuelve recortado, con `dudosa: true`. */
export function normalizarDimension(valor) {
  const t = txt(valor).replace(/\s+/g, '');
  if (!t) return null;
  const n = t.replace(',', '.').replace(/r/g, 'R');
  const ok = /^(\d{2,3}\/\d{2}R\d{2}(\.\d)?|\d{2}R\d{2}(\.\d)?|\d{2,3}\/\d{2}R\d{2}(\.\d)?)$/.test(n);
  return { texto: n, dudosa: !ok };
}

const entero = (v) => (/^-?\d+$/.test(txt(v)) ? Number(txt(v)) : null);

/**
 * Vida (reencauches, 0..3), condición y km previos desde las columnas del listado.
 * - vida = RECAPADOS CARGA + RECAPADOS EXTRA, acotada a 0..3 (límite de la base); lo que exceda queda en notas.
 * - condicion: con vida > 0 -> «recauchutado»; «Usada recapada» sin vida declarada -> «recauchutado» igual (no se inventa
 *   una vida); «Nueva original» -> «nuevo» solo si va a stock, sin vida y sin km (si no, ya se usó); cualquier otro -> «usado».
 *   Un neumático montado nunca es «nuevo» (la base lo pasaría a «usado»).
 */
export function mapearCubierta(fila, { montado }) {
  const adv = [];
  const carga = entero(fila['CANTIDAD RECAPADOS CARGA']);
  const extra = entero(fila['CANTIDAD RECAPADOS EXTRA']);
  let cargaOk = carga ?? 0; let extraOk = extra ?? 0;
  if (cargaOk < 0) { adv.push(`recapados de carga negativos (${carga}): se toma 0`); cargaOk = 0; }
  if (extraOk < 0) { adv.push(`recapados extra negativos (${extra}): se toma 0`); extraOk = 0; }
  const total = cargaOk + extraOk;
  const vida = Math.min(total, 3);
  if (total > 3) adv.push(`recapados ${total} superan el máximo de 3: vida 3 y el dato original en notas`);
  const km = entero(fila['KM TOTAL ACUMULADO']);
  let kmPrevios = km ?? 0;
  if (km === null && txt(fila['KM TOTAL ACUMULADO']) !== '') adv.push('KM TOTAL ACUMULADO no numérico: km previos 0');
  if (kmPrevios < 0 || kmPrevios > 999999999) { adv.push('KM TOTAL ACUMULADO fuera de rango: km previos 0'); kmPrevios = 0; }
  const est = txt(fila['ESTADO NEUMATICO']).toLowerCase();
  let condicion;
  if (vida > 0 || est === 'usada recapada') condicion = 'recauchutado';
  else if (est === 'nueva original' && !montado && kmPrevios === 0) condicion = 'nuevo';
  else condicion = 'usado';
  if (est === 'usada recapada' && vida === 0) adv.push('«Usada recapada» sin recapados declarados: vida 0');
  if (est === 'nueva original' && vida > 0) adv.push('«Nueva original» con recapados declarados: se toman los recapados');
  return { vida, condicion, kmPrevios, carga, extra, total, adv };
}

/**
 * Posiciones de un vehículo (las del listado) -> ruedas y auxilio de NEUMET.
 * Regla (hay 63 de 84 vehículos con 1..9 y 8 con 1..11): la posición más alta es el AUXILIO cuando es 9 u 11 (ruedas pares
 * + 1) y se guarda como 99; con máximo 10 o ≤ 8 no hay auxilio. Las ruedas conservan su número (1..W). Todos son
 * tipo_ruedas 10 (≤ 10 ruedas) y sin distribución (NULL: «sin definir»; elegirla es del cliente, ver docs/20).
 * Devuelve `error` si el vehículo no se puede cargar sin adivinar (posición inválida o repetida).
 */
export function distribuirVehiculo(posiciones) {
  const pos = posiciones.map((p) => entero(p));
  if (pos.some((p) => p === null || p < 1 || p > 11)) return { error: 'posición fuera de 1..11 o no numérica' };
  if (new Set(pos).size !== pos.length) return { error: 'posición repetida' };
  const max = Math.max(...pos);
  const aux = (max === 9 || max === 11) ? max : null;
  const ruedas = aux ? max - 1 : max;
  const vacias = [];
  for (let i = 1; i <= ruedas; i++) if (!pos.includes(i)) vacias.push(i);
  const adv = [];
  if (vacias.length) adv.push(`posiciones sin neumático: ${vacias.join(', ')}`);
  if (pos.length < 6) adv.push(`solo ${pos.length} neumáticos montados`);
  if (!aux && ![6, 8, 10].includes(ruedas)) adv.push(`${ruedas} ruedas: no coincide con una distribución del catálogo`);
  const mapa = new Map(pos.map((p) => [p, p === aux ? POSICION_AUXILIO : p]));
  return { ruedas, aux, tipo_ruedas: 10, mapa, adv };
}

const esDescarte = (d) => txt(d).toUpperCase() === 'DESCARTE';
const etiquetaDep = (d) => txt(d);

/** Notas de un neumático: texto corto con lo que no tiene columna propia. */
function armarNotas(f, ctx) {
  const p = [`${MARCA_CARGA} ${ctx.fechaCarga} (fila ${f.fila})`];
  const dim = normalizarDimension(f.DIMENSIONES);
  if (dim) p.push(`Dimensión: ${dim.texto}`);
  if (txt(f['TIPO BANDA'])) p.push(`Banda: ${txt(f['TIPO BANDA'])}`);
  if (txt(f['ESTADO NEUMATICO'])) p.push(`Estado en el listado: ${txt(f['ESTADO NEUMATICO'])}`);
  if (ctx.cub.carga !== null || ctx.cub.extra !== null) {
    p.push(`Recapados: ${ctx.cub.carga ?? 0} de carga, ${ctx.cub.extra ?? 0} extra`);
  }
  if ((entero(f['KM ACTUAL']) ?? 0) > 0) p.push(`Km del montaje actual: ${entero(f['KM ACTUAL'])}`);
  const mm = parsearMm(f['ULTIMOS MM']);
  if (mm?.texto) p.push(`Últimos mm (carga inicial): ${mm.texto}`);
  else if (mm?.invalido) p.push(`Últimos mm (carga inicial, ilegible): ${mm.invalido}`);
  const mes = txt(f['MES FABRICACION']); const anio = txt(f['AÑO FABRICACION']);
  if ((mes && mes !== '0') || (anio && anio !== '0')) p.push(`Fabricación (mes/año del listado): ${mes || 0}/${anio || 0}`);
  if (txt(f['IDENTIFICADOR INTERNO'])) p.push(`Identificador interno: ${txt(f['IDENTIFICADOR INTERNO'])}`);
  if (etiquetaDep(f.DEPOSITO)) p.push(`Depósito: ${etiquetaDep(f.DEPOSITO)}`);
  if (ctx.repetido) p.push(`Código repetido en el Excel: ${txt(f.CODIGO)}`);
  return p.join('. ');
}

/**
 * Plan completo. `opciones`: { clienteId, sucursalId, fechaCarga (aaaa-mm-dd), descarte: 'baja'|'omitir', hoy }.
 * `existente` (opcional, de la base): { vehiculos: [{id, numero, patente_norm, notas}], neumaticos: [{idneumatico}] } para
 * no duplicar al reejecutar y para detectar colisiones con vehículos ajenos a la carga.
 */
export function armarPlan(filas, opciones, existente = { vehiculos: [], neumaticos: [] }) {
  const { clienteId, sucursalId, fechaCarga, descarte = 'baja' } = opciones;
  const hoy = opciones.hoy ?? new Date();
  const advertencias = []; // { nivel: 'aviso'|'omitida', fila?, texto }
  const aviso = (fila, texto) => advertencias.push({ nivel: 'aviso', fila, texto });
  const omitida = (fila, texto) => advertencias.push({ nivel: 'omitida', fila, texto });

  // Clasificación y códigos repetidos (el primero conserva el código; los siguientes se cargan sin él).
  const vistos = new Map();
  const items = [];
  for (const f of filas) {
    const estado = txt(f['ESTADO ACTUAL']).toLowerCase();
    let tipo;
    if (estado === 'montado') tipo = 'montado';
    else if (estado === 'en deposito') tipo = esDescarte(f.DEPOSITO) ? 'baja' : 'stock';
    else { omitida(f.fila, `ESTADO ACTUAL desconocido («${txt(f['ESTADO ACTUAL'])}»)`); continue; }
    const codigo = txt(f.CODIGO);
    if (!codigo) { omitida(f.fila, 'sin CODIGO: no hay clave estable para reejecutar'); continue; }
    if (!txt(f.MARCA)) { omitida(f.fila, 'sin MARCA'); continue; }
    const n = (vistos.get(codigo) ?? 0) + 1;
    vistos.set(codigo, n);
    items.push({ f, tipo, codigo, repetido: n > 1, orden: n });
  }
  for (const [c, n] of vistos) if (n > 1) aviso(null, `código ${c} repetido ${n} veces: el primero conserva el código y los demás se cargan sin él`);

  // Vehículos: un grupo por INTERNO de los montados.
  const grupos = new Map();
  for (const it of items.filter((i) => i.tipo === 'montado')) {
    const p = parsearInterno(it.f.INTERNO);
    if (p.error) { omitida(it.f.fila, `montado sin vehículo válido: ${p.error}`); it.omitir = true; continue; }
    const clave = `${p.patente ?? ''}|${p.numero}`;
    if (!grupos.has(clave)) grupos.set(clave, { ...p, items: [] });
    grupos.get(clave).items.push(it);
  }
  const exVeh = existente.vehiculos ?? [];
  const exIdn = new Set((existente.neumaticos ?? []).map((n) => n.idneumatico));
  const vehiculos = [];
  const numerosUsados = new Set(); const patentesUsadas = new Set();
  for (const g of grupos.values()) {
    const rotulo = `${g.patente ?? 's/patente'} / ${g.numero}`;
    const bloquear = (motivo) => { g.items.forEach((i) => { i.omitir = true; omitida(i.f.fila, `vehículo ${rotulo} no se carga: ${motivo}`); }); };
    const dist = distribuirVehiculo(g.items.map((i) => i.f.POSICION));
    if (dist.error) { bloquear(dist.error); continue; }
    // Unicidad dentro del propio listado (índices únicos por cliente en numero y patente_norm).
    if (numerosUsados.has(g.numero)) { bloquear(`número interno ${g.numero} repetido con otra patente`); continue; }
    if (g.patente && patentesUsadas.has(g.patente)) { bloquear(`patente ${g.patente} repetida con otro número`); continue; }
    // Colisión con la base: un vehículo ya cargado por esta carga se reutiliza; uno ajeno bloquea.
    const choques = exVeh.filter((v) => v.numero === g.numero || (g.patente && v.patente_norm === g.patente));
    const ajeno = choques.find((v) => !String(v.notas ?? '').startsWith(MARCA_CARGA));
    if (ajeno) { bloquear(`el número o la patente ya existen en un vehículo del cliente (id ${ajeno.id}) ajeno a esta carga`); continue; }
    numerosUsados.add(g.numero); if (g.patente) patentesUsadas.add(g.patente);
    for (const a of dist.adv) aviso(g.items[0].f.fila, `vehículo ${rotulo}: ${a}`);
    if (g.patente === g.numero) aviso(null, `vehículo ${g.numero}: número interno igual a la patente; se usa la patente como número`);
    vehiculos.push({
      numero: g.numero, patente: g.patente, nombre: `Coche ${g.numero}`, tipo_ruedas: dist.tipo_ruedas,
      sucursal_id: sucursalId, notas: `${MARCA_CARGA} ${fechaCarga}`, ruedas: dist.ruedas, auxilio: dist.aux !== null,
      neumaticos: g.items.length, yaCargado: choques.length > 0, _mapa: dist.mapa, _items: g.items,
    });
  }

  // Neumáticos.
  const neumaticos = [];
  let omitidasDescarte = 0;
  for (const it of items) {
    if (it.omitir) continue;
    const { f, tipo } = it;
    if (tipo === 'baja' && descarte === 'omitir') { omitidasDescarte++; continue; }
    const cub = mapearCubierta(f, { montado: tipo === 'montado' });
    for (const a of cub.adv) aviso(f.fila, a);
    const dim = normalizarDimension(f.DIMENSIONES);
    if (dim?.dudosa) aviso(f.fila, `dimensión con formato no reconocido («${dim.texto}»): queda en notas tal cual`);
    const mm = parsearMm(f['ULTIMOS MM']);
    if (mm?.invalido) aviso(f.fila, 'ULTIMOS MM ilegible: queda en notas tal cual');
    const fechaMontaje = parsearFecha(f['FECHA MONTAJE'], hoy);
    if (tipo === 'montado' && txt(f['FECHA MONTAJE']) && !fechaMontaje) aviso(f.fila, 'FECHA MONTAJE inválida: el evento de montaje queda con la fecha de la carga');
    if (tipo === 'montado' && !txt(f['FECHA MONTAJE'])) aviso(f.fila, 'montado sin FECHA MONTAJE');
    if (tipo === 'stock' && /baja|roto/i.test(txt(f.DEPOSITO))) aviso(f.fila, `depósito «${txt(f.DEPOSITO)}» suena a baja: entra a stock según la decisión (solo DESCARTE es baja)`);
    const idneumatico = `CI-${clienteId}-${it.codigo}${it.repetido ? `-r${it.orden}` : ''}`;
    const base = {
      idneumatico, codigo: it.repetido ? null : it.codigo, marca: txt(f.MARCA), modelo: txt(f.MODELO) || null,
      vida: cub.vida, condicion: cub.condicion, km_previos: cub.kmPrevios, repetido: it.repetido, fila: f.fila,
      notas: armarNotas(f, { fechaCarga, cub, repetido: it.repetido }), tipo, yaCargado: exIdn.has(idneumatico),
    };
    if (tipo === 'montado') {
      const g = vehiculos.find((v) => v._items.includes(it));
      if (!g) continue; // su vehículo se omitió (ya hay advertencia)
      const posicion = g._mapa.get(entero(f.POSICION));
      neumaticos.push({ ...base, estado: 'montado', veh_numero: g.numero, posicion, auxilio: posicion === POSICION_AUXILIO,
        fecha_montaje: fechaMontaje, sucursal_id: null });
    } else if (tipo === 'stock') {
      neumaticos.push({ ...base, estado: 'almacenado', veh_numero: null, posicion: null, auxilio: false, fecha_montaje: null, sucursal_id: sucursalId });
    } else {
      neumaticos.push({ ...base, estado: 'baja', veh_numero: null, posicion: null, auxilio: false, fecha_montaje: null,
        sucursal_id: null, fecha_baja: fechaCarga, motivo_baja: MOTIVO_DESCARTE });
    }
  }
  for (const v of vehiculos) { delete v._mapa; delete v._items; }

  const cuenta = (t) => neumaticos.filter((n) => n.tipo === t).length;
  const resumen = {
    filas: filas.length,
    vehiculos: vehiculos.length,
    vehiculosYaCargados: vehiculos.filter((v) => v.yaCargado).length,
    montados: cuenta('montado'), auxilios: neumaticos.filter((n) => n.auxilio).length,
    stock: cuenta('stock'), bajas: cuenta('baja'), descartesOmitidos: omitidasDescarte,
    neumaticosYaCargados: neumaticos.filter((n) => n.yaCargado).length,
    codigosRepetidos: neumaticos.filter((n) => n.repetido).length,
    omitidas: advertencias.filter((a) => a.nivel === 'omitida').length,
    avisos: advertencias.filter((a) => a.nivel === 'aviso').length,
  };
  return { vehiculos, neumaticos, advertencias, resumen };
}
