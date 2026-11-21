// Estado de desgaste del detalle de vehículo (docs/21 §4): una sola función decide el estado de neumático, chip, panel y gráfico.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  wearStatus, umbralesEstado, valorMostrado, contarEstados, rangoEstado, rangoLargo, ejeY, bandasGrafico, estadoDeBase, ESTADOS, etiquetaChip,
} from '../../assets/js/domain/estado-desgaste.js';
import { datosGrafico, serieDesgaste, fechaEje } from '../../assets/js/domain/grafico-desgaste.js';
import { TOKENS } from '../../assets/js/domain/tokens-detalle.js';

const th = umbralesEstado({ bajo: 8, critico: 5, retiro: 3 });

// Casos 4.3 de la especificación, con umbrales 8/5/3.
const C192 = [[4.9, 'mayor'], [5.3, 'poco'], [4.7, 'mayor'], [6.8, 'poco'], [7.3, 'poco'], [6.2, 'poco'], [11.3, 'bueno'], [11.5, 'bueno'], [7.0, 'poco']];
const C179 = [[7.1, 'poco'], [7.8, 'poco'], [4.9, 'mayor'], [7.3, 'poco'], [16.0, 'bueno'], [16.0, 'bueno'], [15.0, 'bueno'], [5.1, 'poco'], [7.7, 'poco']];

describe('wearStatus', () => {
  test('casos de prueba 4.3 (Coche 192 y Coche 179)', () => {
    for (const [v, esperado] of [...C192, ...C179]) assert.equal(wearStatus(v, th), esperado, `${v} mm`);
  });
  test('totales por coche: 192 = 2 mayor, 5 poco, 2 bueno; 179 = 1 mayor, 5 poco, 3 bueno', () => {
    const a = contarEstados(C192.map(x => x[0]), th);
    assert.deepEqual([a.mayor, a.poco, a.bueno, a.total], [2, 5, 2, 9]);
    const b = contarEstados(C179.map(x => x[0]), th);
    assert.deepEqual([b.mayor, b.poco, b.bueno, b.total], [1, 5, 3, 9]);
  });
  test('límites exactos: inclusivo abajo, exclusivo arriba', () => {
    assert.equal(wearStatus(8, th), 'bueno');
    assert.equal(wearStatus(7.9, th), 'poco');
    assert.equal(wearStatus(5, th), 'poco');
    assert.equal(wearStatus(4.9, th), 'mayor');
    assert.equal(wearStatus(3, th), 'mayor');
    assert.equal(wearStatus(2.9, th), 'limite');
    assert.equal(wearStatus(0, th), 'limite');
  });
  test('sin lectura es sinDatos (null, vacío, no numérico); 0 es una lectura', () => {
    for (const v of [null, undefined, '', 'x', NaN]) assert.equal(wearStatus(v, th), 'sinDatos');
    assert.equal(wearStatus(0, th), 'limite');
  });
  test('decide con el valor mostrado (un decimal): 7,96 se muestra 8,0 y es bueno; 4,96 se muestra 5,0 y es poco', () => {
    assert.equal(valorMostrado(7.96), 8);
    assert.equal(wearStatus(7.96, th), 'bueno');
    assert.equal(wearStatus(4.96, th), 'poco');
    assert.equal(wearStatus(2.96, th), 'mayor');
  });
  test('umbrales vivos: otros umbrales del cliente cambian el resultado, sin números fijos en el código', () => {
    const o = umbralesEstado({ bajo: 10, critico: 6, retiro: 4 });
    assert.equal(wearStatus(9, o), 'poco');
    assert.equal(wearStatus(9, th), 'bueno');
    assert.equal(wearStatus(5.5, o), 'mayor');
    assert.equal(wearStatus(3.9, o), 'limite');
    assert.equal(wearStatus(3.9, th), 'mayor');
  });
  test('«Desgaste límite» usa el estilo visual de «mayor» pero conserva nombre propio', () => {
    assert.equal(ESTADOS.limite.estilo, 'mayor');
    assert.equal(ESTADOS.limite.texto, 'Desgaste límite');
    assert.equal(ESTADOS.limite.simbolo, ESTADOS.mayor.simbolo);
    assert.equal(ESTADOS.bueno.texto, 'Buen estado');
    assert.equal(ESTADOS.sinDatos.texto, 'Sin datos');
  });
  test('estado de la base -> estado del detalle', () => {
    assert.deepEqual(['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido', 'otro'].map(estadoDeBase),
      ['bueno', 'poco', 'mayor', 'limite', 'sinDatos', 'sinDatos']);
  });
});

describe('chips', () => {
  test('la suma de los estados es el total (incluye límite y sin datos)', () => {
    const c = contarEstados([12, 6, 4, 2, null, 0.5], th);
    assert.deepEqual(c, { total: 6, bueno: 1, poco: 1, mayor: 1, limite: 2, sinDatos: 1 });
    assert.equal(c.bueno + c.poco + c.mayor + c.limite + c.sinDatos, c.total);
  });
  test('rangos con coma decimal y umbrales vivos', () => {
    assert.equal(rangoEstado('bueno', th), '≥ 8 mm');
    assert.equal(rangoEstado('poco', th), '5–8 mm');
    assert.equal(rangoEstado('mayor', th), '3–5 mm');
    assert.equal(rangoEstado('limite', th), '< 3 mm');
    assert.equal(rangoEstado('sinDatos', th), '');
    assert.equal(rangoEstado('poco', { buen: 8.5, poco: 5, mayor: 3 }), '5–8,5 mm');
  });
  test('descripción accesible del rango', () => {
    assert.equal(rangoLargo('poco', th), 'de 5 mm a menos de 8 mm');
    assert.equal(etiquetaChip('mayor', 2, th), '2 neumáticos con mayor desgaste, de 3 mm a menos de 5 mm');
    assert.equal(etiquetaChip('sinDatos', 1, th), '1 neumático sin datos');
  });
});

describe('eje y bandas del gráfico', () => {
  test('lectura 4,7 -> eje 0 a 12; lectura 16,0 -> 0 a 16; marcas cada 4', () => {
    assert.deepEqual(ejeY(4.7, th), { min: 0, max: 12, marcas: [0, 4, 8, 12] });
    assert.deepEqual(ejeY(16, th), { min: 0, max: 16, marcas: [0, 4, 8, 12, 16] });
    assert.equal(ejeY(16.1, th).max, 20);
  });
  test('el eje siempre deja margen sobre «buen» con otros umbrales', () => {
    assert.equal(ejeY(2, { buen: 10, poco: 6, mayor: 4 }).max, 14);
  });
  test('bandas: 0..mayor con estilo mayor y sin rótulo; las otras con «Nombre · rango»', () => {
    const b = bandasGrafico(th, 12);
    assert.deepEqual(b.map(x => [x.id, x.estilo, x.desde, x.hasta]), [['limite', 'mayor', 0, 3], ['mayor', 'mayor', 3, 5], ['poco', 'poco', 5, 8], ['bueno', 'bueno', 8, 12]]);
    assert.equal(b[0].rotulo, null);
    assert.equal(b[1].rotulo, 'Mayor desgaste · 3–5 mm');
    assert.equal(b[3].rotulo, 'Buen estado · ≥ 8 mm');
  });
});

describe('datosGrafico', () => {
  const med = (d, mm) => ({ created_at: new Date(Date.UTC(2026, 10, 20 + d, 12)).toISOString(), promedio: mm, mm1: mm, mm2: mm, mm3: mm });
  test('sin puntos -> null', () => assert.equal(datosGrafico([], th), null));
  test('una lectura: punto centrado, sin línea, una fecha en el eje', () => {
    const d = datosGrafico(serieDesgaste([med(0, 4.7)]), th, { ancho: 400 });
    assert.equal(d.unico, true);
    assert.equal(d.linea, null);
    assert.equal(d.puntos.length, 1);
    assert.equal(d.ejeX.length, 1);
    assert.equal(d.puntos[0].x, (d.area.x0 + d.area.x1) / 2);
    assert.equal(d.puntos[0].estado, 'mayor');
    assert.equal(d.eje.max, 12);
  });
  test('varias lecturas: línea, inset de 24 px a cada lado y estado del punto por wearStatus', () => {
    const d = datosGrafico(serieDesgaste([med(0, 12), med(28, 6), med(56, 2.5)]), th, { ancho: 400 });
    assert.ok(d.linea.startsWith('M'));
    assert.equal(d.puntos[0].x, d.area.x0 + TOKENS.chart.plotInsetXPx);
    assert.equal(d.puntos[2].x, d.area.x1 - TOKENS.chart.plotInsetXPx);
    assert.deepEqual(d.puntos.map(p => p.estado), ['bueno', 'poco', 'limite']);
    assert.equal(d.puntos[2].ultimo, true);
    assert.equal(d.alto, 220);
  });
  test('el punto cae dentro de la banda de su estado', () => {
    const d = datosGrafico(serieDesgaste([med(0, 6.2)]), th, { ancho: 400 });
    const banda = d.bandas.find(b => b.id === d.puntos[0].estado);
    assert.ok(d.puntos[0].y >= banda.y && d.puntos[0].y <= banda.y + banda.alto);
  });
  test('las bandas cubren el área completa de arriba a abajo sin huecos', () => {
    const d = datosGrafico(serieDesgaste([med(0, 6)]), th, { ancho: 400 });
    const orden = [...d.bandas].sort((a, b) => a.y - b.y);
    assert.ok(Math.abs(orden[0].y - d.area.y0) < 0.01);
    for (let i = 1; i < orden.length; i++) assert.ok(Math.abs(orden[i].y - (orden[i - 1].y + orden[i - 1].alto)) < 0.01);
    assert.ok(Math.abs(orden[orden.length - 1].y + orden[orden.length - 1].alto - d.area.y1) < 0.01);
  });
  test('rótulo oculto si la banda es más baja que el mínimo o no cabe en el ancho; la banda inferior nunca lleva rótulo', () => {
    const ancho = datosGrafico(serieDesgaste([med(0, 6)]), th, { ancho: 600 });
    assert.equal(ancho.bandas.find(b => b.id === 'limite').rotuloVisible, false);
    assert.equal(ancho.bandas.find(b => b.id === 'bueno').rotuloVisible, true);
    const angosto = datosGrafico(serieDesgaste([med(0, 6)]), th, { ancho: 120 });
    assert.ok(angosto.bandas.every(b => !b.rotuloVisible));
    const bajo = datosGrafico(serieDesgaste([med(0, 6)]), th, { ancho: 600, alto: 90 });
    assert.equal(bajo.bandas.find(b => b.id === 'mayor').rotuloVisible, false, 'banda de menos de 20 px de alto');
  });
  test('serieDesgaste conserva las tres huellas y descarta mediciones sin dato', () => {
    const s = serieDesgaste([{ created_at: '2026-11-20T10:00:00Z', mm1: 5, mm2: 6, mm3: 7 }, { created_at: '2026-11-21T10:00:00Z' }]);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].mm1, s[0].mm2, s[0].mm3, s[0].mm], [5, 6, 7, 6]);
  });
  test('fecha del eje: «20 nov» y año si cruza', () => {
    const t = new Date(2026, 10, 20).getTime();
    assert.equal(fechaEje(t), '20 nov');
    assert.equal(fechaEje(t, true), '20 nov 26');
    const d = datosGrafico(serieDesgaste([med(-400, 9), med(0, 8)]), th, { ancho: 400 });
    assert.match(d.ejeX[0].texto, /\d{2}$/);
  });
});
