// Tests de domain/desgaste.js (funciones puras). Ejecutar: npm test  (node:test, sin dependencias).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEAR, LIFE_LIMIT_MM, wearStatus, avgMm, tireStatus, wearClass, countByStatus,
  wearRate, daysUntil, dateUntil, unevenWear, analyzeTire
} from '../../assets/js/domain/desgaste.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);
const row = (mm1, mm2, mm3, days = 0) => ({ mm1, mm2, mm3, created_at: new Date(T0 + days * DAY).toISOString() });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('umbrales', () => {
  test('constantes', () => { assert.equal(WEAR.OK_MM, 8); assert.equal(WEAR.LOW_MM, 5); assert.equal(LIFE_LIMIT_MM, 3); });
  test('wearStatus: null/undefined -> null', () => { assert.equal(wearStatus(null), null); assert.equal(wearStatus(undefined), null); });
  test('wearStatus: 5 exacto es bajo, 8 exacto es ok', () => {
    assert.equal(wearStatus(5), 'bajo');
    assert.equal(wearStatus(8), 'ok');
  });
  test('wearStatus: justo debajo de cada umbral', () => {
    assert.equal(wearStatus(4.999), 'critico');
    assert.equal(wearStatus(7.999), 'bajo');
  });
  test('wearStatus: extremos', () => {
    assert.equal(wearStatus(0), 'critico');
    assert.equal(wearStatus(-1), 'critico');
    assert.equal(wearStatus(20), 'ok');
  });
  test('wearClass', () => {
    assert.equal(wearClass(null), 'neutral');
    assert.equal(wearClass(10), 'ok');
    assert.equal(wearClass(6), 'warn');
    assert.equal(wearClass(5), 'warn');
    assert.equal(wearClass(4), 'crit');
  });
});

describe('avgMm / tireStatus', () => {
  test('promedio de tres valores', () => close(avgMm({ mm1: 9, mm2: 6, mm3: 3 }), 6));
  test('ignora nulls', () => {
    close(avgMm({ mm1: 10, mm2: null, mm3: 6 }), 8);
    close(avgMm({ mm1: null, mm2: 7, mm3: undefined }), 7);
  });
  test('todo null -> null', () => assert.equal(avgMm({ mm1: null, mm2: null, mm3: null }), null));
  test('fila sin campos -> null', () => assert.equal(avgMm({}), null));
  test('el 0 cuenta como medición (no es null)', () => close(avgMm({ mm1: 0, mm2: 6, mm3: null }), 3));
  test('tireStatus combina promedio y umbral', () => {
    assert.equal(tireStatus({ mm1: 8, mm2: 8, mm3: 8 }), 'ok');
    assert.equal(tireStatus({ mm1: 5, mm2: 5, mm3: null }), 'bajo');
    assert.equal(tireStatus({ mm1: null, mm2: null, mm3: null }), null);
  });
});

describe('countByStatus', () => {
  test('cuenta y omite nulls', () => {
    assert.deepEqual(countByStatus([10, 8, 7, 5, 4, null, undefined]), { ok: 2, bajo: 2, critico: 1 });
  });
  test('vacío', () => assert.deepEqual(countByStatus([]), { ok: 0, bajo: 0, critico: 0 }));
});

describe('wearRate (mm/semana)', () => {
  test('0 y 1 medición -> null', () => {
    assert.equal(wearRate([]), null);
    assert.equal(wearRate(null), null);
    assert.equal(wearRate([row(10, 10, 10)]), null);
  });
  test('2 mediciones: 7 días, 1 mm perdido = 1 mm/sem', () => {
    const r = wearRate([row(10, 10, 10, 0), row(9, 9, 9, 7)]);
    close(r.mmPerWeek, 1); close(r.mmPerDay, 1 / 7); assert.equal(r.days, 7);
  });
  test('N mediciones: usa solo la primera y la última', () => {
    const r = wearRate([row(12, 12, 12, 0), row(11, 11, 11, 7), row(2, 2, 2, 10), row(6, 6, 6, 14)]);
    close(r.mmPerWeek, 3); assert.equal(r.days, 14);
  });
  test('fechas iguales -> null (sin división por cero)', () => {
    assert.equal(wearRate([row(10, 10, 10, 3), row(9, 9, 9, 3)]), null);
  });
  test('fechas en orden inverso -> null', () => {
    assert.equal(wearRate([row(10, 10, 10, 7), row(9, 9, 9, 0)]), null);
  });
  test('promedio faltante en un extremo -> null', () => {
    assert.equal(wearRate([row(null, null, null, 0), row(9, 9, 9, 7)]), null);
    assert.equal(wearRate([row(9, 9, 9, 0), row(null, null, null, 7)]), null);
  });
  test('rueda que "gana" profundidad (cambio de neumático) -> tasa negativa', () => {
    const r = wearRate([row(5, 5, 5, 0), row(12, 12, 12, 7)]);
    close(r.mmPerWeek, -7);
  });
  test('days se redondea', () => {
    assert.equal(wearRate([row(10, 10, 10, 0), row(9, 9, 9, 3.6)]).days, 4);
  });
});

describe('predicción a umbral', () => {
  test('daysUntil: (último - límite) / tasa, redondeado', () => {
    assert.equal(daysUntil(9, 0.5), 12);              // (9-3)/0.5
    assert.equal(daysUntil(8, 1 / 7), 35);            // 5 mm a 1 mm/sem
    assert.equal(daysUntil(8, 0.5, 5), 6);            // umbral personalizado
  });
  test('daysUntil: sin desgaste o datos faltantes -> null', () => {
    assert.equal(daysUntil(9, 0), null);
    assert.equal(daysUntil(9, -0.2), null);
    assert.equal(daysUntil(null, 0.5), null);
    assert.equal(daysUntil(9, null), null);
  });
  test('daysUntil: ya en/bajo el límite -> null', () => {
    assert.equal(daysUntil(3, 0.5), null);
    assert.equal(daysUntil(2, 0.5), null);
  });
  test('daysUntil: justo sobre el límite', () => assert.equal(daysUntil(3.5, 0.5), 1));
  test('dateUntil suma los días a la fecha base', () => {
    const from = new Date(Date.UTC(2026, 5, 1));
    assert.equal(dateUntil(9, 0.5, 3, from).toISOString(), new Date(Date.UTC(2026, 5, 13)).toISOString());
    assert.equal(dateUntil(9, 0, 3, from), null);
  });
});

describe('unevenWear', () => {
  test('diferencia 1.5 exacta cuenta; 1.49 no', () => {
    assert.deepEqual(unevenWear({ mm1: 8, mm3: 9.5 }), { diff: 1.5, side: 'exterior' });
    assert.equal(unevenWear({ mm1: 8, mm3: 9.49 }), null);
  });
  test('lado: mm1 menor = exterior; mm1 mayor = interior', () => {
    assert.equal(unevenWear({ mm1: 6, mm3: 9 }).side, 'exterior');
    assert.equal(unevenWear({ mm1: 9, mm3: 6 }).side, 'interior');
  });
  test('faltan datos o fila nula -> null', () => {
    assert.equal(unevenWear({ mm1: null, mm3: 6 }), null);
    assert.equal(unevenWear({ mm1: 6, mm3: undefined }), null);
    assert.equal(unevenWear(null), null);
  });
});

describe('analyzeTire', () => {
  test('sin historial -> null', () => { assert.equal(analyzeTire([]), null); assert.equal(analyzeTire(undefined), null); });
  test('1 medición: solo lastAvg (+ desparejo si aplica)', () => {
    const a = analyzeTire([row(9, 9, 9)]);
    assert.deepEqual(a, { lastAvg: 9 });
    const b = analyzeTire([row(6, 7, 9)]);
    assert.equal(b.unevenWear, 3); assert.equal(b.unevenSide, 'exterior');
    assert.equal(b.mmPerWeek, undefined);
  });
  test('historial con desgaste: tasa, días y vida útil', () => {
    const a = analyzeTire([row(12, 12, 12, 0), row(10, 10, 10, 14)]);
    close(a.lastAvg, 10); close(a.mmPerWeek, 1); assert.equal(a.days, 14);
    assert.equal(a.daysUntilLimit, 49); // (10-3) / (2/14)
    assert.equal(a.unevenWear, undefined);
  });
  test('sin desgaste (misma profundidad): daysUntilLimit null', () => {
    const a = analyzeTire([row(9, 9, 9, 0), row(9, 9, 9, 10)]);
    close(a.mmPerWeek, 0); assert.equal(a.daysUntilLimit, null);
  });
  test('fechas iguales: sin tasa ni vida útil', () => {
    const a = analyzeTire([row(9, 9, 9, 2), row(8, 8, 8, 2)]);
    assert.equal(a.mmPerWeek, undefined); assert.equal(a.daysUntilLimit, undefined); close(a.lastAvg, 8);
  });
  test('ya bajo el límite de 3 mm: daysUntilLimit null', () => {
    const a = analyzeTire([row(5, 5, 5, 0), row(2.5, 2.5, 2.5, 10)]);
    assert.equal(a.daysUntilLimit, null);
  });
  test('último promedio null con tasa imposible', () => {
    const a = analyzeTire([row(9, 9, 9, 0), row(null, null, null, 7)]);
    assert.equal(a.lastAvg, null); assert.equal(a.mmPerWeek, undefined);
  });
});
