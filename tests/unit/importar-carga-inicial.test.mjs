// Carga inicial del listado de un cliente: parte pura (supabase/seed/lib). Datos sintéticos; nada de ningún cliente real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerXlsx, serialAFecha } from '../../supabase/seed/lib/xlsx.mjs';
import {
  parsearInterno, parsearFecha, parsearMm, normalizarDimension, mapearCubierta, distribuirVehiculo, filasDesdeTabla, armarPlan,
  POSICION_AUXILIO, MOTIVO_DESCARTE, hoyMontevideo,
} from '../../supabase/seed/lib/carga-inicial.mjs';
import { sqlCarga } from '../../supabase/seed/lib/sql.mjs';
import { entornoPsql, ARGS_PSQL, sinSecretos } from '../../supabase/seed/lib/conexion.mjs';
import { escribirXlsx, listadoSintetico, fila, CABECERA } from './helpers/xlsx-sintetico.mjs';

const OPC = { clienteId: 1, sucursalId: 1, fechaCarga: '2026-11-20', descarte: 'baja', hoy: new Date('2026-11-20T12:00:00Z') };
const plan = (tabla = listadoSintetico(), op = OPC, ex) => armarPlan(filasDesdeTabla(tabla), op, ex);

test('xlsx: ida y vuelta conserva texto, acentos y celdas vacías', () => {
  const t = [['A', 'B', 'C'], ['x&y', '', 'ñandú <1>']];
  assert.deepEqual(leerXlsx(escribirXlsx(t)), [['A', 'B', 'C'], ['x&y', '', 'ñandú <1>']]);
});

test('INTERNO: patente | número, solo número, solo patente, patente igual al número', () => {
  assert.deepEqual(parsearInterno(' zza 0001 | 101 '), { patente: 'ZZA0001', numero: '101' });
  assert.deepEqual(parsearInterno('101'), { patente: null, numero: '101' });
  assert.deepEqual(parsearInterno('ZZB0002'), { patente: 'ZZB0002', numero: 'ZZB0002' });
  assert.deepEqual(parsearInterno('ZZB0002 | ZZB0002'), { patente: 'ZZB0002', numero: 'ZZB0002' });
  assert.ok(parsearInterno('').error);
  assert.ok(parsearInterno('a|b|c').error);
});

test('fecha dd/mm/aaaa: calendario real y rango', () => {
  const hoy = new Date('2026-11-20T12:00:00Z');
  assert.equal(parsearFecha('05/03/2026', hoy), '2026-03-05');
  assert.equal(parsearFecha('31/02/2026', hoy), null);
  assert.equal(parsearFecha('2026-03-05', hoy), null);
  assert.equal(parsearFecha('', hoy), null);
  assert.equal(parsearFecha('01/01/1999', hoy), null);
  assert.equal(parsearFecha('01/01/2030', hoy), null);
});

test('mm: texto normalizado para notas; vacío null; ilegible marcado', () => {
  assert.equal(parsearMm('15.0| 14,5 |15|15').texto, '15.0|14,5|15|15');
  assert.equal(parsearMm(''), null);
  assert.ok(parsearMm('15|x|2').invalido);
  assert.ok(parsearMm('15||2').invalido);
  assert.ok(parsearMm('99').invalido);
});

test('dimensión: normaliza coma y r; marca lo dudoso', () => {
  assert.deepEqual(normalizarDimension('295/80r22,5'), { texto: '295/80R22.5', dudosa: false });
  assert.deepEqual(normalizarDimension('11R22.5'), { texto: '11R22.5', dudosa: false });
  assert.equal(normalizarDimension('raro').dudosa, true);
  assert.equal(normalizarDimension(''), null);
});

test('cubierta: vida = carga + extra acotada a 3; condición según estado y destino', () => {
  const f = (o) => ({ 'CANTIDAD RECAPADOS CARGA': '0', 'CANTIDAD RECAPADOS EXTRA': '0', 'KM TOTAL ACUMULADO': '0', 'ESTADO NEUMATICO': 'Usada original', ...o });
  const a = mapearCubierta(f({ 'CANTIDAD RECAPADOS CARGA': '2', 'CANTIDAD RECAPADOS EXTRA': '2' }), { montado: true });
  assert.equal(a.vida, 3); assert.equal(a.condicion, 'recauchutado'); assert.ok(a.adv.length);
  const b = mapearCubierta(f({ 'ESTADO NEUMATICO': 'Nueva original' }), { montado: false });
  assert.equal(b.condicion, 'nuevo');
  assert.equal(mapearCubierta(f({ 'ESTADO NEUMATICO': 'Nueva original' }), { montado: true }).condicion, 'usado');
  assert.equal(mapearCubierta(f({ 'ESTADO NEUMATICO': 'Nueva original', 'KM TOTAL ACUMULADO': '10' }), { montado: false }).condicion, 'usado');
  const c = mapearCubierta(f({ 'ESTADO NEUMATICO': 'Usada recapada' }), { montado: false });
  assert.equal(c.vida, 0); assert.equal(c.condicion, 'recauchutado'); assert.ok(c.adv.length);
  assert.equal(mapearCubierta(f({ 'CANTIDAD RECAPADOS CARGA': '-1' }), { montado: false }).vida, 0);
  assert.equal(mapearCubierta(f({ 'KM TOTAL ACUMULADO': '55000' }), { montado: false }).kmPrevios, 55000);
});

test('tipo de ruedas y auxilio: 9 y 11 llevan auxilio en 99; 8 y 10 no; huecos avisan; repetidas bloquean', () => {
  const d9 = distribuirVehiculo([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(d9.aux, 9); assert.equal(d9.ruedas, 8); assert.equal(d9.mapa.get(9), POSICION_AUXILIO); assert.equal(d9.tipo_ruedas, 10);
  assert.equal(distribuirVehiculo([1, 2, 3, 4, 5, 6, 7, 8]).aux, null);
  assert.equal(distribuirVehiculo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).aux, null);
  const d11 = distribuirVehiculo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(d11.aux, 11); assert.equal(d11.ruedas, 10);
  assert.ok(distribuirVehiculo([1, 2, 4, 9]).adv.some((x) => x.includes('sin neumático')));
  assert.ok(distribuirVehiculo([1, 1, 2]).error);
  assert.ok(distribuirVehiculo([1, 12]).error);
  assert.ok(distribuirVehiculo(['x']).error);
});

test('plan: conteos por categoría y mapeo de cada destino', () => {
  const p = plan();
  assert.equal(p.resumen.vehiculos, 3);
  assert.equal(p.resumen.montados, 9 + 8 + 4);
  assert.equal(p.resumen.auxilios, 1 + 1);
  assert.equal(p.resumen.stock, 4); // 3 + el repetido
  assert.equal(p.resumen.bajas, 2);
  const baja = p.neumaticos.find((n) => n.tipo === 'baja');
  assert.equal(baja.estado, 'baja'); assert.equal(baja.motivo_baja, MOTIVO_DESCARTE); assert.equal(baja.fecha_baja, '2026-11-20');
  assert.equal(baja.veh_numero, null); assert.match(baja.notas, /Depósito: DESCARTE/);
  const st = p.neumaticos.find((n) => n.tipo === 'stock');
  assert.equal(st.estado, 'almacenado'); assert.equal(st.sucursal_id, 1); assert.equal(st.posicion, null); assert.match(st.notas, /Depósito: DEPOSITO GOMERIA/);
  const m = p.neumaticos.find((n) => n.tipo === 'montado' && n.posicion === 1 && n.veh_numero === '11');
  assert.equal(m.vida, 2); assert.equal(m.condicion, 'recauchutado'); assert.equal(m.fecha_montaje, '2026-03-15');
  assert.match(m.notas, /Últimos mm \(carga inicial\): 15\.0\|14\.0\|15\.0\|13\.5/);
  assert.ok(p.neumaticos.every((n) => n.estado !== 'montado' || n.condicion !== 'nuevo'));
});

test('plan: vehículo con patente igual al número y número de otro con patente', () => {
  const p = plan();
  const v = p.vehiculos.find((x) => x.numero === 'ZZC0003');
  assert.equal(v.patente, 'ZZC0003'); assert.equal(v.nombre, 'Coche ZZC0003'); assert.equal(v.sucursal_id, 1);
  assert.equal(p.vehiculos.find((x) => x.numero === '11').patente, 'ZZA0001');
});

test('plan: código repetido, el primero conserva el código y el segundo va sin código con nota', () => {
  const p = plan();
  const rep = p.neumaticos.filter((n) => n.idneumatico.startsWith('CI-1-1000'));
  assert.equal(rep.length, 2);
  assert.equal(rep.filter((n) => n.codigo === '1000').length, 1);
  const segundo = rep.find((n) => n.repetido);
  assert.equal(segundo.codigo, null); assert.match(segundo.notas, /Código repetido en el Excel: 1000/);
  assert.equal(new Set(p.neumaticos.map((n) => n.idneumatico)).size, p.neumaticos.length);
  assert.ok(p.advertencias.some((a) => /repetido/.test(a.texto)));
});

test('plan: --descarte omitir no carga las bajas', () => {
  const p = plan(listadoSintetico(), { ...OPC, descarte: 'omitir' });
  assert.equal(p.resumen.bajas, 0); assert.equal(p.resumen.descartesOmitidos, 2);
});

test('plan: filas inválidas se omiten con advertencia, sin abortar', () => {
  const t = listadoSintetico();
  t.push(fila({ CODIGO: '', 'ESTADO ACTUAL': 'en deposito', DEPOSITO: 'X' }));
  t.push(fila({ CODIGO: '9001', 'ESTADO ACTUAL': 'perdido' }));
  t.push(fila({ CODIGO: '9002', 'ESTADO ACTUAL': 'montado', INTERNO: '', POSICION: '1' }));
  t.push(fila({ CODIGO: '9003', 'ESTADO ACTUAL': 'montado', INTERNO: 'ZZD0004 | 44', POSICION: '1' }));
  t.push(fila({ CODIGO: '9004', 'ESTADO ACTUAL': 'montado', INTERNO: 'ZZD0004 | 44', POSICION: '1' }));
  const p = plan(t);
  assert.equal(p.resumen.omitidas, 3 + 2); // sin código, estado desconocido, sin vehículo, y las dos de posición repetida
  assert.equal(p.vehiculos.length, 3);
});

test('plan: choque con un vehículo ajeno bloquea; uno de la misma carga se reutiliza', () => {
  const ajeno = { vehiculos: [{ id: 5, numero: '22', patente_norm: 'OTRA', notas: 'creado a mano' }], neumaticos: [] };
  const a = plan(listadoSintetico(), OPC, ajeno);
  assert.equal(a.vehiculos.length, 2);
  assert.ok(a.advertencias.some((x) => x.nivel === 'omitida' && /ajeno/.test(x.texto)));
  const propio = { vehiculos: [{ id: 5, numero: '22', patente_norm: 'ZZB0002', notas: 'Carga inicial Excel 2026-11-19' }], neumaticos: [{ idneumatico: 'CI-1-1009' }] };
  const b = plan(listadoSintetico(), OPC, propio);
  assert.equal(b.vehiculos.length, 3); assert.equal(b.resumen.vehiculosYaCargados, 1); assert.equal(b.resumen.neumaticosYaCargados, 1);
});

test('filasDesdeTabla: falta una columna obligatoria', () => {
  assert.throws(() => filasDesdeTabla([CABECERA.filter((c) => c !== 'POSICION')]), /POSICION/);
});

test('sql: una transacción, idempotente por idneumatico, comillas escapadas, sin RPC', () => {
  const t = listadoSintetico();
  t.push(fila({ CODIGO: '9100', 'ESTADO ACTUAL': 'en deposito', DEPOSITO: "O'Brien", MARCA: "D'Arcy" }));
  const s = sqlCarga(plan(t), { ...OPC, nombreCliente: 'Cliente A' });
  assert.match(s, /^[\s\S]*\nbegin;/);
  assert.match(s, /commit;\n$/);
  assert.match(s, /on conflict \(idneumatico\) do nothing/);
  assert.match(s, /'D''Arcy'/);
  assert.match(s, /Depósito: O''Brien/);
  assert.doesNotMatch(s, /auth\.uid|neumatico_montar\(/);
});

// ---- Correcciones del PR (un test por cada una) ----
const CLI = new URL('../../supabase/seed/importar-carga-inicial.mjs', import.meta.url).pathname;
const ARGS_CLI = ['--cliente-id', '1', '--sucursal-id', '1', '--nombre-cliente', 'Cliente A'];
function archivoSintetico(tabla = listadoSintetico()) {
  const dir = mkdtempSync(join(tmpdir(), 'carga-'));
  const ruta = join(dir, 'listado.xlsx');
  writeFileSync(ruta, escribirXlsx(tabla));
  return { dir, ruta };
}

test('dry-run: avisa que los montados quedan sin km del tramo actual y cómo completarlo', () => {
  const { ruta } = archivoSintetico();
  const r = spawnSync(process.execPath, [CLI, '--archivo', ruta, ...ARGS_CLI], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Montados sin km del tramo actual: 21 .*sin odómetro/);
  assert.match(r.stdout, /docs\/20/);
});

test('CLI: el nombre del cliente, el cliente y la sucursal son obligatorios (sin valores por defecto)', () => {
  const { ruta } = archivoSintetico();
  const r = spawnSync(process.execPath, [CLI, '--archivo', ruta, '--cliente-id', '1', '--sucursal-id', '1'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--nombre-cliente es obligatorio/);
});

test('conexión: la clave va por PGPASSWORD y ningún argumento de psql lleva la cadena', () => {
  const cadena = 'postgresql://usuario:clave%2Fde-prueba@db.ejemplo.test:6543/base?sslmode=require';
  const env = entornoPsql({ NEUMET_DB_URL: cadena, PATH: '/bin' });
  assert.deepEqual(
    { h: env.PGHOST, p: env.PGPORT, u: env.PGUSER, c: env.PGPASSWORD, d: env.PGDATABASE, s: env.PGSSLMODE, url: env.NEUMET_DB_URL },
    { h: 'db.ejemplo.test', p: '6543', u: 'usuario', c: 'clave/de-prueba', d: 'base', s: 'require', url: undefined });
  assert.ok(!ARGS_PSQL.some((a) => a.includes('postgres') || a.includes('clave')));
  assert.equal(entornoPsql({ PGSERVICE: 'neumet' }).PGSERVICE, 'neumet');
  assert.equal(entornoPsql({ PATH: '/bin' }), null);
  assert.throws(() => entornoPsql({ NEUMET_DB_URL: 'esto no es una url con clave-secreta' }), (e) => !/clave-secreta/.test(e.message));
  assert.equal(sinSecretos('fallo con clave-x en el texto', { PGPASSWORD: 'clave-x' }), 'fallo con <oculto> en el texto');
});

test('CLI: psql se invoca sin la cadena en los argumentos y con PGPASSWORD en el entorno', () => {
  const { dir, ruta } = archivoSintetico();
  const falso = join(dir, 'psql-falso.sh');
  const traza = join(dir, 'traza.txt');
  writeFileSync(falso, `#!/bin/sh\nprintf '%s\\n' "ARGS:$*" "PGPASSWORD:$PGPASSWORD" "PGHOST:$PGHOST" >> "${traza}"\ncat >/dev/null\n`
    + `echo '{"cliente":"Cliente A","sucursal_ok":true,"nombre_ok":true,"vehiculos":[],"neumaticos":[],"baja_sin_vehiculo":true}'\n`);
  chmodSync(falso, 0o755);
  const r = spawnSync(process.execPath, [CLI, '--archivo', ruta, ...ARGS_CLI], { encoding: 'utf8',
    env: { PATH: process.env.PATH, PSQL_BIN: falso, NEUMET_DB_URL: 'postgresql://usuario:clave-de-prueba@db.ejemplo.test/base' } });
  assert.equal(r.status, 0, r.stderr);
  const t = readFileSync(traza, 'utf8');
  assert.match(t, /PGPASSWORD:clave-de-prueba/);
  assert.match(t, /PGHOST:db\.ejemplo\.test/);
  assert.doesNotMatch(t.split('\n').filter((l) => l.startsWith('ARGS:')).join(), /clave-de-prueba|postgresql:\/\/|db\.ejemplo/);
  assert.doesNotMatch(r.stdout + r.stderr, /clave-de-prueba/);
});

test('plan: la patente de un vehículo ya cargado con otro número bloquea con motivo claro', () => {
  const ex = { vehiculos: [{ id: 7, numero: '99', patente_norm: 'ZZB0002', notas: 'Carga inicial Excel 2026-11-19' }], neumaticos: [] };
  const p = plan(listadoSintetico(), OPC, ex);
  assert.equal(p.vehiculos.length, 2);
  assert.ok(p.advertencias.some((a) => a.nivel === 'omitida' && /la patente ZZB0002 ya está cargada en el vehículo número 99 \(aquí el número es 22\)/.test(a.texto)));
  const ex2 = { vehiculos: [{ id: 8, numero: '22', patente_norm: 'OTRA123', notas: 'Carga inicial Excel 2026-11-19' }], neumaticos: [] };
  const p2 = plan(listadoSintetico(), OPC, ex2);
  assert.ok(p2.advertencias.some((a) => a.nivel === 'omitida' && /el número 22 ya está cargado con otra patente/.test(a.texto)));
});

test('plan: en el propio listado, la misma patente con dos números bloquea el segundo con motivo claro', () => {
  const t = listadoSintetico();
  t.push(fila({ CODIGO: '9201', 'ESTADO ACTUAL': 'montado', INTERNO: 'ZZA0001 | 77', POSICION: '1' }));
  const p = plan(t);
  assert.equal(p.vehiculos.length, 3);
  assert.ok(p.advertencias.some((a) => a.nivel === 'omitida' && /la patente ZZA0001 aparece también con otro número/.test(a.texto)));
});

test('cubierta: recapados que no son enteros avisan en vez de tomarse como 0 en silencio', () => {
  const f = (o) => ({ 'CANTIDAD RECAPADOS CARGA': '0', 'CANTIDAD RECAPADOS EXTRA': '0', 'KM TOTAL ACUMULADO': '0', 'ESTADO NEUMATICO': 'Usada original', ...o });
  const a = mapearCubierta(f({ 'CANTIDAD RECAPADOS CARGA': '1.5' }), { montado: false });
  assert.equal(a.vida, 0);
  assert.ok(a.adv.some((x) => /CANTIDAD RECAPADOS CARGA no es un entero/.test(x)));
  assert.ok(mapearCubierta(f({ 'CANTIDAD RECAPADOS EXTRA': 'dos' }), { montado: false }).adv.some((x) => /RECAPADOS EXTRA no es un entero/.test(x)));
  assert.equal(mapearCubierta(f({}), { montado: false }).adv.length, 0); // vacío o cero no avisa
});

test('fecha de carga por defecto: día de Montevideo, no UTC', () => {
  assert.equal(hoyMontevideo(new Date('2026-11-21T01:30:00Z')), '2026-11-20'); // 22:30 del 20 en Montevideo
  assert.equal(hoyMontevideo(new Date('2026-11-20T12:00:00Z')), '2026-11-20');
  assert.equal(hoyMontevideo(new Date('2026-11-20T03:00:00Z')), '2026-11-20'); // 00:00 en Montevideo
});

test('xlsx: las fechas guardadas como número de serie salen como dd/mm/aaaa; el texto y los números comunes no cambian', () => {
  assert.equal(serialAFecha(46096), '15/03/2026');
  assert.equal(serialAFecha(46096.75), '15/03/2026');
  assert.equal(serialAFecha('x'), null);
  const t = [['F1', 'F2', 'F3', 'F4', 'F5'], [{ serial: 46096, estilo: 1 }, { serial: 46097, estilo: 2 }, '16/03/2026', { serial: 46098 }, { serial: 46099, estilo: 3 }]];
  assert.deepEqual(leerXlsx(escribirXlsx(t))[1], ['15/03/2026', '16/03/2026', '16/03/2026', '46098', '46099']);
});

test('plan: el montaje con fecha en serie de Excel y con fecha en texto dan la misma fecha', () => {
  const t = listadoSintetico();
  const i = t[0].indexOf('FECHA MONTAJE');
  t[1][i] = { serial: 46096, estilo: 1 }; // el resto sigue como texto 15/03/2026
  const p = armarPlan(filasDesdeTabla(leerXlsx(escribirXlsx(t))), OPC);
  const fechas = new Set(p.neumaticos.filter((n) => n.tipo === 'montado').map((n) => n.fecha_montaje));
  assert.deepEqual([...fechas], ['2026-03-15']);
});
