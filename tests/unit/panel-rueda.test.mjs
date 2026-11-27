// Lógica del panel de una rueda y del menú «Más» de la cabecera del detalle de vehículo (domain/panel-rueda.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { avisoPanel, textoKmPrevios, itemsMasCabecera, textoSemanas, semanasHasta } from '../../assets/js/domain/panel-rueda.js';

describe('avisoPanel: un solo aviso por rueda, por prioridad', () => {
  test('bajo el límite de retiro: «Retirar ya.» sin RN-08 ni proyección', () => {
    const a = avisoPanel({ bajoRetiro: true, razonAcelerado: 'x', semanasRetiro: 2 });
    assert.equal(a.titulo, 'Retirar ya.');
    assert.equal(a.texto, 'Bajo el límite de retiro no se rota a otro eje.');
    assert.equal(a.proyeccion, null);
    assert.doesNotMatch(JSON.stringify(a), /RN-/);
  });
  test('desgaste acelerado: la razón es el aviso y la proyección va como segunda línea', () => {
    const a = avisoPanel({ bajoRetiro: false, razonAcelerado: 'Se gasta 1,20 mm por semana…', semanasRetiro: 1 });
    assert.equal(a.titulo, null);
    assert.equal(a.texto, 'Se gasta 1,20 mm por semana…');
    assert.equal(a.proyeccion, 'Llega a desgaste límite en 1 semana');
  });
  test('sin desgaste acelerado, la proyección a límite es el aviso', () => {
    assert.deepEqual(avisoPanel({ bajoRetiro: false, razonAcelerado: null, semanasRetiro: 12.345 }),
      { titulo: null, texto: 'Llega a desgaste límite en unas 12,3 semanas', proyeccion: null });
  });
  test('sin nada que decir (sin proyección ni acelerado), null', () => {
    assert.equal(avisoPanel({ bajoRetiro: false, razonAcelerado: null, semanasRetiro: null }), null);
  });
  test('acelerado sin semanas: solo la razón', () => {
    assert.deepEqual(avisoPanel({ bajoRetiro: false, razonAcelerado: 'Razón', semanasRetiro: undefined }),
      { titulo: null, texto: 'Razón', proyeccion: null });
  });
});

describe('textoSemanas: concordancia y decimales', () => {
  test('un entero no lleva decimal y la concordancia sigue al número', () => {
    assert.equal(textoSemanas(1), 'en 1 semana');
    assert.equal(textoSemanas(2), 'en unas 2 semanas');
  });
  test('un valor que al redondear da entero se escribe sin decimal', () => {
    assert.equal(textoSemanas(1.04), 'en 1 semana');
    assert.equal(textoSemanas(1.96), 'en unas 2 semanas');
  });
  test('con decimal, un decimal y plural', () => {
    assert.equal(textoSemanas(2.5), 'en unas 2,5 semanas');
    assert.equal(textoSemanas(12.345), 'en unas 12,3 semanas');
  });
  test('menos de una semana (incluido 0) no dice «0 semanas»', () => {
    assert.equal(textoSemanas(0), 'en menos de 1 semana');
    assert.equal(textoSemanas(0.4), 'en menos de 1 semana');
    assert.equal(textoSemanas(0.96), 'en 1 semana');
  });
});

describe('semanasHasta: proyección por la huella mínima (RN-01), no por el promedio', () => {
  test('mínimo 3,2, promedio 6, retiro 3, tasa 0,1: 2 semanas (con el promedio serían 30)', () => {
    assert.ok(Math.abs(semanasHasta(3.2, 3, 0.1) - 2) < 1e-9);
    assert.equal(textoSemanas(semanasHasta(3.2, 3, 0.1)), 'en unas 2 semanas');
  });
  test('en el umbral o por debajo, 0; sin tasa positiva o sin mínimo, null', () => {
    assert.equal(semanasHasta(3, 3, 0.5), 0);
    assert.equal(semanasHasta(2.5, 3, 0.5), 0);
    assert.equal(semanasHasta(5, 3, 0), null);
    assert.equal(semanasHasta(5, 3, -0.2), null);
    assert.equal(semanasHasta(5, 3, null), null);
    assert.equal(semanasHasta(null, 3, 0.5), null);
  });
});

describe('textoKmPrevios', () => {
  test('sin registrar (null o indefinido) no es 0 km', () => {
    assert.equal(textoKmPrevios(null), 'Sin registrar');
    assert.equal(textoKmPrevios(undefined), 'Sin registrar');
  });
  test('0 es «0 km» y los miles van con punto', () => {
    assert.equal(textoKmPrevios(0), '0 km');
    assert.equal(textoKmPrevios(20000), '20.000 km');
  });
});

describe('itemsMasCabecera', () => {
  test('operario de sucursal: solo «Distribución y servicio»', () => {
    const items = itemsMasCabecera({ puedeOperar: true, esAdminEmpresa: false, vehiculoId: 7 });
    assert.deepEqual(items.map(i => i.label), ['Distribución y servicio']);
    assert.equal(items[0].action, 'vehiculo-cambiar-distribucion');
    assert.deepEqual(items[0].args, [7]);
  });
  test('administrador de empresa: tres ítems, «Eliminar vehículo» último y en peligro', () => {
    const items = itemsMasCabecera({ puedeOperar: true, esAdminEmpresa: true, vehiculoId: 7 });
    assert.deepEqual(items.map(i => i.label), ['Distribución y servicio', 'Odómetro y ciclo de vida', 'Eliminar vehículo']);
    assert.deepEqual(items[1], { label: 'Odómetro y ciclo de vida', action: 'openCicloVida', args: [7, true] });
    const ultimo = items[items.length - 1];
    assert.equal(ultimo.action, 'vehiculo-eliminar');
    assert.deepEqual(ultimo.args, [7]);
    assert.equal(ultimo.peligro, true);
  });
  test('equipo Neumet (ni opera ni administra la empresa): sin ítems', () => {
    assert.deepEqual(itemsMasCabecera({ puedeOperar: false, esAdminEmpresa: false, vehiculoId: 7 }), []);
  });
});
