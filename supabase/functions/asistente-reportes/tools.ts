// Tools de lectura del asistente (docs/24 §4 y §5). Cada tool declara sus argumentos con `Campo`: de ahí salen el
// esquema que ve el modelo y la validación estricta. Ninguna escribe: son `select` o RPC de lectura con el JWT del
// usuario, así que la RLS y los privilegios por columna siguen aplicando aunque la validación falle.
import type { ConsultaSelect, Contexto, DefTool, Rest, ResultadoRest, SalidaTool } from './contrato.ts';
import { posInt } from '../_shared/acceso.ts';

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;
const DIAS_MAXIMOS_PERIODO = 730;
const BYTES_MAXIMOS_CONTENIDO = 30 * 1024;
const CUBIERTAS_MAXIMAS = 5;
const EVENTOS_MAXIMOS = 20;
const MILISEGUNDOS_DIA = 86_400_000;

const ESTADOS = ['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido'];
const TIPOS_ALERTA = ['limite', 'direccion_aviso', 'direccion_limite', 'irregular', 'lateral', 'swap', 'km_por_mm'];
const GRUPOS_CPK = ['marca', 'modelo', 'sucursal', 'vida', 'banda'];

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const PATRON_QUEMA = /^[A-Za-z0-9 /-]+$/;
// Caracteres que romperían el filtro `or` o el `ilike` de PostgREST: se quitan, no se escapan.
const CARACTERES_PROHIBIDOS = /[,()*%\\:"']/g;

type Fila = Record<string, unknown>;
type Valores = Record<string, unknown>;
type Campos = Record<string, Campo>;
type Filtros = Array<[string, string]>;

interface Fallo {
  error: string;
  detalle?: string;
}

/** Resultado de un paso. `ok` separa el fallo de cualquier clave que mande el modelo (p. ej. `error` en los argumentos). */
type Intento<T> = { ok: true; valor: T } | { ok: false; fallo: Fallo };

interface Periodo {
  desde: string | null;
  hasta: string | null;
}

interface Salida extends Periodo {
  filas: Fila[];
  recortado: boolean;
}

type Campo =
  | { tipo: 'entero'; descripcion: string; minimo: number; maximo: number; requerido?: boolean }
  | { tipo: 'enum'; descripcion: string; valores: readonly string[]; requerido?: boolean }
  | { tipo: 'fecha'; descripcion: string; requerido?: boolean }
  | { tipo: 'texto'; descripcion: string; maximo: number; patron?: RegExp; requerido?: boolean };

interface Herramienta {
  nombre: string;
  descripcion: string;
  campos: Campos;
  disponible: (ctx: Contexto) => boolean;
  ejecutar: (valores: Valores, ctx: Contexto, rest: Rest) => Promise<Intento<Salida>>;
}

const bien = <T>(valor: T): Intento<T> => ({ ok: true, valor });
const mal = (error: string, detalle?: string): { ok: false; fallo: Fallo } => ({
  ok: false,
  fallo: detalle === undefined ? { error } : { error, detalle },
});

const SIN_PERIODO: Periodo = { desde: null, hasta: null };
const eq = (valor: number | string): string => `eq.${valor}`;
const limiteDe = (valores: Valores): number => (valores.limite as number | undefined) ?? LIMITE_POR_DEFECTO;

// ---- Campos compartidos --------------------------------------------------------------------------------------------

const CAMPO_VEHICULO: Campo = {
  tipo: 'entero',
  descripcion: 'Id interno del vehículo.',
  minimo: 1,
  maximo: Number.MAX_SAFE_INTEGER,
};
const CAMPO_LIMITE: Campo = {
  tipo: 'entero',
  descripcion: `Máximo de filas, de 1 a ${LIMITE_MAXIMO}. Por defecto ${LIMITE_POR_DEFECTO}.`,
  minimo: 1,
  maximo: LIMITE_MAXIMO,
};
const CAMPO_DESDE: Campo = { tipo: 'fecha', descripcion: 'Primer día del período, YYYY-MM-DD.' };
const CAMPO_HASTA: Campo = { tipo: 'fecha', descripcion: 'Último día del período, YYYY-MM-DD. Incluido.' };

// ---- Fechas --------------------------------------------------------------------------------------------------------

function fechaValida(texto: string): boolean {
  const m = PATRON_FECHA.exec(texto);
  if (!m) return false;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  // Date normaliza 2026-02-30 a marzo: comparar las partes detecta las fechas que no existen.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

function periodoValido(desde: string, hasta: string): boolean {
  if (desde > hasta) return false;
  const dias = (Date.parse(hasta) - Date.parse(desde)) / MILISEGUNDOS_DIA;
  return dias <= DIAS_MAXIMOS_PERIODO;
}

/** Día siguiente en `YYYY-MM-DD`: el filtro de fin es exclusivo, así que `hasta` incluye su día entero. */
function diaSiguiente(fecha: string): string {
  return new Date(Date.parse(fecha) + MILISEGUNDOS_DIA).toISOString().slice(0, 10);
}

// ---- Validación de argumentos --------------------------------------------------------------------------------------

function leerCampo(campo: Campo, bruto: unknown): unknown {
  switch (campo.tipo) {
    case 'entero': {
      const n = posInt(bruto);
      return n !== null && n >= campo.minimo && n <= campo.maximo ? n : undefined;
    }
    case 'enum':
      return typeof bruto === 'string' && campo.valores.includes(bruto) ? bruto : undefined;
    case 'fecha':
      return typeof bruto === 'string' && fechaValida(bruto) ? bruto : undefined;
    case 'texto': {
      if (typeof bruto !== 'string') return undefined;
      const texto = bruto.trim();
      if (texto.length === 0 || texto.length > campo.maximo) return undefined;
      if (campo.patron && !campo.patron.test(texto)) return undefined;
      return texto;
    }
  }
}

/** Valida contra la declaración. `cliente_id` se ignora: lo pone la función, nunca el modelo. */
function validar(campos: Campos, entrada: Fila): Intento<Valores> {
  const desconocido = Object.keys(entrada).find((clave) => clave !== 'cliente_id' && !Object.hasOwn(campos, clave));
  if (desconocido !== undefined) return mal('argumento_invalido', desconocido);
  const valores: Valores = {};
  for (const [nombre, campo] of Object.entries(campos)) {
    const bruto = entrada[nombre];
    if (bruto === undefined || bruto === null) {
      if (campo.requerido) return mal('argumento_invalido', nombre);
      continue;
    }
    const valor = leerCampo(campo, bruto);
    if (valor === undefined) return mal('argumento_invalido', nombre);
    valores[nombre] = valor;
  }
  return bien(valores);
}

function parsearArgumentos(texto: string): Intento<Fila> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return mal('argumento_invalido', 'json');
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return mal('argumento_invalido', 'json');
  return bien(bruto as Fila);
}

// ---- Esquema que ve el modelo --------------------------------------------------------------------------------------

function propiedadJson(campo: Campo): Record<string, unknown> {
  switch (campo.tipo) {
    case 'entero':
      return { type: 'integer', minimum: campo.minimo, maximum: campo.maximo, description: campo.descripcion };
    case 'enum':
      return { type: 'string', enum: [...campo.valores], description: campo.descripcion };
    case 'fecha':
      return { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: campo.descripcion };
    case 'texto':
      return { type: 'string', minLength: 1, maxLength: campo.maximo, description: campo.descripcion };
  }
}

function esquemaDe(campos: Campos): Record<string, unknown> {
  const requeridos = Object.entries(campos)
    .filter(([, campo]) => campo.requerido)
    .map(([nombre]) => nombre);
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(campos).map(([nombre, campo]) => [nombre, propiedadJson(campo)])),
    ...(requeridos.length > 0 ? { required: requeridos } : {}),
    additionalProperties: false,
  };
}

function definicion(herramienta: Herramienta): DefTool {
  return {
    type: 'function',
    function: {
      name: herramienta.nombre,
      description: herramienta.descripcion,
      parameters: esquemaDe(herramienta.campos),
    },
  };
}

// ---- Lectura y resultado -------------------------------------------------------------------------------------------

async function leer(pendiente: Promise<ResultadoRest>): Promise<Intento<Fila[]>> {
  const resultado = await pendiente;
  if (resultado.ok) return bien(resultado.filas as Fila[]);
  // Solo el rechazo de privilegios (42501) se dice como «sin permiso»; el resto no expone el mensaje de la base.
  return mal(resultado.code === '42501' ? 'sin_permiso' : 'consulta_fallida');
}

/** Una consulta de lista: pide un registro de más para saber si hubo recorte, y devuelve hasta `limite`. */
async function consultar(
  rest: Rest,
  consulta: Omit<ConsultaSelect, 'limite'>,
  limite: number,
  periodo: Periodo = SIN_PERIODO,
): Promise<Intento<Salida>> {
  const leido = await leer(rest.select({ ...consulta, limite: limite + 1 }));
  if (!leido.ok) return leido;
  return bien({
    filas: leido.valor.slice(0, limite),
    recortado: leido.valor.length > limite,
    ...periodo,
  });
}

/** Quita comodines y separadores para que el texto del modelo no altere el filtro `or` ni el `ilike`. */
function sanear(texto: string): string {
  return texto.replace(CARACTERES_PROHIBIDOS, '').trim();
}

function sinCampoCliente(fila: Fila): Fila {
  return Object.fromEntries(Object.entries(fila).filter(([clave]) => clave !== 'cliente_id'));
}

// ---- Tools ---------------------------------------------------------------------------------------------------------

const COLUMNAS_ESTADO =
  'vehiculo_id,vehiculo_nombre,patente,posicion,idneumatico,marca,modelo,vida,estado,minimo,promedio,' +
  'ultima_medicion_at,dias_desde_medicion,sin_medir,tasa_mm_semana,semanas_hasta_retiro,rol_eje,estado_direccion';

const estadoFlota: Herramienta = {
  nombre: 'estado_flota',
  descripcion:
    'Neumáticos montados con su estado (nuevo, poco_desgaste, mayor_desgaste, desgaste_limite o desconocido), ' +
    'huella mínima y promedio en mm, tasa de desgaste en mm por semana y semanas hasta el retiro. Una fila por posición.',
  campos: {
    vehiculo_id: CAMPO_VEHICULO,
    estado: { tipo: 'enum', descripcion: 'Filtra por estado.', valores: ESTADOS },
    limite: CAMPO_LIMITE,
  },
  disponible: () => true,
  ejecutar: (valores, ctx, rest) => {
    const filtros: Filtros = [['cliente_id', eq(ctx.clienteId)]];
    if (valores.vehiculo_id !== undefined) filtros.push(['vehiculo_id', eq(valores.vehiculo_id as number)]);
    if (valores.estado !== undefined) filtros.push(['estado', eq(valores.estado as string)]);
    return consultar(
      rest,
      {
        recurso: 'v_estado_neumaticos',
        columnas: COLUMNAS_ESTADO,
        filtros,
        orden: 'vehiculo_nombre.asc,posicion.asc',
      },
      limiteDe(valores),
    );
  },
};

const cpkPorGrupo: Herramienta = {
  nombre: 'cpk_por_grupo',
  descripcion:
    'Costo por km (CPK) ponderado por grupo: marca, modelo, sucursal, vida (0 banda original, 1 a 3 recauchutado) ' +
    'o banda. desde y hasta filtran las cubiertas dadas de alta en ese rango. Una fila por grupo y moneda; ' +
    'muestra_baja indica menos de 5 cubiertas. Solo para quien ve costos.',
  campos: {
    grupo: { tipo: 'enum', descripcion: 'Agrupa por este campo.', valores: GRUPOS_CPK, requerido: true },
    desde: { ...CAMPO_DESDE, descripcion: 'Alta de las cubiertas desde este día, YYYY-MM-DD.' },
    hasta: { ...CAMPO_HASTA, descripcion: 'Alta de las cubiertas hasta este día, YYYY-MM-DD.' },
  },
  // Costos y CPK solo para quien ve precios (docs/24 §5): el perfil de sucursal recibe «sin permiso», no ceros.
  disponible: (ctx) => ctx.costosVisibles,
  ejecutar: async (valores, ctx, rest) => {
    const desde = (valores.desde as string | undefined) ?? null;
    const hasta = (valores.hasta as string | undefined) ?? null;
    if (desde !== null && hasta !== null && !periodoValido(desde, hasta)) return mal('argumento_invalido', 'hasta');
    const leido = await leer(
      rest.rpc('cpk_por_grupo', {
        p_grupo: valores.grupo,
        p_desde: desde,
        p_hasta: hasta,
        p_cliente_id: ctx.clienteId,
      }),
    );
    if (!leido.ok) return leido;
    // La RPC devuelve el cliente en cada fila; el modelo no lo necesita y el filtro ya lo fijó la función.
    const filas = leido.valor.map(sinCampoCliente);
    return bien({
      filas: filas.slice(0, LIMITE_MAXIMO),
      recortado: filas.length > LIMITE_MAXIMO,
      desde,
      hasta,
    });
  },
};

const alertasActivas: Herramienta = {
  nombre: 'alertas_activas',
  descripcion:
    'Alertas no resueltas (abiertas o reconocidas), de la más severa a la menos severa. severidad 3 es límite ' +
    '(rojo); 2 el resto (amarillo). mensaje trae la medida en mm o km.',
  campos: {
    tipo: { tipo: 'enum', descripcion: 'Filtra por tipo de alerta.', valores: TIPOS_ALERTA },
    vehiculo_id: CAMPO_VEHICULO,
    limite: CAMPO_LIMITE,
  },
  disponible: () => true,
  ejecutar: (valores, ctx, rest) => {
    const filtros: Filtros = [['cliente_id', eq(ctx.clienteId)]];
    if (valores.tipo !== undefined) filtros.push(['tipo', eq(valores.tipo as string)]);
    if (valores.vehiculo_id !== undefined) filtros.push(['vehiculo_id', eq(valores.vehiculo_id as number)]);
    return consultar(
      rest,
      {
        recurso: 'v_alertas',
        columnas: 'vehiculo_id,vehiculo_nombre,patente,posicion,idneumatico,tipo,severidad,mensaje,estado,abierta_at,' +
          'ultima_medicion_at',
        filtros,
        orden: 'severidad.desc,vehiculo_nombre.asc',
      },
      limiteDe(valores),
    );
  },
};

const medicionesRecientes: Herramienta = {
  nombre: 'mediciones_recientes',
  descripcion:
    'Mediciones de un período, de la más reciente a la más antigua. mm1 a mm3 son las huellas y promedio su ' +
    'promedio, en mm; odometro_km en km. desde y hasta incluyen sus días; el rango máximo es de 730 días.',
  campos: {
    desde: { ...CAMPO_DESDE, requerido: true },
    hasta: { ...CAMPO_HASTA, requerido: true },
    vehiculo_id: CAMPO_VEHICULO,
    limite: CAMPO_LIMITE,
  },
  disponible: () => true,
  ejecutar: (valores, ctx, rest) => {
    const desde = valores.desde as string;
    const hasta = valores.hasta as string;
    if (!periodoValido(desde, hasta)) return Promise.resolve(mal('argumento_invalido', 'hasta'));
    const filtros: Filtros = [
      ['cliente_id', eq(ctx.clienteId)],
      // Las mediciones invalidadas no cuentan en ningún reporte (docs/08, apéndice I).
      ['calidad', 'neq.invalidada'],
      ['created_at', `gte.${desde}`],
      ['created_at', `lt.${diaSiguiente(hasta)}`],
    ];
    if (valores.vehiculo_id !== undefined) filtros.push(['vehiculo_id', eq(valores.vehiculo_id as number)]);
    return consultar(
      rest,
      {
        recurso: 'mediciones',
        columnas:
          'created_at,vehiculo_id,posicion,idneumatico,mm1,mm2,mm3,promedio,odometro_km,vehiculos(nombre,patente)',
        filtros,
        orden: 'created_at.desc,id.desc',
      },
      limiteDe(valores),
      { desde, hasta },
    );
  },
};

const vehiculosListar: Herramienta = {
  nombre: 'vehiculos_listar',
  descripcion:
    'Vehículos del cliente con id, nombre, patente, número interno, tipo_ruedas (10 o 16 neumáticos), distribucion ' +
    '(por ejemplo 6x2 o 6x4), servicio (camion, bus o vacío si no está definido), sucursal_id y si están activos. ' +
    'texto busca por nombre, patente o número.',
  campos: {
    texto: { tipo: 'texto', descripcion: 'Parte del nombre, la patente o el número.', maximo: 40 },
    limite: CAMPO_LIMITE,
  },
  disponible: () => true,
  ejecutar: (valores, ctx, rest) => {
    const filtros: Filtros = [['cliente_id', eq(ctx.clienteId)]];
    if (typeof valores.texto === 'string') {
      const texto = sanear(valores.texto);
      if (texto === '') return Promise.resolve(mal('argumento_invalido', 'texto'));
      filtros.push(['or', `(nombre.ilike.*${texto}*,patente.ilike.*${texto}*,numero.ilike.*${texto}*)`]);
    }
    return consultar(
      rest,
      {
        recurso: 'vehiculos',
        // `distribucion` (20261122000000) y `servicio` (20261126030000) son de lectura para todo perfil del cliente.
        columnas: 'id,nombre,patente,numero,tipo_ruedas,distribucion,servicio,sucursal_id,activo',
        filtros,
        orden: 'nombre.asc',
      },
      limiteDe(valores),
    );
  },
};

const COLUMNAS_CUBIERTA =
  'id,numero_quema,idneumatico,marca,modelo,vida,estado,condicion,posicion,vehiculo_id,km_previos,fecha_baja,' +
  'motivo_baja,created_at,vehiculos(nombre,patente)';
const COLUMNAS_EVENTOS = 'tipo,created_at,odometro_km,posicion_origen,posicion_destino,motivo_codigo,motivo_texto';
const COLUMNAS_KM = 'km_totales,km_en_vehiculos,km_tramo_actual,km_confiable';
const COLUMNAS_COSTO = 'moneda,costo_total,cpk,cpk_provisional,km_recorridos';

const fichaCubierta: Herramienta = {
  nombre: 'ficha_cubierta',
  descripcion:
    `Ficha de hasta ${CUBIERTAS_MAXIMAS} cubiertas con ese número de quema: datos, hasta ${EVENTOS_MAXIMOS} eventos ` +
    'recientes, km recorridos y costos. km en km; costos trae la moneda y el costo total, o «sin_permiso» si el ' +
    'perfil no ve costos.',
  campos: {
    quema: {
      tipo: 'texto',
      descripcion: 'Número de quema exacto, sin comodines.',
      maximo: 30,
      patron: PATRON_QUEMA,
      requerido: true,
    },
  },
  disponible: () => true,
  ejecutar: async (valores, ctx, rest) => {
    const cubiertasLeidas = await leer(
      rest.select({
        recurso: 'neumaticos',
        columnas: COLUMNAS_CUBIERTA,
        filtros: [
          ['cliente_id', eq(ctx.clienteId)],
          ['numero_quema', `ilike.${valores.quema as string}`],
        ],
        limite: CUBIERTAS_MAXIMAS + 1,
      }),
    );
    if (!cubiertasLeidas.ok) return cubiertasLeidas;
    const halladas = cubiertasLeidas.valor;
    let recortado = halladas.length > CUBIERTAS_MAXIMAS;
    const fichas: Fila[] = [];

    for (const cubierta of halladas.slice(0, CUBIERTAS_MAXIMAS)) {
      const id = cubierta.id as number;
      const eventos = await leer(
        rest.select({
          recurso: 'eventos_neumatico',
          columnas: COLUMNAS_EVENTOS,
          filtros: [['neumatico_id', eq(id)]],
          orden: 'created_at.desc',
          limite: EVENTOS_MAXIMOS + 1,
        }),
      );
      if (!eventos.ok) return eventos;
      recortado ||= eventos.valor.length > EVENTOS_MAXIMOS;

      const km = await leer(
        rest.select({
          recurso: 'v_km_cubierta',
          columnas: COLUMNAS_KM,
          filtros: [['neumatico_id', eq(id)]],
          limite: 1,
        }),
      );
      if (!km.ok) return km;

      let costos: Fila | string | null = 'sin_permiso';
      if (ctx.costosVisibles) {
        const costo = await leer(
          rest.select({
            recurso: 'v_costo_cubierta',
            columnas: COLUMNAS_COSTO,
            filtros: [['neumatico_id', eq(id)]],
            limite: 1,
          }),
        );
        if (!costo.ok) return costo;
        costos = costo.valor[0] ?? null;
      }

      fichas.push({
        ...cubierta,
        eventos: eventos.valor.slice(0, EVENTOS_MAXIMOS),
        km: km.valor[0] ?? null,
        costos,
      });
    }
    return bien({ filas: fichas, recortado, desde: null, hasta: null });
  },
};

// Ola 7 (docs/24 §5): `reporte_periodo` y `rendimiento_descartadas` se agregan a este registro cuando su migración
// (20261126080000) esté en main. Hasta entonces el modelo no las conoce y no se declaran.
const HERRAMIENTAS: readonly Herramienta[] = [
  estadoFlota,
  cpkPorGrupo,
  alertasActivas,
  medicionesRecientes,
  vehiculosListar,
  fichaCubierta,
];

// ---- Punto de entrada del catálogo ---------------------------------------------------------------------------------

export function toolsParaRol(ctx: Contexto): DefTool[] {
  return HERRAMIENTAS.filter((herramienta) => herramienta.disponible(ctx)).map(definicion);
}

const bytes = (texto: string): number => new TextEncoder().encode(texto).length;

function sinFuente(fallo: Fallo): SalidaTool {
  return { contenido: JSON.stringify(fallo), fuente: null };
}

/** Recorta filas desde el final hasta que el contenido quepa en 30 KB. Búsqueda binaria: el tamaño crece con las filas. */
function armarSalida(nombre: string, salida: Salida): SalidaTool {
  const cuerpo = (cantidad: number) => {
    const recortado = salida.recortado || cantidad < salida.filas.length;
    return { contenido: JSON.stringify({ filas: salida.filas.slice(0, cantidad), recortado }), recortado };
  };
  let menor = 0;
  let mayor = salida.filas.length;
  while (menor < mayor) {
    const medio = Math.ceil((menor + mayor) / 2);
    if (bytes(cuerpo(medio).contenido) <= BYTES_MAXIMOS_CONTENIDO) menor = medio;
    else mayor = medio - 1;
  }
  const final = cuerpo(menor);
  return {
    contenido: final.contenido,
    fuente: {
      tool: nombre,
      desde: salida.desde,
      hasta: salida.hasta,
      filas: menor,
      recortado: final.recortado,
    },
  };
}

/** Punto único de ejecución: valida, consulta con el JWT del usuario y arma la salida. Nunca lanza. */
export async function ejecutarTool(
  nombre: string,
  argumentos: string,
  ctx: Contexto,
  rest: Rest,
): Promise<SalidaTool> {
  const herramienta = HERRAMIENTAS.find((h) => h.nombre === nombre);
  if (!herramienta) return sinFuente({ error: 'tool_desconocida' });
  if (!herramienta.disponible(ctx)) return sinFuente({ error: 'sin_permiso' });

  const entrada = parsearArgumentos(argumentos);
  if (!entrada.ok) return sinFuente(entrada.fallo);
  const valores = validar(herramienta.campos, entrada.valor);
  if (!valores.ok) return sinFuente(valores.fallo);

  let resultado: Intento<Salida>;
  try {
    resultado = await herramienta.ejecutar(valores.valor, ctx, rest);
  } catch {
    return sinFuente({ error: 'consulta_fallida' });
  }
  if (!resultado.ok) return sinFuente(resultado.fallo);
  return armarSalida(nombre, resultado.valor);
}
