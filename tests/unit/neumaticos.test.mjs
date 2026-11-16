import test from 'node:test';
import assert from 'node:assert/strict';
import { pestanasVisibles, pestanaPorTecla, hayPestanas, PESTANA_STOCK, PESTANA_RECAUCHUTADO } from '../../assets/js/domain/neumaticos.js';

const AMBAS = [PESTANA_STOCK, PESTANA_RECAUCHUTADO];

test('pestañas: el equipo Neumet y el administrador de empresa ven Stock y Recauchutado', () => {
  assert.deepEqual(pestanasVisibles({ admin: true }), AMBAS);
  assert.deepEqual(pestanasVisibles({ adminEmpresa: true }), AMBAS);
});

test('pestañas: el usuario de sucursal y la sesión sin rol solo ven Stock', () => {
  assert.deepEqual(pestanasVisibles({}), [PESTANA_STOCK]);
  assert.deepEqual(pestanasVisibles(), [PESTANA_STOCK]);
  assert.deepEqual(pestanasVisibles({ admin: false, adminEmpresa: false }), [PESTANA_STOCK]);
});

test('pestañas: con una sola no se muestra el tablist', () => {
  assert.equal(hayPestanas(AMBAS), true);
  assert.equal(hayPestanas([PESTANA_STOCK]), false);
  assert.equal(hayPestanas([]), false);
  assert.equal(hayPestanas(null), false);
});

test('teclado: flechas con vuelta, Inicio y Fin', () => {
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'ArrowRight'), 'recauchutado');
  assert.equal(pestanaPorTecla(AMBAS, 'recauchutado', 'ArrowRight'), 'stock');
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'ArrowLeft'), 'recauchutado');
  assert.equal(pestanaPorTecla(AMBAS, 'recauchutado', 'ArrowLeft'), 'stock');
  assert.equal(pestanaPorTecla(AMBAS, 'recauchutado', 'Home'), 'stock');
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'End'), 'recauchutado');
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'ArrowDown'), 'recauchutado');
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'ArrowUp'), 'recauchutado');
});

test('teclado: teclas que no navegan, una sola pestaña y listas vacías devuelven null', () => {
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'Enter'), null);
  assert.equal(pestanaPorTecla(AMBAS, 'stock', 'a'), null);
  assert.equal(pestanaPorTecla([PESTANA_STOCK], 'stock', 'ArrowRight'), null);
  assert.equal(pestanaPorTecla([], 'stock', 'ArrowRight'), null);
  assert.equal(pestanaPorTecla(undefined, 'stock', 'ArrowRight'), null);
});

test('teclado: una pestaña actual desconocida parte de la primera', () => {
  assert.equal(pestanaPorTecla(AMBAS, 'otra', 'ArrowRight'), 'recauchutado');
});
