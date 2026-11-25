// Medianas de referencia por posición y por eje (desgaste-flota.js). Con distribución, el eje sale del diagrama. Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { referenciaTasas, evaluarDesgaste } from '../../assets/js/domain/desgaste-flota.js';

const fila = (posicion, tasa, distribucion) => ({ posicion, tasa_mm_semana: tasa, distribucion });
// Flota de 8x2 (SSDS): 3 vehículos con la posición 9 y 2 con la 10 (eje 4: 5 muestras entre las dos);
// 5 vehículos con las posiciones 5 a 8 (eje 3: 20 muestras, todas a 2,0 mm por semana).
const flota = [
  ...[1, 2, 3].map(() => fila(9, 0.5, '8x2')),
  ...[1, 2].map(() => fila(10, 0.5, '8x2')),
  ...[1, 2, 3, 4, 5].flatMap(() => [5, 6, 7, 8].map(p => fila(p, 2, '8x2'))),
];

describe('referenciaTasas con distribución del catálogo', () => {
  const ref = referenciaTasas(flota);
  test('el eje 4 de un 8x2 son las posiciones 9 y 10', () => {
    assert.deepEqual(ref.porEje.get(4), { n: 5, mediana: 0.5 });
  });
  test('el eje 3 son las posiciones 5 a 8 y nada más', () => {
    assert.deepEqual(ref.porEje.get(3), { n: 20, mediana: 2 });
  });
  test('la posición 9 tiene 3 muestras: no alcanza para su propia mediana', () => {
    assert.deepEqual(ref.porPosicion.get(9), { n: 3, mediana: null });
  });
  test('una posición sin eje en el diagrama no crea una clave null en los ejes', () => {
    assert.equal(referenciaTasas([...flota, fila('x', 0.5, '8x2')]).porEje.has(null), false);
  });
});

describe('evaluarDesgaste compara con el eje del diagrama cuando la posición no tiene muestra propia', () => {
  const ref = referenciaTasas(flota);
  test('la posición 9 se compara con el eje 4 (mediana 0,5)', () => {
    const r = evaluarDesgaste(fila(9, 1, '8x2'), ref);
    assert.equal(r.grupo, 'el eje 4');
    assert.equal(r.tasaAlta, true);
    assert.equal(r.ratio, 2);
  });
  test('una tasa normal para ese eje no marca', () => {
    assert.equal(evaluarDesgaste(fila(9, 0.6, '8x2'), ref).tasaAlta, false);
  });
});

describe('sin distribución: la numeración de siempre', () => {
  test('una fila sin distribución se agrupa por el eje de la numeración de siempre (la 9 cae en el 3)', () => {
    const ref = referenciaTasas([fila(9, 0.5, undefined)]);
    assert.equal(ref.porEje.get(3).n, 1);
  });
});
