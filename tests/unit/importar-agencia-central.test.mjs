// Carga inicial de Agencia Central: parte pura (supabase/seed/lib). Datos sintéticos; nada de ningún cliente real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerXlsx } from '../../supabase/seed/lib/xlsx.mjs';
import {
  parsearInterno, parsearFecha, parsearMm, normalizarDimension, mapearCubierta, distribuirVehiculo, filasDesdeTabla, armarPlan,
  POSICION_AUXILIO, MOTIVO_DESCARTE,
} from '../../supabase/seed/lib/agencia-central.mjs';
import { sqlCarga } from '../../supabase/seed/lib/sql.mjs';
import { escribirXlsx, listadoSintetico, fila, CABECERA } from './helpers/xlsx-sintetico.mjs';

const OPC = { clienteId: 1, sucursalId: 1, fechaCarga: '2026-11-20', descarte: 'baja', hoy: new Date('2026-11-20T12:00:00Z') };
const plan = (tabla = listadoSintetico(), op = OPC, ex) => armarPlan(filasDesdeTabla(tabla), op, ex);

test('xlsx: ida y vuelta conserva texto, acentos y celdas vacías', () => {
  const t = [['A', 'B', 'C'], ['x&y', '', 'ñandú <1>']];
  assert.deepEqual(leerXlsx(escribirXlsx(t)), [['A', 'B', 'C'], ['x&y', '', 'ñandú <1>']]);
});

test('INTERNO: patente | número, solo número, solo patente, patente igual al número', () => {
  assert.deepEqual(parsearInterno(' stu 2456 | 370 '), { patente: 'STU2456', numero: '370' });
  assert.deepEqual(parsearInterno('370'), { patente: null, numero: '370' });
  assert.deepEqual(parsearInterno('MAJ2429'), { patente: 'MAJ2429', numero: 'MAJ2429' });
  assert.deepEqual(parsearInterno('MAJ2429 | MAJ2429'), { patente: 'MAJ2429', numero: 'MAJ2429' });
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
  const s = sqlCarga(plan(t), { ...OPC, nombreCliente: 'Agencia Central' });
  assert.match(s, /^[\s\S]*\nbegin;/);
  assert.match(s, /commit;\n$/);
  assert.match(s, /on conflict \(idneumatico\) do nothing/);
  assert.match(s, /'D''Arcy'/);
  assert.match(s, /Depósito: O''Brien/);
  assert.doesNotMatch(s, /auth\.uid|neumatico_montar\(/);
});
