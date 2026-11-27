import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { ConsultaSelect, Contexto, Rest, ResultadoRest } from './contrato.ts';
import { ejecutarTool, toolsParaRol } from './tools.ts';

const base = {
  usoId: 1,
  clienteId: 7,
  clienteNombre: 'Cliente demo',
  sucursalId: null,
  sucursalNombre: null,
  monedaDefault: 'USD',
  hoy: '2026-11-27',
};
const GLOBAL: Contexto = { ...base, rol: 'global', costosVisibles: true };
const SUCURSAL: Contexto = { ...base, rol: 'sucursal', sucursalId: 3, sucursalNombre: 'Norte', costosVisibles: false };

type Responder = (consulta: ConsultaSelect) => ResultadoRest;
const SIN_FILAS: Responder = () => ({ ok: true, filas: [] });

/** `Rest` falso: registra cada consulta y responde con `select` o `rpc`. Ninguna prueba llega a PostgREST. */
function fakeRest(select: Responder = SIN_FILAS, rpc: Responder = SIN_FILAS) {
  const consultas: ConsultaSelect[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rest: Rest = {
    select(consulta) {
      consultas.push(consulta);
      return Promise.resolve(select(consulta));
    },
    rpc(fn, args) {
      rpcs.push({ fn, args });
      return Promise.resolve(rpc({ recurso: fn, columnas: '', filtros: [], limite: 0 }));
    },
  };
  return { rest, consultas, rpcs };
}

const contenido = (salida: { contenido: string }) => JSON.parse(salida.contenido);
const nombres = (ctx: Contexto) => toolsParaRol(ctx).map((tool) => tool.function.name);
const bytes = (texto: string) => new TextEncoder().encode(texto).length;

const COLUMNAS_ESTADO =
  'vehiculo_id,vehiculo_nombre,patente,posicion,idneumatico,marca,modelo,vida,estado,minimo,promedio,' +
  'ultima_medicion_at,dias_desde_medicion,sin_medir,tasa_mm_semana,semanas_hasta_retiro,rol_eje,estado_direccion';

Deno.test('global declara 6 tools; sucursal, 5 sin cpk_por_grupo; ninguna de la ola 7', () => {
  assertEquals(nombres(GLOBAL).length, 6);
  assertEquals(nombres(SUCURSAL).length, 5);
  assert(!nombres(SUCURSAL).includes('cpk_por_grupo'));
  for (const nombre of [...nombres(GLOBAL), ...nombres(SUCURSAL)]) {
    assert(nombre !== 'reporte_periodo' && nombre !== 'rendimiento_descartadas', nombre);
  }
});

Deno.test('estado_flota ignora cliente_id del modelo y pide limite + 1 con columnas exactas', async () => {
  const { rest, consultas } = fakeRest();
  const salida = await ejecutarTool('estado_flota', '{"limite":5,"cliente_id":99}', GLOBAL, rest);
  assertEquals(salida.fuente?.tool, 'estado_flota');
  assertEquals(consultas.length, 1);
  assertEquals(consultas[0].recurso, 'v_estado_neumaticos');
  assertEquals(consultas[0].filtros, [['cliente_id', 'eq.7']]);
  assertEquals(consultas[0].limite, 6);
  assertEquals(consultas[0].columnas, COLUMNAS_ESTADO);
});

Deno.test('argumentos inválidos no llaman a rest y dicen el campo', async () => {
  const { rest, consultas } = fakeRest();
  assertEquals(contenido(await ejecutarTool('estado_flota', '{"estado":"roto"}', GLOBAL, rest)), {
    error: 'argumento_invalido',
    detalle: 'estado',
  });
  assertEquals(contenido(await ejecutarTool('estado_flota', '{"otra":1}', GLOBAL, rest)), {
    error: 'argumento_invalido',
    detalle: 'otra',
  });
  assertEquals(contenido(await ejecutarTool('estado_flota', 'no json', GLOBAL, rest)), {
    error: 'argumento_invalido',
    detalle: 'json',
  });
  assertEquals(consultas.length, 0);
});

Deno.test('seis filas con limite 5 dan cinco y recortado', async () => {
  const filas = Array.from({ length: 6 }, (_, i) => ({ vehiculo_id: i + 1 }));
  const { rest } = fakeRest(() => ({ ok: true, filas }));
  const salida = await ejecutarTool('estado_flota', '{"limite":5}', GLOBAL, rest);
  const cuerpo = contenido(salida);
  assertEquals(cuerpo.filas.length, 5);
  assertEquals(cuerpo.recortado, true);
  assertEquals(salida.fuente?.filas, 5);
  assertEquals(salida.fuente?.recortado, true);
});

Deno.test('200 filas grandes quedan bajo 30 KB y recortado', async () => {
  const filas = Array.from({ length: 200 }, (_, i) => ({ id: i, texto: 'x'.repeat(470) }));
  const { rest } = fakeRest(() => ({ ok: true, filas }));
  const salida = await ejecutarTool('estado_flota', '{"limite":200}', GLOBAL, rest);
  assert(bytes(salida.contenido) <= 30 * 1024, String(bytes(salida.contenido)));
  assertEquals(contenido(salida).recortado, true);
  assert((salida.fuente?.filas ?? 0) < 200);
});

Deno.test('cpk_por_grupo: sucursal recibe sin_permiso sin llamar a rest; global llama a la RPC sin cliente_id', async () => {
  const sucursal = fakeRest();
  const negada = await ejecutarTool('cpk_por_grupo', '{"grupo":"marca"}', SUCURSAL, sucursal.rest);
  assertEquals(negada.contenido, '{"error":"sin_permiso"}');
  assertEquals(negada.fuente, null);
  assertEquals(sucursal.rpcs.length, 0);

  const filaRpc = { grupo: 'marca', clave: 'Michelin', cliente_id: 7, moneda: 'USD', cpk: 0.12, n_neumaticos: 8 };
  const global = fakeRest(SIN_FILAS, () => ({ ok: true, filas: [filaRpc] }));
  const salida = await ejecutarTool(
    'cpk_por_grupo',
    '{"grupo":"marca","desde":"2026-07-01","hasta":"2026-09-30"}',
    GLOBAL,
    global.rest,
  );
  assertEquals(global.rpcs, [
    {
      fn: 'cpk_por_grupo',
      args: { p_grupo: 'marca', p_desde: '2026-07-01', p_hasta: '2026-09-30', p_cliente_id: 7 },
    },
  ]);
  const cuerpo = contenido(salida);
  assertEquals(cuerpo.filas.length, 1);
  assert(!('cliente_id' in cuerpo.filas[0]));
  assertEquals(salida.fuente?.desde, '2026-07-01');
});

Deno.test('cpk_por_grupo con grupo fuera de la lista es argumento_invalido', async () => {
  const { rest, rpcs } = fakeRest();
  const salida = await ejecutarTool('cpk_por_grupo', '{"grupo":"precio"}', GLOBAL, rest);
  assertEquals(contenido(salida), { error: 'argumento_invalido', detalle: 'grupo' });
  assertEquals(rpcs.length, 0);
});

Deno.test('mediciones_recientes valida fechas y el rango de 730 días', async () => {
  const invalidos: Array<[string, string]> = [
    ['{"hasta":"2026-10-31"}', 'desde'],
    ['{"desde":"2026-02-30","hasta":"2026-03-01"}', 'desde'],
    ['{"desde":"2026-10-31","hasta":"2026-10-01"}', 'hasta'],
    ['{"desde":"2025-01-01","hasta":"2027-01-02"}', 'hasta'],
  ];
  for (const [argumentos] of invalidos) {
    const { rest, consultas } = fakeRest();
    const salida = await ejecutarTool('mediciones_recientes', argumentos, GLOBAL, rest);
    assertEquals(contenido(salida).error, 'argumento_invalido', argumentos);
    assertEquals(consultas.length, 0, argumentos);
  }

  const justo = fakeRest();
  const aceptado = await ejecutarTool(
    'mediciones_recientes',
    '{"desde":"2025-01-01","hasta":"2027-01-01"}',
    GLOBAL,
    justo.rest,
  );
  assertEquals(contenido(aceptado).error, undefined);
  assertEquals(justo.consultas.length, 1);

  const octubre = fakeRest();
  await ejecutarTool('mediciones_recientes', '{"desde":"2026-10-01","hasta":"2026-10-31"}', GLOBAL, octubre.rest);
  assertEquals(octubre.consultas[0].filtros, [
    ['cliente_id', 'eq.7'],
    ['calidad', 'neq.invalidada'],
    ['created_at', 'gte.2026-10-01'],
    ['created_at', 'lt.2026-11-01'],
  ]);
});

Deno.test('vehiculos_listar satura el texto y nunca deja separadores del filtro or', async () => {
  const { rest, consultas } = fakeRest();
  await ejecutarTool('vehiculos_listar', '{"texto":"ab,c)(*"}', GLOBAL, rest);
  assertEquals(consultas[0].filtros, [
    ['cliente_id', 'eq.7'],
    ['or', '(nombre.ilike.*abc*,patente.ilike.*abc*,numero.ilike.*abc*)'],
  ]);
  assertEquals(consultas[0].columnas, 'id,nombre,patente,numero,tipo_ruedas,distribucion,servicio,sucursal_id,activo');

  const vacio = fakeRest();
  const salida = await ejecutarTool('vehiculos_listar', '{"texto":"(),"}', GLOBAL, vacio.rest);
  assertEquals(contenido(salida), { error: 'argumento_invalido', detalle: 'texto' });
  assertEquals(vacio.consultas.length, 0);
});

Deno.test('ficha_cubierta pide costos solo a quien los ve y rechaza quemas con comodines', async () => {
  const respuestas: Record<string, unknown[]> = {
    neumaticos: [{ id: 11, numero_quema: 'A-12', vehiculos: { nombre: 'Camión 1', patente: 'AAA111' } }],
    eventos_neumatico: [],
    v_km_cubierta: [{ km_totales: 1000 }],
    v_costo_cubierta: [{ moneda: 'USD', costo_total: 50 }],
  };
  const select: Responder = (consulta) => ({ ok: true, filas: respuestas[consulta.recurso] ?? [] });

  const global = fakeRest(select);
  await ejecutarTool('ficha_cubierta', '{"quema":"A-12"}', GLOBAL, global.rest);
  assertEquals(global.consultas[0].recurso, 'neumaticos');
  assert(global.consultas[0].filtros.some(([col, val]) => col === 'cliente_id' && val === 'eq.7'));
  assert(global.consultas[0].filtros.some(([col, val]) => col === 'numero_quema' && val === 'ilike.A-12'));
  assert(global.consultas.some((c) => c.recurso === 'v_costo_cubierta'));

  const sucursal = fakeRest(select);
  const salida = await ejecutarTool('ficha_cubierta', '{"quema":"A-12"}', SUCURSAL, sucursal.rest);
  assert(!sucursal.consultas.some((c) => c.recurso === 'v_costo_cubierta'));
  assertEquals(contenido(salida).filas[0].costos, 'sin_permiso');

  for (const quema of ['x%', 'a'.repeat(31)]) {
    const rechazo = fakeRest(select);
    const malo = await ejecutarTool('ficha_cubierta', JSON.stringify({ quema }), GLOBAL, rechazo.rest);
    assertEquals(contenido(malo).error, 'argumento_invalido', quema);
    assertEquals(rechazo.consultas.length, 0);
  }
});

Deno.test('errores de rest: 42501 es sin_permiso; otro código no expone el mensaje de la base', async () => {
  const denegado = fakeRest(() => ({ ok: false, status: 403, code: '42501' }));
  assertEquals(
    (await ejecutarTool('estado_flota', '{}', GLOBAL, denegado.rest)).contenido,
    '{"error":"sin_permiso"}',
  );

  const fallo = fakeRest(() => ({ ok: false, status: 400, code: 'PGRST100' }));
  const salida = await ejecutarTool('estado_flota', '{}', GLOBAL, fallo.rest);
  assertEquals(contenido(salida).error, 'consulta_fallida');
  assert(!salida.contenido.includes('PGRST100'));
  assertEquals(salida.fuente, null);
});

Deno.test('nombre desconocido es tool_desconocida', async () => {
  const { rest, consultas } = fakeRest();
  const salida = await ejecutarTool('reporte_periodo', '{}', GLOBAL, rest);
  assertEquals(contenido(salida), { error: 'tool_desconocida' });
  assertEquals(consultas.length, 0);
});
