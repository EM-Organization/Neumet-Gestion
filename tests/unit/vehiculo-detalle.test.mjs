// Tests de la lógica pura del detalle de vehículo: búsqueda, layout de ruedas, escala de color, indicador de desgaste y gráfico.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarPatente, claveBusqueda, buscarVehiculos, coincidenciaExacta } from '../../assets/js/domain/vehiculo-busqueda.js';
import {
  layoutRuedas, geometriaDiagrama, ejeDePosicion, umbralesDe, nivelDesgaste, colorDesgaste, colorTexto, contraste, muestrasLeyenda,
} from '../../assets/js/domain/vehiculo-diagrama.js';
import { mediana, referenciaTasas, evaluarDesgaste } from '../../assets/js/domain/desgaste-flota.js';
import { serieDesgaste, datosGrafico, mmMedicion } from '../../assets/js/domain/grafico-desgaste.js';

describe('normalización de búsqueda', () => {
  test('normalizarPatente = public.normalizar_patente (mayúsculas, sin espacios, vacío -> null)', () => {
    assert.equal(normalizarPatente(' ab 123\tcd '), 'AB123CD');
    assert.equal(normalizarPatente('   '), null);
    assert.equal(normalizarPatente(null), null);
  });
  test('claveBusqueda ignora tildes además', () => assert.equal(claveBusqueda(' Camión 01'), 'CAMION01'));
});

describe('buscarVehiculos / coincidenciaExacta', () => {
  const vs = [
    { id: 1, nombre: 'Camión 01', patente: 'AB123CD', numero: '07' },
    { id: 2, nombre: 'Unidad Sur', patente: 'CR 0001', numero: '112' },
    { id: 3, nombre: 'Tractor', patente: 'ZZ999YY', numero: '7' },
    { id: 4, nombre: 'Sin datos', patente: null, numero: null },
  ];
  test('parcial, sin mayúsculas ni espacios', () => {
    assert.deepEqual(buscarVehiculos(vs, 'ab 12').map(v => v.id), [1]);
    assert.deepEqual(buscarVehiculos(vs, 'cr0001').map(v => v.id), [2]);
    assert.deepEqual(buscarVehiculos(vs, 'cr 00').map(v => v.id), [2]);
  });
  test('por número de coche; la coincidencia exacta va primero', () => {
    assert.deepEqual(buscarVehiculos(vs, '7').map(v => v.id), [3, 1]);
  });
  test('también por nombre y vacío devuelve todos', () => {
    assert.deepEqual(buscarVehiculos(vs, 'tractor').map(v => v.id), [3]);
    assert.equal(buscarVehiculos(vs, '  ').length, 4);
    assert.deepEqual(buscarVehiculos(vs, 'nada'), []);
  });
  test('coincidenciaExacta: una sola exacta abre directo; ambigua o parcial no', () => {
    assert.equal(coincidenciaExacta(vs, 'ab123cd').id, 1);
    assert.equal(coincidenciaExacta(vs, '7').id, 3);
    assert.equal(coincidenciaExacta(vs, '07').id, 1);
    assert.equal(coincidenciaExacta(vs, 'ab12'), null);
    assert.equal(coincidenciaExacta([...vs, { id: 5, nombre: 'Dup', patente: 'ab123cd' }], 'AB123CD'), null);
    assert.equal(coincidenciaExacta(vs, ''), null);
  });
});

describe('layoutRuedas', () => {
  const todas = n => Array.from({ length: n }, (_, i) => i + 1);
  test('tipo 10: 3 ejes (simple + 2 duales), 10 ruedas', () => {
    const l = layoutRuedas(todas(10), 10);
    assert.equal(l.ejes.length, 3);
    assert.deepEqual(l.ejes.map(e => e.ruedas.length), [2, 4, 4]);
    assert.deepEqual(l.ejes.map(e => e.dual), [false, true, true]);
    assert.equal(l.ruedas.length, 10);
    assert.equal(l.auxilios.length, 0);
  });
  test('mapeo posición -> eje/lado/interna', () => {
    const r = p => layoutRuedas(todas(16), 16).ruedas.find(x => x.posicion === p);
    assert.deepEqual([r(1).eje, r(1).lado, r(1).interna], [1, 'izq', null]);
    assert.deepEqual([r(2).eje, r(2).lado, r(2).interna], [1, 'der', null]);
    assert.deepEqual([r(3).eje, r(3).lado, r(3).interna], [2, 'izq', false]);
    assert.deepEqual([r(4).eje, r(4).lado, r(4).interna], [2, 'izq', true]);
    assert.deepEqual([r(5).eje, r(5).lado, r(5).interna], [2, 'der', true]);
    assert.deepEqual([r(6).eje, r(6).lado, r(6).interna], [2, 'der', false]);
    assert.deepEqual([r(14).eje, r(14).lado, r(14).interna], [4, 'der', false]);
    assert.deepEqual([r(15).eje, r(15).dual], [5, false]);
    assert.equal(r(4).etiqueta, 'Eje 2 · izquierda interna');
  });
  test('tipo 16: 5 ejes y 16 ruedas', () => {
    const l = layoutRuedas(todas(16), 16);
    assert.equal(l.ejes.length, 5);
    assert.equal(l.ruedas.length, 16);
  });
  test('adaptativo: tipo 10 con posiciones > 10 usa la disposición de 16; tipo desconocido -> 10', () => {
    assert.equal(layoutRuedas([1, 2, 12], 10).tipo, 16);
    assert.equal(layoutRuedas([1], 6).tipo, 10);
    assert.equal(layoutRuedas([], null).ruedas.length, 10);
  });
  test('ruedas sin dato se marcan presente:false pero se dibujan', () => {
    const l = layoutRuedas([1, 2], 10);
    assert.equal(l.ruedas.length, 10);
    assert.deepEqual(l.ruedas.filter(r => r.presente).map(r => r.posicion), [1, 2]);
  });
  test('auxilio (99) queda fuera del chasis', () => {
    const l = layoutRuedas([...todas(10), 99], 10);
    assert.equal(l.ruedas.length, 10);
    assert.equal(l.auxilios.length, 1);
    assert.deepEqual([l.auxilios[0].posicion, l.auxilios[0].eje, l.auxilios[0].lado], [99, 0, 'aux']);
    const g = geometriaDiagrama(l);
    assert.ok(g.auxilios[0].y > g.chasis.y + g.chasis.alto, 'el auxilio está por debajo del chasis');
    assert.ok(g.auxilios[0].y + g.auxilios[0].alto <= g.alto);
  });
  test('posiciones extra (17..): ejes adicionales de a 4 y un grupo corto queda simple', () => {
    const l = layoutRuedas([...todas(16), 17, 18, 19, 20, 21, 22], 16);
    assert.equal(l.ejes.length, 7);
    assert.equal(l.ejes[5].dual, true);
    assert.equal(l.ejes[6].dual, false);
    assert.deepEqual(l.ejes[6].ruedas.map(r => r.lado), ['izq', 'der']);
  });
  test('posiciones inválidas o repetidas se ignoran', () => {
    const l = layoutRuedas([1, 1, 0, -3, 100, 'x', 2], 10);
    assert.deepEqual(l.ruedas.filter(r => r.presente).map(r => r.posicion), [1, 2]);
  });
  test('ejeDePosicion', () => {
    assert.deepEqual([1, 2, 3, 6, 7, 10, 11, 14, 15, 16, 17, 20, 21, 99].map(ejeDePosicion), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 0]);
  });
});

describe('geometriaDiagrama', () => {
  for (const tipo of [10, 16]) {
    test(`tipo ${tipo}: ruedas dentro del viewBox y sin solaparse`, () => {
      const g = geometriaDiagrama(layoutRuedas(Array.from({ length: tipo }, (_, i) => i + 1).concat(99), tipo));
      const all = [...g.ruedas, ...g.auxilios];
      assert.equal(all.length, tipo + 1);
      for (const r of all) {
        assert.ok(r.x >= 0 && r.x + r.ancho <= g.ancho, `x fuera: ${r.posicion}`);
        assert.ok(r.y >= 0 && r.y + r.alto <= g.alto, `y fuera: ${r.posicion}`);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const sep = a.x + a.ancho <= b.x || b.x + b.ancho <= a.x || a.y + a.alto <= b.y || b.y + b.alto <= a.y;
        assert.ok(sep, `solape ${a.posicion}/${b.posicion}`);
      }
    });
  }
  test('las ruedas internas no invaden el chasis', () => {
    const g = geometriaDiagrama(layoutRuedas([3, 4, 5, 6], 10));
    for (const r of g.ruedas) {
      const dentro = r.x < g.chasis.x + g.chasis.ancho && r.x + r.ancho > g.chasis.x;
      assert.equal(dentro, false, `rueda ${r.posicion} sobre el chasis`);
    }
  });
});

describe('escala de color', () => {
  const u = { bajo: 8, critico: 5, retiro: 3 };
  test('niveles', () => {
    assert.equal(nivelDesgaste(12, u), 'ok');
    assert.equal(nivelDesgaste(8, u), 'ok');
    assert.equal(nivelDesgaste(7.9, u), 'bajo');
    assert.equal(nivelDesgaste(5, u), 'bajo');
    assert.equal(nivelDesgaste(4.9, u), 'critico');
    assert.equal(nivelDesgaste(3.1, u), 'critico');
    assert.equal(nivelDesgaste(3, u), 'retiro');
    assert.equal(nivelDesgaste(0, u), 'retiro');
    assert.equal(nivelDesgaste(null, u), 'sin_datos');
    assert.equal(nivelDesgaste('', u), 'sin_datos');
  });
  test('>= bajo: verde pleno, siempre el mismo; <= retiro: rojo intenso', () => {
    assert.equal(colorDesgaste(8, u).hex, colorDesgaste(20, u).hex);
    assert.equal(colorDesgaste(3, u).hex, colorDesgaste(0.5, u).hex);
    assert.equal(colorDesgaste(8, u).hex, '#9cbea0');
    assert.equal(colorDesgaste(3, u).hex, '#8c3e46');
  });
  test('tramos: amarillo bajo el umbral bajo, naranja en crítico, rojo cerca del retiro', () => {
    assert.equal(colorDesgaste(7.999, u).hex, '#eed082');
    assert.equal(colorDesgaste(5, u).hex, '#e6a578');
    assert.equal(colorDesgaste(3.0001, u).hex, '#d4766a');
  });
  test('continua dentro de cada tramo (sin saltos) y sin dato = hex null', () => {
    const paso = (a, b) => colorDesgaste(a, u).rgb.reduce((s, c, i) => s + Math.abs(c - colorDesgaste(b, u).rgb[i]), 0);
    assert.ok(paso(6.5, 6.4) < 12);
    assert.ok(paso(4.05, 4.0) < 12);
    assert.equal(colorDesgaste(null, u).hex, null);
  });
  test('respeta umbrales personalizados del cliente', () => {
    const v = { bajo: 10, critico: 6, retiro: 4 };
    assert.equal(nivelDesgaste(9, v), 'bajo');
    assert.equal(nivelDesgaste(9, u), 'ok');
  });
  test('el texto sobre cualquier color de la escala tiene contraste >= 4,5', () => {
    for (let mm = 0; mm <= 14; mm += 0.1) {
      const c = colorDesgaste(mm, u);
      const t = colorTexto(c.rgb) === '#ffffff' ? [255, 255, 255] : [0, 0, 0];
      assert.ok(contraste(c.rgb, t) >= 4.5, `contraste bajo a ${mm} mm: ${contraste(c.rgb, t)}`);
    }
  });
  test('umbralesDe usa la fila de la vista o los de defecto si faltan o son incoherentes', () => {
    assert.deepEqual(umbralesDe({ umbral_bajo_mm: '9.0', umbral_critico_mm: 6, umbral_retiro_mm: 4 }), { bajo: 9, critico: 6, retiro: 4 });
    assert.deepEqual(umbralesDe({}), { bajo: 8, critico: 5, retiro: 3 });
    assert.deepEqual(umbralesDe({ umbral_bajo_mm: 5, umbral_critico_mm: 8, umbral_retiro_mm: 3 }), { bajo: 8, critico: 5, retiro: 3 });
  });
  test('leyenda: 4 tramos con símbolo y texto', () => {
    const l = muestrasLeyenda(u);
    assert.deepEqual(l.map(x => x.clave), ['ok', 'bajo', 'critico', 'retiro']);
    assert.ok(l.every(x => x.simbolo && x.texto && x.hex));
  });
});

describe('desgaste mayor al normal', () => {
  const fila = (vid, pos, tasa, extra = {}) => ({ vehiculo_id: vid, posicion: pos, tasa_mm_semana: tasa, desgaste_irregular: false, diferencia_huellas_mm: 0.5, ...extra });
  test('mediana', () => {
    assert.equal(mediana([3, 1, 2]), 2);
    assert.equal(mediana([4, 1, 2, 3]), 2.5);
    assert.equal(mediana([]), null);
  });
  const flota = [fila(1, 3, 0.5), fila(2, 3, 0.4), fila(3, 3, 0.6), fila(4, 3, 1.2), fila(1, 1, 0.3), fila(2, 1, 0.3), fila(3, 1, 0.35)];
  const ref = referenciaTasas(flota);
  test('tasa > 1,5 x mediana de la misma posición marca el neumático y explica por qué', () => {
    const r = evaluarDesgaste(flota[3], ref); // mediana pos 3 = 0,55 -> 1,2 es 2,2 veces
    assert.equal(r.mayorAlNormal, true);
    assert.equal(r.tasaAlta, true);
    assert.match(r.razon, /1,20 mm por semana/);
    assert.match(r.razon, /posición 3/);
  });
  test('en el límite (exactamente 1,5 x) no marca', () => {
    const f = [fila(1, 5, 1), fila(2, 5, 1), fila(3, 5, 1), fila(4, 5, 1.5)];
    assert.equal(evaluarDesgaste(f[3], referenciaTasas(f)).mayorAlNormal, false);
  });
  test('tasa normal no marca', () => assert.equal(evaluarDesgaste(flota[0], ref).mayorAlNormal, false));
  test('irregular marca aunque la tasa sea normal', () => {
    const r = evaluarDesgaste(fila(1, 1, 0.3, { desgaste_irregular: true, diferencia_huellas_mm: 3.14 }), ref);
    assert.equal(r.mayorAlNormal, true);
    assert.equal(r.irregular, true);
    assert.match(r.razon, /3,1 mm entre sí/);
  });
  test('sin muestra suficiente en la posición compara con el eje; sin eje suficiente no evalúa la tasa', () => {
    const f = [fila(1, 3, 0.4), fila(2, 4, 0.5), fila(3, 5, 0.6), fila(4, 6, 2)];
    const r = evaluarDesgaste(f[3], referenciaTasas(f)); // posición 6 tiene 1 muestra; eje 2 tiene 4 (mediana 0,55)
    assert.equal(r.tasaAlta, true);
    assert.match(r.razon, /el eje 2/);
    const sola = [fila(1, 9, 5)];
    assert.equal(evaluarDesgaste(sola[0], referenciaTasas(sola)).mayorAlNormal, false);
  });
  test('sin tasa (poca historia) o fila nula no marca', () => {
    assert.equal(evaluarDesgaste(fila(1, 3, null), ref).mayorAlNormal, false);
    assert.equal(evaluarDesgaste(null, ref).mayorAlNormal, false);
  });
});

describe('gráfico de desgaste', () => {
  const u = { bajo: 8, critico: 5, retiro: 3 };
  const med = (dias, prom) => ({ created_at: new Date(Date.UTC(2026, 0, 1 + dias)).toISOString(), promedio: prom });
  test('serie ordenada por fecha y sin mediciones vacías', () => {
    const s = serieDesgaste([med(10, 9), med(0, 12), { created_at: 'x', promedio: 5 }, { created_at: med(5).created_at, mm1: null }]);
    assert.deepEqual(s.map(p => p.mm), [12, 9]);
  });
  test('mmMedicion cae al promedio de huellas', () => assert.equal(mmMedicion({ mm1: 10, mm2: 8, mm3: null }), 9));
  test('sin puntos -> null', () => assert.equal(datosGrafico([], u, 0.5), null));
  test('líneas de umbrales ordenadas (bajo arriba) y proyección hacia el retiro', () => {
    const d = datosGrafico(serieDesgaste([med(0, 12), med(28, 10), med(56, 8)]), u, 1);
    const y = Object.fromEntries(d.umbrales.map(x => [x.clave, x.y]));
    assert.ok(y.bajo < y.critico && y.critico < y.retiro);
    assert.ok(d.proyeccion);
    assert.ok(Math.abs(d.proyeccion.y2 - y.retiro) < 0.01, 'la proyección termina en el umbral de retiro');
    assert.equal(d.proyeccion.semanas, 5);
    assert.ok(d.proyeccion.x2 > d.proyeccion.x1);
    assert.ok(d.puntos.every(p => p.x >= 0 && p.x <= d.ancho && p.y >= 0 && p.y <= d.alto));
  });
  test('sin tasa o ya bajo el retiro no hay proyección; un solo punto es válido', () => {
    assert.equal(datosGrafico(serieDesgaste([med(0, 12), med(10, 11)]), u, null).proyeccion, null);
    assert.equal(datosGrafico(serieDesgaste([med(0, 12), med(10, 2)]), u, 1).proyeccion, null);
    const uno = datosGrafico(serieDesgaste([med(0, 12)]), u, 0.5);
    assert.equal(uno.puntos.length, 1);
    assert.ok(Number.isFinite(uno.puntos[0].x));
  });
  test('proyección muy lejana se acota a 52 semanas', () => {
    const d = datosGrafico(serieDesgaste([med(0, 12), med(7, 11.99)]), u, 0.01);
    assert.equal(d.proyeccion.truncada, true);
  });
});
