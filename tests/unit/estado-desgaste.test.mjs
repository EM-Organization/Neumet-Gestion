// Estado de desgaste del detalle de vehículo (docs/21 §4): una sola función decide el estado de neumático, chip, panel y gráfico.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  wearStatus, umbralesEstado, truncar1, fmtMedida, contarEstados, contarEstadosFilas, estadoVehiculo, estadoContable, banderaDeFila, rangoEstado, rangoLargo, ejeY, bandasGrafico, estadoDeBase, ESTADOS, etiquetaChip,
  etiquetaDireccion, leyendaDireccion,
} from '../../assets/js/domain/estado-desgaste.js';
import { datosGrafico, serieDesgaste, fechaEje, tooltipPunto } from '../../assets/js/domain/grafico-desgaste.js';
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
  test('decide con el valor CRUDO y muestra TRUNCADO a un decimal (decisión del dueño, TODO-STATUS-MEASURE)', () => {
    assert.equal(wearStatus(7.97, th), 'poco');
    assert.equal(wearStatus(7.96, th), 'poco');
    assert.equal(wearStatus(4.97, th), 'mayor');
    assert.equal(wearStatus(2.97, th), 'limite');
    assert.equal(fmtMedida(7.96), '7,9');
    assert.equal(fmtMedida(7.97), '7,9');
    assert.equal(fmtMedida(2.97), '2,9');
    assert.equal(fmtMedida(8), '8,0');
    assert.equal(fmtMedida(2.3), '2,3', 'sin error de coma flotante (2,3*10 = 22,999…)');
    assert.equal(fmtMedida(null), '—');
    assert.equal(truncar1(7.96), 7.9);
  });
  test('lo que se ve coincide con lo que se decide: ningún valor muestra un número de otro estado', () => {
    for (let c = 0; c <= 1600; c++) {
      const v = c / 100, mostrado = Number(fmtMedida(v).replace(',', '.'));
      assert.ok(mostrado <= v + 1e-9, `${v} muestra ${mostrado}`);
      // Mostrar «8,0» implica ser «bueno»; mostrar menos de 8 implica no serlo.
      assert.equal(mostrado >= 8, wearStatus(v, th) === 'bueno', `${v} -> ${fmtMedida(v)}`);
    }
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

describe('auxilio y bandera (regla PR 140)', () => {
  // Fila de v_estado_neumaticos con las tres huellas iguales (su mínimo es el valor dado).
  const f = (posicion, promedio, extra) => ({ posicion, mm1: promedio, mm2: promedio, mm3: promedio, promedio, ...extra });
  const filas = [f(1, 10), f(2, 9), f(3, 12), f(99, 2.0)];
  test('estadoContable: el auxilio en mayor/límite cuenta como poco; el resto, su estado real', () => {
    assert.equal(estadoContable(f(99, 2.0), th), 'poco');
    assert.equal(estadoContable(f(99, 4.0), th), 'poco');
    assert.equal(estadoContable(f(99, 10), th), 'bueno');
    assert.equal(estadoContable(f(99, null), th), 'sinDatos');
    assert.equal(estadoContable(f(3, 2.0), th), 'limite');
  });
  test('auxilio en 2,0 mm y el resto bueno: ni chips ni cabecera marcan límite; el total lo incluye', () => {
    const n = contarEstadosFilas(filas, th);
    assert.deepEqual(n, { total: 4, bueno: 3, poco: 1, mayor: 0, limite: 0, sinDatos: 0 });
    assert.equal(estadoVehiculo(filas, th), 'poco', 'sin auxilio sería límite, con el auxilio como poco queda poco');
    assert.equal(estadoVehiculo(filas.slice(0, 3), th), 'bueno');
  });
  test('chips y cabecera coherentes: el peor estado de la cabecera es el peor estado con chip', () => {
    const casos = [filas, [f(1, 2.5), f(99, 2)], [f(1, 4), f(99, 2)], [f(99, 2)], [f(1, null), f(99, 2)], []];
    for (const fs of casos) {
      const n = contarEstadosFilas(fs, th);
      const peorChip = ['limite', 'mayor', 'poco', 'bueno'].find(id => n[id] > 0) || 'sinDatos';
      assert.equal(estadoVehiculo(fs, th), peorChip);
    }
  });
  test('un neumático normal en límite sí marca límite en chip y cabecera', () => {
    const fs = [f(1, 2.0), f(99, 2.0)];
    assert.equal(contarEstadosFilas(fs, th).limite, 1);
    assert.equal(estadoVehiculo(fs, th), 'limite');
  });
  test('«Desgaste acelerado»: una sola regla (el auxilio nunca la lleva)', () => {
    const irregular = { desgaste_irregular: true, diferencia_huellas_mm: 3 };
    assert.equal(banderaDeFila(f(3, 6, irregular), null).mayorAlNormal, true);
    assert.equal(banderaDeFila(f(99, 6, irregular), null).mayorAlNormal, false);
    assert.equal(banderaDeFila(f(99, 6, irregular), null).irregular, true, 'el detalle del indicador se conserva');
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
  test('tooltip del punto: fecha, interna, centro, externa, promedio y estado (§5.4), truncado a un decimal', () => {
    const d = datosGrafico(serieDesgaste([{ created_at: '2026-11-20T15:00:00Z', mm1: 8.2, mm2: 7.97, mm3: 7.7, promedio: 7.97 }]), th, { ancho: 400 });
    const t = tooltipPunto(d.puntos[0]);
    assert.match(t, /^20\/11\/2026|^\d{1,2}[/ -]/);
    assert.match(t, /Interna 8,2 · Centro 7,9 · Externa 7,7 · Mínimo 7,7 mm \(decide el estado\) · Promedio 7,9 mm \(informativo\) · Poco desgaste$/);
  });
  test('serieDesgaste conserva las tres huellas y descarta mediciones sin dato', () => {
    const s = serieDesgaste([{ created_at: '2026-11-20T10:00:00Z', mm1: 5, mm2: 6, mm3: 7 }, { created_at: '2026-11-21T10:00:00Z' }]);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].mm1, s[0].mm2, s[0].mm3, s[0].mm], [5, 6, 7, 5]); // el punto del gráfico es la huella mínima
  });
  test('fecha del eje: «20 nov» y año si cruza', () => {
    const t = new Date(2026, 10, 20).getTime();
    assert.equal(fechaEje(t), '20 nov');
    assert.equal(fechaEje(t, true), '20 nov 26');
    const d = datosGrafico(serieDesgaste([med(-400, 9), med(0, 8)]), th, { ancho: 400 });
    assert.match(d.ejeX[0].texto, /\d{2}$/);
  });
  test('U3: ningún punto queda bajo un rótulo de banda, a ningún ancho, aunque la serie termine dentro de la banda rotulada', () => {
    const series = [[med(-56, 12), med(-28, 9), med(0, 4)], [med(-28, 6.5), med(0, 3.8)], [med(0, 4)], [med(-56, 4), med(-28, 4.2), med(0, 4.1)]];
    let movidos = 0;
    for (const ancho of [320, 390, 600, 1024, 1440]) for (const serie of series) {
      const d = datosGrafico(serieDesgaste(serie), th, { ancho });
      for (const b of d.bandas.filter(x => x.rotuloVisible)) {
        const x = b.rotuloAncla === 'end' ? b.rotuloX - b.rotuloAncho : b.rotuloX;
        if (b.rotuloAncla === 'start') movidos++;
        for (const p of d.puntos) {
          const r = p.ultimo ? TOKENS.chart.lastPointRadiusPx : TOKENS.chart.pointRadiusPx;
          const bajo = p.x + r > x && p.x - r < x + b.rotuloAncho && p.y + r > b.rotuloY - b.rotuloAlto / 2 && p.y - r < b.rotuloY + b.rotuloAlto / 2;
          assert.equal(bajo, false, `ancho ${ancho}: el punto (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) queda bajo «${b.rotulo}»`);
        }
        assert.ok(b.rotuloY - b.rotuloAlto / 2 >= b.y - 0.01 && b.rotuloY + b.rotuloAlto / 2 <= b.y + b.alto + 0.01, 'el rótulo cabe en su banda');
      }
    }
    assert.ok(movidos > 0, 'al menos un caso obligó a mover el rótulo a la izquierda (si no, la prueba no ejercita la colisión)');
  });
});

describe('dirección (RN-02, P-02): la base decide, la vista traduce', () => {
  test('estado_direccion de la base: «direccion_aviso» da «Pasar atrás»; «direccion_limite», «Pasar atrás ya»', () => {
    assert.equal(etiquetaDireccion({ estado_direccion: 'direccion_aviso' }), 'Pasar atrás');
    assert.equal(etiquetaDireccion({ estado_direccion: 'direccion_limite' }), 'Pasar atrás ya');
  });
  test('tracción (estado_direccion null), valor desconocido o sin fila: sin etiqueta', () => {
    assert.equal(etiquetaDireccion({ rol_eje: 'traccion', estado_direccion: null }), null);
    assert.equal(etiquetaDireccion({ estado_direccion: 'valor_nuevo' }), null);
    assert.equal(etiquetaDireccion(null), null);
  });
  test('no recalcula con umbrales: una medida bajo el umbral no basta sin el estado de la base', () => {
    assert.equal(etiquetaDireccion({ mm1: 5, mm2: 5, mm3: 5, direccion_aviso_mm: 8, direccion_limite_mm: 6, estado_direccion: null }), null);
  });
});

describe('leyenda de dirección', () => {
  test('sin filas de dirección, solo cómo se decide el estado', () => {
    assert.equal(leyendaDireccion([]), 'Estado por la huella mínima de las tres.');
    assert.equal(leyendaDireccion([{ mm1: 5, mm2: 5, mm3: 5 }]), 'Estado por la huella mínima de las tres.');
  });
  test('solo el eje de dirección nombra umbrales: la tracción, aunque traiga cifras, no cuenta', () => {
    assert.equal(leyendaDireccion([{ rol_eje: 'traccion', direccion_aviso_mm: 8, direccion_limite_mm: 6 }]),
      'Estado por la huella mínima de las tres.');
    assert.equal(leyendaDireccion([{ rol_eje: 'direccion', direccion_aviso_mm: 8, direccion_limite_mm: 6 }, { rol_eje: 'traccion', direccion_aviso_mm: 9, direccion_limite_mm: 7 }]),
      'Estado por la huella mínima de las tres. En dirección: Pasar atrás con 8 mm o menos; Pasar atrás ya bajo 6 mm.');
  });
  test('un par de umbrales: se nombran con coma decimal', () => {
    assert.equal(leyendaDireccion([{ rol_eje: 'direccion', direccion_aviso_mm: 8, direccion_limite_mm: 6 }]),
      'Estado por la huella mínima de las tres. En dirección: Pasar atrás con 8 mm o menos; Pasar atrás ya bajo 6 mm.');
    assert.equal(leyendaDireccion([{ rol_eje: 'direccion', direccion_aviso_mm: 7.5, direccion_limite_mm: 5 }, { rol_eje: 'direccion', direccion_aviso_mm: 7.5, direccion_limite_mm: 5 }]),
      'Estado por la huella mínima de las tres. En dirección: Pasar atrás con 7,5 mm o menos; Pasar atrás ya bajo 5 mm.');
  });
  test('varias empresas con umbrales distintos: sin cifras', () => {
    assert.equal(leyendaDireccion([{ rol_eje: 'direccion', direccion_aviso_mm: 8, direccion_limite_mm: 6 }, { rol_eje: 'direccion', direccion_aviso_mm: 7.5, direccion_limite_mm: 5 }]),
      'Estado por la huella mínima de las tres. En dirección: Pasar atrás y Pasar atrás ya según los umbrales de cada empresa.');
  });
});
