import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum, fmtMm, fmtPesos, fmtFecha, fmtFechaHora, fmtFechaLarga, plural } from '../../assets/js/domain/formato.js';

test('fmtNum: separador de miles con punto y decimales con coma (es-AR)', () => {
  assert.equal(fmtNum(1234567), '1.234.567');
  assert.equal(fmtNum(1234.5, 1), '1.234,5');
  assert.equal(fmtNum(6, 1), '6,0');
});

test('fmtNum/fmtMm/fmtPesos: sin dato -> guion largo', () => {
  for (const v of [null, undefined, '', 'abc', NaN]) {
    assert.equal(fmtNum(v), '—');
    assert.equal(fmtMm(v), '—');
    assert.equal(fmtPesos(v), '—');
  }
  assert.equal(fmtNum(0), '0');
});

test('fmtMm y fmtPesos', () => {
  assert.equal(fmtMm(6.25), '6,3 mm');
  assert.equal(fmtMm('13'), '13,0 mm');
  assert.equal(fmtPesos(50000), '$ 50.000');
});

test('fechas es-AR: día/mes/año y sin dato', () => {
  const d = new Date(2026, 5, 15, 9, 30);
  assert.equal(fmtFecha(d), '15/6/2026');
  assert.match(fmtFechaHora(d), /^15\/06\/26,? 09:30$/);
  assert.equal(fmtFechaLarga(d), '15 de junio de 2026');
  assert.equal(fmtFecha(null), '—');
  assert.equal(fmtFechaHora('no es fecha'), '—');
});

test('plural', () => {
  assert.equal(plural(1, 'alerta'), '1 alerta');
  assert.equal(plural(0, 'alerta'), '0 alertas');
  assert.equal(plural(1500, 'vez', 'veces'), '1.500 veces');
});
