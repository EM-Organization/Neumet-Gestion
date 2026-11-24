// Tests de domain/reportes.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOM, csvCell, buildCsv, medicionesCsv, medicionesToCsvRows, safeFilename, resumenFlota, rangoFechas, fetchAll, CSV_HEADER
} from '../../assets/js/domain/reportes.js';

const m = (vid, pos, prom, day = 1, extra = {}) => ({ vehiculo_id: vid, posicion: pos, mm1: prom, mm2: prom, mm3: prom, promedio: prom, created_at: `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`, vehiculos: { nombre: 'V' + vid, patente: 'P' + vid }, ...extra });

describe('csvCell (RFC 4180)', () => {
  test('texto simple sin comillas', () => assert.equal(csvCell('hola'), 'hola'));
  test('comas, comillas y saltos de línea', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('di "hola"'), '"di ""hola"""');
    assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
    assert.equal(csvCell('l1\r\nl2'), '"l1\r\nl2"');
  });
  test('null/undefined -> vacío', () => { assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), ''); });
  test('números con punto, negativos sin prefijo, no finitos vacíos', () => {
    assert.equal(csvCell(7.5), '7.5'); assert.equal(csvCell(-3), '-3'); assert.equal(csvCell(NaN), ''); assert.equal(csvCell(Infinity), '');
  });
  test('Date -> ISO', () => assert.equal(csvCell(new Date(Date.UTC(2026, 0, 2))), '2026-01-02T00:00:00.000Z'));
});

describe('inyección de fórmulas', () => {
  for (const s of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])
    test(`prefija ${JSON.stringify(s)}`, () => assert.ok(csvCell(s).replace(/^"/, '').startsWith("'")));
  test('payload hostil con comas y comillas', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  });
  test('texto "-5" (string) se prefija; número -5 no', () => {
    assert.equal(csvCell('-5'), "'-5"); assert.equal(csvCell(-5), '-5');
  });
  test('en el CSV completo, nombre de vehículo hostil queda neutralizado', () => {
    const csv = medicionesCsv([{ ...m(1, 1, 9), vehiculos: { nombre: '=cmd|calc', patente: '@x' } }]);
    assert.ok(csv.split('\r\n')[1].includes(",'=cmd|calc,'@x,"));
  });
});

describe('buildCsv / medicionesCsv', () => {
  test('BOM, CRLF, separador coma', () => {
    const csv = buildCsv(['a', 'b'], [[1, 'x']]);
    assert.ok(csv.startsWith(BOM)); assert.equal(csv, BOM + 'a,b\r\n1,x\r\n');
  });
  test('lista vacía: solo cabecera', () => assert.equal(medicionesCsv([]), BOM + CSV_HEADER.join(',') + '\r\n'));
  test('null -> sin filas', () => assert.deepEqual(medicionesToCsvRows(null), []));
  test('fila: fecha ISO, números con punto, estado', () => {
    const [row] = medicionesToCsvRows([m(1, 2, 7.25, 3, { mm1: 8, mm2: '7.5', mm3: null, idneumatico: 'N-1' })]);
    // Sin mm3 no hay huella mínima: la columna minimo queda vacía y el estado no se fabrica (RN-01); el promedio sigue.
    assert.deepEqual(row, ['2026-01-03T10:00:00.000Z', 'V1', 'P1', 2, 'N-1', 8, 7.5, null, null, 7.25, '']);
  });
  test('sin promedio se calcula de mm1..mm3; el estado sale del mínimo; sin datos -> estado vacío', () => {
    const [r1] = medicionesToCsvRows([{ mm1: 9, mm2: 9, mm3: 6, created_at: '2026-01-01T00:00:00Z' }]);
    assert.equal(r1[8], 6, 'minimo');
    assert.equal(r1[9], 8, 'promedio (informativo)');
    assert.equal(r1[10], 'poco_desgaste', 'mínimo 6 mm: entre 5 y 8 es poco desgaste, aunque el promedio sea 8');
    const r = medicionesToCsvRows([{ created_at: 'basura' }])[0];
    assert.equal(r[0], ''); assert.equal(r[10], '');
  });
});

describe('safeFilename', () => {
  test('quita acentos, espacios y caracteres raros', () => assert.equal(safeFilename(['neumet', 'Cañón S.A.', '2026-01-01']), 'neumet_Canon_S_A_2026-01-01.csv'));
  test('path traversal, vacío y extensión rara', () => {
    assert.equal(safeFilename('../../etc/passwd'), 'etc_passwd.csv');
    assert.equal(safeFilename(['', null]), 'reporte.csv');
    assert.equal(safeFilename('a', 'c/sv'), 'a.csv');
  });
});

describe('resumenFlota', () => {
  test('umbrales exactos: 8 = nuevo, 5 = poco desgaste, 3 = mayor desgaste, 2.99 = desgaste límite', () => {
    const r = resumenFlota([m(1, 1, 8), m(1, 2, 5), m(1, 3, 3), m(1, 4, 2.99), m(1, 5, 20)]);
    assert.equal(r.neumaticos.length, 5);
    assert.deepEqual([r.nuevo, r.pocoDesgaste, r.mayorDesgaste, r.limite, r.desconocido], [2, 1, 1, 1, 0]);
  });
  test('usa solo la última medición por neumático, sin importar el orden', () => {
    const r = resumenFlota([m(1, 1, 3, 1), m(1, 1, 9, 5), m(1, 1, 4, 2)]);
    assert.equal(r.neumaticos.length, 1); assert.equal(r.nuevo, 1); assert.equal(r.limite, 0);
  });
  test('por vehículo y desconocido', () => {
    const r = resumenFlota([m(1, 1, 9), m(2, 1, 2), { vehiculo_id: 2, posicion: 2, created_at: '2026-01-01T00:00:00Z' }]);
    assert.equal(r.vehiculos.length, 2);
    assert.deepEqual(r.vehiculos.find(v => v.vehiculo_id === 2), { vehiculo_id: 2, nombre: '', patente: '', neumaticos: 2, nuevo: 0, pocoDesgaste: 0, mayorDesgaste: 0, limite: 1, desconocido: 1 });
    assert.equal(r.desconocido, 1);
  });
  test('vacío / null', () => {
    for (const x of [[], null, undefined]) {
      const r = resumenFlota(x);
      assert.deepEqual([r.neumaticos.length, r.vehiculos.length, r.nuevo, r.pocoDesgaste, r.mayorDesgaste, r.limite, r.desconocido], [0, 0, 0, 0, 0, 0, 0]);
    }
  });
});

describe('rangoFechas', () => {
  test('vacío -> sin límites', () => assert.deepEqual(rangoFechas('', ''), { desde: null, hasta: null }));
  test('mismo día: hasta es exclusivo (día siguiente)', () => {
    const r = rangoFechas('2026-01-01', '2026-01-01');
    assert.ok(r.desde < r.hasta);
  });
  test('invertido -> error; basura se ignora', () => {
    assert.ok(rangoFechas('2026-02-01', '2026-01-01').error);
    assert.deepEqual(rangoFechas('xx', 'zz'), { desde: null, hasta: null });
  });
});

describe('fetchAll (paginación por lotes)', () => {
  const mk = total => {
    const calls = [];
    return { calls, fn: async (a, b) => { calls.push([a, b]); const n = Math.max(0, Math.min(b, total - 1) - a + 1); return { data: Array.from({ length: n }, (_, i) => ({ i: a + i })), error: null }; } };
  };
  test('2.500 filas -> 3 lotes con rangos 0-999, 1000-1999, 2000-2999', async () => {
    const s = mk(2500); const prog = [];
    const r = await fetchAll(s.fn, { onProgress: n => prog.push(n) });
    assert.equal(r.rows.length, 2500); assert.equal(r.truncated, false);
    assert.deepEqual(s.calls, [[0, 999], [1000, 1999], [2000, 2999]]); assert.deepEqual(prog, [1000, 2000, 2500]);
  });
  test('múltiplo exacto: pide un lote vacío extra', async () => {
    const s = mk(2000); const r = await fetchAll(s.fn);
    assert.equal(r.rows.length, 2000); assert.equal(s.calls.length, 3); assert.equal(r.truncated, false);
  });
  test('tope: trunca y avisa', async () => {
    const s = mk(10000); const r = await fetchAll(s.fn, { max: 3000 });
    assert.equal(r.rows.length, 3000); assert.equal(r.truncated, true); assert.equal(s.calls.length, 3);
  });
  test('vacío y error', async () => {
    assert.deepEqual((await fetchAll(mk(0).fn)).rows, []);
    const r = await fetchAll(async () => ({ data: null, error: new Error('x') }));
    assert.ok(r.error);
  });
});
