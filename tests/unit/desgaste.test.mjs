// Tests de domain/desgaste.js (funciones puras). Ejecutar: npm test  (node:test, sin dependencias).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  UMBRALES, WEAR, LIFE_LIMIT_MM, wearStatus, avgMm, tireStatus, wearClass, countByStatus,
  wearRate, daysUntil, dateUntil, unevenWear, analyzeTire, IRREGULARIDAD_MM_DEFECTO, asimetriaLateral, clasificarDesgaste
} from '../../assets/js/domain/desgaste.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);
const row = (mm1, mm2, mm3, days = 0) => ({ mm1, mm2, mm3, created_at: new Date(T0 + days * DAY).toISOString() });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('umbrales', () => {
  test('constantes', () => { assert.equal(UMBRALES.BAJO_MM, 8); assert.equal(UMBRALES.CRITICO_MM, 5); assert.equal(UMBRALES.RETIRO_MM, 3); assert.equal(WEAR.OK_MM, 8); assert.equal(WEAR.LOW_MM, 5); assert.equal(LIFE_LIMIT_MM, 3); });
  test('wearStatus: null/undefined -> null', () => { assert.equal(wearStatus(null), null); assert.equal(wearStatus(undefined), null); });
  test('wearStatus: umbrales exactos', () => {
    assert.equal(wearStatus(8), 'nuevo');
    assert.equal(wearStatus(5), 'poco_desgaste');
    assert.equal(wearStatus(3), 'mayor_desgaste');
  });
  test('wearStatus: justo debajo de cada umbral', () => {
    assert.equal(wearStatus(7.999), 'poco_desgaste');
    assert.equal(wearStatus(4.999), 'mayor_desgaste');
    assert.equal(wearStatus(2.999), 'desgaste_limite');
  });
  test('wearStatus: extremos', () => {
    assert.equal(wearStatus(0), 'desgaste_limite');
    assert.equal(wearStatus(-1), 'desgaste_limite');
    assert.equal(wearStatus(20), 'nuevo');
  });
  test('wearClass', () => {
    assert.equal(wearClass(null), 'neutral');
    assert.equal(wearClass(10), 'ok');
    assert.equal(wearClass(6), 'ok');
    assert.equal(wearClass(5), 'ok');
    assert.equal(wearClass(4), 'warn');
    assert.equal(wearClass(2), 'crit');
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
  // RN-01: el estado sale de la huella MÍNIMA. Con el promedio 6,0 (9, 6, 3) el mínimo 3 es mayor desgaste, no límite.
  test('tireStatus usa la huella mínima, no el promedio', () => {
    assert.equal(tireStatus({ mm1: 8, mm2: 8, mm3: 8 }), 'nuevo');
    assert.equal(tireStatus({ mm1: 9, mm2: 6, mm3: 3 }), 'mayor_desgaste');
    assert.equal(tireStatus({ mm1: 8.5, mm2: 8.5, mm3: 2.9 }), 'desgaste_limite'); // CA-08: promedio 6,6, mínimo 2,9
    assert.equal(tireStatus({ mm1: 2.8, mm2: 4.0, mm3: 4.2 }), 'desgaste_limite'); // CA-01: promedio 3,67
  });
  test('tireStatus sin una huella: sin estado (no se fabrica con dos)', () => {
    assert.equal(tireStatus({ mm1: 5, mm2: 5, mm3: null }), null);
    assert.equal(tireStatus({ mm1: 3, mm2: 3, mm3: null }), null);
    assert.equal(tireStatus({ mm1: null, mm2: null, mm3: null }), null);
  });
});

describe('countByStatus', () => {
  test('cuenta por nivel visual y omite nulls', () => {
    assert.deepEqual(countByStatus([10, 8, 7, 5, 4, 2, null, undefined]), { ok: 4, warn: 1, crit: 1 });
  });
  test('vacío', () => assert.deepEqual(countByStatus([]), { ok: 0, warn: 0, crit: 0 }));
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

describe('unevenWear (CA-06: umbral del cliente y criterio de la base)', () => {
  test('el umbral por defecto es el de la base: 2,0 mm', () => {
    assert.equal(IRREGULARIDAD_MM_DEFECTO, 2);
  });
  test('9 / 10 / 11 con umbral 2,0 es desparejo: 2,0 mm o más (RN-06), lado interno', () => {
    assert.deepEqual(unevenWear({ mm1: 9, mm2: 10, mm3: 11 }, 2), { diff: 2, side: 'interno' });
  });
  test('1,9 mm no llega al umbral de 2,0', () => {
    assert.equal(unevenWear({ mm1: 9, mm2: 10, mm3: 10.9 }, 2), null);
  });
  test('la diferencia se muestra con un decimal como la base: 2,04 pasa a 2,0', () => {
    assert.deepEqual(unevenWear({ mm1: 9, mm2: 10, mm3: 11.04 }, 2), { diff: 2, side: 'interno' });
  });
  test('9,96 − 8 (1,96) redondea a 2,0 y es desparejo; 9,94 − 8 (1,94) redondea a 1,9 y no', () => {
    assert.deepEqual(unevenWear({ mm1: 8, mm2: 9, mm3: 9.96 }, 2), { diff: 2, side: 'interno' });
    assert.equal(unevenWear({ mm1: 8, mm2: 9, mm3: 9.94 }, 2), null);
  });
  test('8,7 − 6,7 da 1,9999999999999991 en coma flotante y cuenta como 2,0', () => {
    assert.deepEqual(unevenWear({ mm1: 6.7, mm2: 7, mm3: 8.7 }, 2), { diff: 2, side: 'interno' });
  });
  test('9 / 10 / 11,1 sí es desparejo, con el lado interno (el más desgastado es mm1)', () => {
    const r = unevenWear({ mm1: 9, mm2: 10, mm3: 11.1 }, 2);
    close(r.diff, 2.1); assert.equal(r.side, 'interno');
  });
  test('4,03 / 3 / 2,03 es desparejo de 2,0 exactos: en coma flotante 4,03 − 2,03 da 2,0000000000000004 y el resultado sale limpio', () => {
    assert.deepEqual(unevenWear({ mm1: 4.03, mm2: 3, mm3: 2.03 }, 2), { diff: 2, side: 'externo' });
  });
  test('sin umbral del cliente (no se pudo leer) usa el de la base: 2,0 mm', () => {
    assert.deepEqual(unevenWear({ mm1: 9, mm2: 10, mm3: 11 }, null), { diff: 2, side: 'interno' });
    assert.equal(unevenWear({ mm1: 9, mm2: 10, mm3: 10.9 }, null), null);
    close(unevenWear({ mm1: 9, mm2: 10, mm3: 11.1 }, null).diff, 2.1);
  });
  test('el umbral lo fija el cliente: 3 mm no alcanzan con 4 y sí con 2,5', () => {
    assert.equal(unevenWear({ mm1: 6, mm2: 7, mm3: 9 }, 4), null);
    assert.notEqual(unevenWear({ mm1: 6, mm2: 7, mm3: 9 }, 2.5), null);
  });
  test('1,5 mm ya no alcanza por defecto: el umbral fijo de 1,5 se quitó', () => {
    assert.equal(unevenWear({ mm1: 8, mm2: 8, mm3: 9.5 }), null);
  });
  test('el desgaste en el centro también cuenta: diferencia entre la mayor y la menor de las tres', () => {
    const r = unevenWear({ mm1: 9, mm2: 6, mm3: 9 }, 2);
    assert.notEqual(r, null); close(r.diff, 3);
  });
  test('lado: el de menos mm entre interno (mm1) y externo (mm3)', () => {
    assert.equal(unevenWear({ mm1: 6, mm2: 7, mm3: 9 }, 2).side, 'interno');
    assert.equal(unevenWear({ mm1: 9, mm2: 7, mm3: 6 }, 2).side, 'externo');
  });
  test('sin interno o externo no hay lado que decir: null', () => {
    assert.equal(unevenWear({ mm1: null, mm2: 7, mm3: 6 }, 2), null);
    assert.equal(unevenWear({ mm1: 6, mm2: 7, mm3: undefined }, 2), null);
    assert.equal(unevenWear(null, 2), null);
  });
  test('sin mm2 la diferencia sale de las presentes, como greatest()/least() de la base (que ignoran NULL)', () => {
    const r = unevenWear({ mm1: 6, mm2: null, mm3: 9 }, 2);
    close(r.diff, 3); assert.equal(r.side, 'interno');
    assert.equal(unevenWear({ mm1: 9, mm2: null, mm3: 9 }, 2), null);
  });
});

describe('unevenWear sin mm1 o mm3: lo dice la fila de estado (desgaste_irregular)', () => {
  const sinInterno = { mm1: null, mm2: 10, mm3: 7 };
  test('con la marca de la vista: la diferencia que calculó la vista y sin lado', () => {
    assert.deepEqual(unevenWear({ ...sinInterno, desgaste_irregular: true, diferencia_huellas_mm: 3 }, 2), { diff: 3, side: null });
  });
  test('sin marca o con la marca en falso: null', () => {
    assert.equal(unevenWear(sinInterno, 2), null);
    assert.equal(unevenWear({ ...sinInterno, desgaste_irregular: false, diferencia_huellas_mm: 3 }, 2), null);
  });
  test('sin mm3 también cuenta con la marca', () => {
    assert.deepEqual(unevenWear({ mm1: 10, mm2: 9, mm3: null, desgaste_irregular: true, diferencia_huellas_mm: 2 }, 2), { diff: 2, side: null });
  });
});

describe('analyzeTire', () => {
  test('sin historial -> null', () => { assert.equal(analyzeTire([]), null); assert.equal(analyzeTire(undefined), null); });
  test('1 medición: solo lastAvg (+ desparejo si aplica)', () => {
    const a = analyzeTire([row(9, 9, 9)]);
    assert.deepEqual(a, { lastAvg: 9 });
    const b = analyzeTire([row(6, 7, 9)]);
    assert.equal(b.unevenWear, 3); assert.equal(b.unevenSide, 'interno');
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
  test('el aviso de desparejo sigue al umbral que se pasa (el del cliente)', () => {
    assert.equal(analyzeTire([row(6, 7, 9)], 4).unevenWear, undefined);
    assert.equal(analyzeTire([row(6, 7, 9)], 2).unevenWear, 3);
  });
  test('CA-06 en el análisis: 9 / 10 / 11 avisa con el umbral de 2,0, lado interno', () => {
    const a = analyzeTire([row(9, 10, 11)], 2);
    assert.equal(a.unevenWear, 2); assert.equal(a.unevenSide, 'interno');
  });
  test('sin mm1, el aviso sale de la fila de estado y no dice el lado', () => {
    const estado = { mm1: null, mm2: 10, mm3: 7, desgaste_irregular: true, diferencia_huellas_mm: 3 };
    const a = analyzeTire([row(null, 10, 7)], 2, estado);
    assert.equal(a.unevenWear, 3); assert.equal(a.unevenSide, null);
  });
  test('sin mm1 y sin fila de estado no hay aviso, como antes', () => {
    assert.equal(analyzeTire([row(null, 10, 7)], 2).unevenWear, undefined);
  });
});

describe('asimetriaLateral y clasificarDesgaste (R1: el lateral se mide entre bordes, separado del rango; docs/18 §8)', () => {
  const fila = (mm1, mm2, mm3, extra = {}) => ({ mm1, mm2, mm3, ...extra });
  test('T04: asimetría de 2,5 mm por el externo; se clasifica como lateral', () => {
    assert.deepEqual(asimetriaLateral(fila(9, 8, 6.5), 2), { diff: 2.5, lado: 'externo' });
    assert.equal(clasificarDesgaste(fila(9, 8, 6.5), 2), 'lateral');
  });
  // Separa T04 (lateral) de T05 y T06 (irregular): si clasificarDesgaste usara el rango para el lateral, T05 y T06 también saldrían lateral.
  test('T05 y T06 no tienen asimetría lateral: son irregular por rango, nunca lateral', () => {
    assert.equal(asimetriaLateral(fila(9, 6.5, 9), 2), null);
    assert.equal(clasificarDesgaste(fila(9, 6.5, 9), 2), 'irregular');
    assert.equal(asimetriaLateral(fila(6, 8.6, 6), 2), null);
    assert.equal(clasificarDesgaste(fila(6, 8.6, 6), 2), 'irregular');
  });
  test('T07 parejo: sin lateral ni irregular', () => {
    assert.equal(asimetriaLateral(fila(9, 8, 9), 2), null);
    assert.equal(clasificarDesgaste(fila(9, 8, 9), 2), null);
  });
  test('borde lateral exacto al umbral: 10/9/8 es lateral por el externo', () => {
    assert.deepEqual(asimetriaLateral(fila(10, 9, 8), 2), { diff: 2, lado: 'externo' });
    assert.equal(clasificarDesgaste(fila(10, 9, 8), 2), 'lateral');
  });
  test('lado interno: 6,5/8/9 es lateral por el interno', () => {
    assert.deepEqual(asimetriaLateral(fila(6.5, 8, 9), 2), { diff: 2.5, lado: 'interno' });
    assert.equal(clasificarDesgaste(fila(6.5, 8, 9), 2), 'lateral');
  });
  test('coma flotante: 8,7 − 6,7 da 2 exacto, no 1,999…', () => {
    const r = asimetriaLateral(fila(8.7, 8, 6.7), 2);
    assert.equal(r.diff, 2);
    assert.equal(r.lado, 'externo');
    assert.equal(clasificarDesgaste(fila(8.7, 8, 6.7), 2), 'lateral');
  });
  test('lateral de 1,9 con rango de 2,0: no es lateral, es irregular', () => {
    assert.equal(asimetriaLateral(fila(10, 8, 8.1), 2), null);
    assert.equal(clasificarDesgaste(fila(10, 8, 8.1), 2), 'irregular');
  });
  test('todo por debajo de 2,0: sin aviso', () => {
    assert.equal(asimetriaLateral(fila(9.9, 9, 8), 2), null);
    assert.equal(clasificarDesgaste(fila(9.9, 9, 8), 2), null);
  });
  test('sin mm3 no hay lateral: lo decide unevenWear con la fila (desgaste_irregular)', () => {
    assert.equal(asimetriaLateral(fila(9, 8, null), 2), null);
    assert.equal(clasificarDesgaste(fila(9, 8, null), 2), null);
    assert.equal(clasificarDesgaste(fila(9, 8, null, { desgaste_irregular: true, diferencia_huellas_mm: 2 }), 2), 'irregular');
  });
  test('umbral del cliente de 3,0: T04 ya no alcanza ni lateral ni irregular', () => {
    assert.equal(asimetriaLateral(fila(9, 8, 6.5), 3), null);
    assert.equal(clasificarDesgaste(fila(9, 8, 6.5), 3), null);
  });
  test('umbral nulo: usa 2,0 por defecto', () => {
    assert.deepEqual(asimetriaLateral(fila(9, 8, 6.5), undefined), { diff: 2.5, lado: 'externo' });
    assert.equal(clasificarDesgaste(fila(9, 8, 6.5), null), 'lateral');
  });
  test('bordes iguales no tienen lado que nombrar, aunque el umbral fuera 0', () => {
    assert.equal(asimetriaLateral(fila(9, 8, 9), 0), null);
    assert.equal(asimetriaLateral(null, 2), null);
  });
  test('analyzeTire agrega lateralWear y lateralSide y deja unevenWear (el rango, RN-06)', () => {
    const a = analyzeTire([row(9, 8, 6.5)], 2);
    assert.equal(a.lateralWear, 2.5); assert.equal(a.lateralSide, 'externo');
    assert.equal(a.unevenWear, 2.5); assert.equal(a.unevenSide, 'externo');
    const b = analyzeTire([row(9, 8, 9)], 2);
    assert.equal('lateralWear' in b, false); assert.equal('lateralSide' in b, false);
  });
});
