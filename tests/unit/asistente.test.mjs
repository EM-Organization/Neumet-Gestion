// Tests de domain/asistente.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  recortarHistorial, periodosCerrados, reportesVisibles, preguntaReporte, mensajeError, normalizarRespuesta,
  textoFuente, tablaACsv, turnosCompletados, textoRespuesta, PREGUNTA_ALERTAS,
} from '../../assets/js/domain/asistente.js';

const turno = (i, texto = `t${i}`) => ({ rol: i % 2 ? 'asistente' : 'usuario', texto });

describe('recortarHistorial (10 turnos y 16 KB)', () => {
  test('12 turnos: quedan los últimos 10, en orden', () => {
    const turnos = Array.from({ length: 12 }, (_, i) => turno(i + 1));
    assert.deepEqual(recortarHistorial(turnos).map(t => t.texto), ['t3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12']);
  });
  test('3 turnos de 7000 bytes: quedan los 2 más recientes', () => {
    const grande = 'a'.repeat(7000);
    const turnos = [turno(1, grande), turno(2, grande), turno(3, grande)];
    const salida = recortarHistorial(turnos);
    assert.equal(salida.length, 2);
    assert.deepEqual(salida.map(t => t.rol), [turnos[1].rol, turnos[2].rol]);
  });
  test('un solo turno de 20 000 bytes no entra: lista vacía', () => {
    assert.deepEqual(recortarHistorial([turno(1, 'b'.repeat(20000))]), []);
  });
  test('sin turnos: lista vacía', () => assert.deepEqual(recortarHistorial([]), []));
  test('solo guarda rol y texto', () => {
    assert.deepEqual(recortarHistorial([{ rol: 'usuario', texto: 'hola', extra: 1 }]), [{ rol: 'usuario', texto: 'hola' }]);
  });
});

describe('periodosCerrados', () => {
  test('2026-01-15: último mes 2025-12 y trimestre 2025-T4', () => {
    assert.deepEqual(periodosCerrados('2026-01-15'), { mes: '2025-12', trimestre: '2025-T4' });
  });
  test('2026-04-01: último mes 2026-03 y trimestre 2026-T1', () => {
    assert.deepEqual(periodosCerrados('2026-04-01'), { mes: '2026-03', trimestre: '2026-T1' });
  });
  test('2026-03-31: último mes 2026-02 y trimestre 2025-T4', () => {
    assert.deepEqual(periodosCerrados('2026-03-31'), { mes: '2026-02', trimestre: '2025-T4' });
  });
});

describe('reportes listos', () => {
  test('sin costos o con costos: solo «alertas» (los de la ola 7 no están disponibles)', () => {
    assert.deepEqual(reportesVisibles(true), ['alertas']);
    assert.deepEqual(reportesVisibles(false), ['alertas']);
  });
  test('la pregunta de alertas es la fija de docs/24', () => {
    assert.equal(preguntaReporte('alertas', '2026-06-15'), PREGUNTA_ALERTAS);
    assert.equal(PREGUNTA_ALERTAS, 'Alertas activas de la flota agrupadas por tipo y severidad, con los vehículos afectados. Usar alertas_activas.');
  });
  test('mensual y trimestral usan el último período cerrado', () => {
    assert.match(preguntaReporte('mensual', '2026-04-01'), /2026-03/);
    assert.match(preguntaReporte('trimestral', '2026-04-01'), /2026-T1/);
  });
  test('id desconocido: sin pregunta', () => assert.equal(preguntaReporte('nada', '2026-04-01'), null));
});

describe('mensajeError', () => {
  test('429: límite diario, sin reintentar', () => {
    assert.deepEqual(mensajeError(429), { texto: 'Se alcanzó el límite de 30 preguntas por día. Volver a intentar mañana.', reintentar: false });
  });
  test('503: no disponible, sin reintentar', () => {
    assert.deepEqual(mensajeError(503), { texto: 'El asistente no está disponible en este momento.', reintentar: false });
  });
  test('403: sin acceso, sin reintentar', () => {
    assert.deepEqual(mensajeError(403), { texto: 'Este perfil no tiene acceso al asistente.', reintentar: false });
  });
  test('401: sesión vencida, sin reintentar', () => {
    assert.deepEqual(mensajeError(401), { texto: 'La sesión venció. Volver a iniciar sesión.', reintentar: false });
  });
  test('400 con cliente_requerido: elegir cliente, sin reintentar', () => {
    assert.deepEqual(mensajeError(400, 'cliente_requerido'), { texto: 'Elegir un cliente.', reintentar: false });
  });
  test('400 pregunta_invalida, 500, 502, 504 y red (0): texto genérico que permite reintentar', () => {
    for (const [status, codigo] of [[400, 'pregunta_invalida'], [500], [502], [504], [0]]) {
      assert.deepEqual(mensajeError(status, codigo), { texto: 'No se pudo generar la respuesta.', reintentar: true }, `status ${status}`);
    }
  });
});

describe('normalizarRespuesta (forma del contrato C2)', () => {
  test('descarta bloques de tipo desconocido y pasa celdas a texto', () => {
    const r = normalizarRespuesta({ ok: true, bloques: [{ tipo: 'imagen', src: 'x' }, { tipo: 'tabla', columnas: ['A'], filas: [[5], [null]] }], fuentes: [], modelo: 'm' });
    assert.deepEqual(r.bloques, [{ tipo: 'tabla', columnas: ['A'], filas: [['5'], ['']] }]);
  });
  test('párrafos con texto; un párrafo sin texto se descarta', () => {
    const r = normalizarRespuesta({ ok: true, bloques: [{ tipo: 'parrafo', texto: 'Hola' }, { tipo: 'parrafo', texto: 7 }], fuentes: [] });
    assert.deepEqual(r.bloques, [{ tipo: 'parrafo', texto: 'Hola' }]);
  });
  test('tope de 20 bloques, 12 columnas y 200 filas', () => {
    const parrafos = Array.from({ length: 25 }, () => ({ tipo: 'parrafo', texto: 'x' }));
    assert.equal(normalizarRespuesta({ bloques: parrafos }).bloques.length, 20);
    const ancha = { tipo: 'tabla', columnas: Array.from({ length: 15 }, (_, i) => 'c' + i), filas: [Array.from({ length: 15 }, () => 1)] };
    const r = normalizarRespuesta({ bloques: [ancha] });
    assert.equal(r.bloques[0].columnas.length, 12);
    assert.equal(r.bloques[0].filas[0].length, 12);
    const larga = { tipo: 'tabla', columnas: ['A'], filas: Array.from({ length: 250 }, () => [1]) };
    assert.equal(normalizarRespuesta({ bloques: [larga] }).bloques[0].filas.length, 200);
  });
  test('sin bloques o nulo: null (forma inválida)', () => {
    assert.equal(normalizarRespuesta(null), null);
    assert.equal(normalizarRespuesta({ ok: true }), null);
    assert.equal(normalizarRespuesta({ bloques: 'texto' }), null);
  });
  test('fuentes y cuota con valores por defecto', () => {
    const r = normalizarRespuesta({ bloques: [], fuentes: [{ tool: 'cpk_por_grupo', filas: '3', recortado: 1 }], cuota: { usadas: 2, limite: 30 } });
    assert.deepEqual(r.fuentes, [{ tool: 'cpk_por_grupo', desde: null, hasta: null, filas: 3, recortado: false }]);
    assert.deepEqual(r.cuota, { usadas: 2, limite: 30 });
  });
});

describe('tablaACsv (mismo escape que los CSV del panel)', () => {
  test('celdas con «=», separador, comillas y BOM', () => {
    assert.equal(
      tablaACsv(['A', 'B'], [['1', '=cmd'], ['x;y', '"q"']]),
      '﻿A,B\r\n1,\'=cmd\r\nx;y,"""q"""\r\n',
    );
  });
  test('una celda con coma se entrecomilla', () => {
    assert.equal(tablaACsv(['A'], [['uno, dos']]), '﻿A\r\n"uno, dos"\r\n');
  });
});

describe('textoFuente', () => {
  test('con período', () => {
    assert.equal(
      textoFuente({ tool: 'cpk_por_grupo', desde: '2026-07-01', hasta: '2026-09-30', filas: 42, recortado: false }),
      'Datos de costo por km, 2026-07-01 a 2026-09-30, 42 filas',
    );
  });
  test('sin período', () => {
    assert.equal(textoFuente({ tool: 'cpk_por_grupo', desde: null, hasta: null, filas: 42, recortado: false }), 'Datos de costo por km, 42 filas');
  });
  test('recortado', () => {
    assert.equal(textoFuente({ tool: 'cpk_por_grupo', desde: null, hasta: null, filas: 42, recortado: true }), 'Datos de costo por km, 42 filas, resultado recortado');
  });
  test('una sola fila y una tool desconocida se muestran tal cual', () => {
    assert.equal(textoFuente({ tool: 'otra_tool', desde: null, hasta: null, filas: 1, recortado: false }), 'Datos de otra_tool, 1 fila');
  });
});

describe('historial que se envía', () => {
  test('una pregunta sin respuesta no entra; la respuesta se pasa a texto', () => {
    const conversacion = [
      { pregunta: 'uno', respuesta: { bloques: [{ tipo: 'parrafo', texto: 'Respuesta uno' }] }, fallida: false },
      { pregunta: 'dos', respuesta: null, fallida: true },
    ];
    assert.deepEqual(turnosCompletados(conversacion), [
      { rol: 'usuario', texto: 'uno' },
      { rol: 'asistente', texto: 'Respuesta uno' },
    ]);
  });
  test('una tabla se pasa como líneas separadas por « | »', () => {
    assert.equal(textoRespuesta([{ tipo: 'tabla', columnas: ['Marca', 'CPK'], filas: [['Michelin', '0.10']] }]), 'Marca | CPK\nMichelin | 0.10');
  });
});
