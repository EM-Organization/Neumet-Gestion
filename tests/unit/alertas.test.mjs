import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoAlerta, etiquetaEstadoAlerta, contarPorEstadoAlerta, filtrarPorEstadoAlerta, sinReconocer, hastaSilencio,
  validarNota, traducirErrorAlerta, CHIP_ESTADO_ALERTA, PRESENTACION_ALERTA, SIMBOLO_REVISAR, presentacionAlerta, conteoRecuadro,
  partesRecuadro, detalleAlerta, tiempoRelativo,
} from '../../assets/js/domain/alertas.js';
import { ESTADOS, BANDERA } from '../../assets/js/domain/estado-desgaste.js';
import { ordenarAlertas } from '../../assets/js/domain/flota.js';

const AHORA = Date.parse('2026-06-10T12:00:00Z');
const al = [
  { alerta_id: 1, estado: 'abierta', silenciada_hasta: null },
  { alerta_id: 2, estado: 'reconocida', silenciada_hasta: null },
  { alerta_id: 3, estado: 'abierta', silenciada_hasta: '2026-06-12T00:00:00Z' },
  { alerta_id: 4, estado: 'reconocida', silenciada_hasta: '2026-06-01T00:00:00Z' }, // silencio vencido
  { alerta_id: 5 },                                                              // sin estado: abierta
];

describe('estado de la alerta', () => {
  test('silenciada solo con silencio vigente; el vencido vuelve a su estado', () => {
    assert.deepEqual(al.map(a => estadoAlerta(a, AHORA)), ['abierta', 'reconocida', 'silenciada', 'reconocida', 'abierta']);
  });
  test('entradas nulas o inválidas: abierta', () => {
    assert.equal(estadoAlerta(null, AHORA), 'abierta');
    assert.equal(estadoAlerta({ silenciada_hasta: 'x' }, AHORA), 'abierta');
  });
  test('cuenta, filtra y sin reconocer', () => {
    assert.deepEqual(contarPorEstadoAlerta(al, AHORA), { abierta: 2, reconocida: 2, silenciada: 1 });
    assert.deepEqual(contarPorEstadoAlerta([], AHORA), { abierta: 0, reconocida: 0, silenciada: 0 });
    assert.deepEqual(filtrarPorEstadoAlerta(al, 'silenciada', AHORA).map(a => a.alerta_id), [3]);
    assert.equal(filtrarPorEstadoAlerta(al, '', AHORA).length, 5);
    assert.equal(sinReconocer(al, AHORA), 2);
  });
  test('etiquetas', () => {
    assert.equal(etiquetaEstadoAlerta('reconocida'), 'Reconocida');
    assert.equal(etiquetaEstadoAlerta('zz'), 'Abierta');
  });
  test('hastaSilencio suma días', () => assert.equal(hastaSilencio(7, AHORA), '2026-06-17T12:00:00.000Z'));
});

describe('validaciones', () => {
  test('nota obligatoria y de hasta 200', () => {
    assert.equal(validarNota('  ').ok, false);
    assert.equal(validarNota(null).ok, false);
    assert.equal(validarNota('x'.repeat(201)).ok, false);
    assert.deepEqual(validarNota(' Retirado '), { ok: true, nota: 'Retirado' });
  });
});

test('errores de la base traducidos sin filtrar el texto crudo', () => {
  assert.equal(traducirErrorAlerta({ code: '42501', message: 'permiso denegado' }), 'Sin permiso para esta alerta');
  assert.match(traducirErrorAlerta({ code: '55000' }), /ya estaba resuelta/);
  assert.match(traducirErrorAlerta({ code: '23514' }), /Datos inválidos/);
  assert.equal(traducirErrorAlerta(new Error('boom')), 'No se pudo completar la operación');
  assert.equal(traducirErrorAlerta(null), 'No se pudo completar la operación');
});

describe('chip de estado de la alerta', () => {
  test('ningún estado va en rojo (reservado a lo crítico) y cada uno trae símbolo propio además del texto', () => {
    const estados = Object.keys(CHIP_ESTADO_ALERTA);
    assert.deepEqual(estados.sort(), ['abierta', 'reconocida', 'silenciada']);
    for (const e of estados) assert.notEqual(CHIP_ESTADO_ALERTA[e][0], 'red', e);
    assert.equal(new Set(estados.map(e => CHIP_ESTADO_ALERTA[e][1])).size, 3, 'símbolos distintos');
    assert.notEqual(CHIP_ESTADO_ALERTA.abierta[0], CHIP_ESTADO_ALERTA.reconocida[0], 'abierta se distingue por color y por símbolo');
    // «▲ N bajos» del detalle del vehículo (desgaste) usa ▲: el estado de una alerta no puede confundirse con él.
    assert.notEqual(CHIP_ESTADO_ALERTA.abierta[1], '▲');
  });
});

describe('presentación de cada tipo', () => {
  test('`limite` es la alerta roja: «Cambiar» con × en rojo; su nombre sale del vocabulario de estados', () => {
    assert.deepEqual([PRESENTACION_ALERTA.limite.accion, PRESENTACION_ALERTA.limite.simbolo, PRESENTACION_ALERTA.limite.color], ['Cambiar', '×', 'red']);
    assert.equal(PRESENTACION_ALERTA.limite.etiqueta, ESTADOS.limite.texto);
  });
  test('los amarillos llevan ◎, color naranja y «Revisar»', () => {
    for (const t of ['direccion_aviso', 'direccion_limite', 'irregular', 'swap', 'km_por_mm']) {
      assert.deepEqual([PRESENTACION_ALERTA[t].simbolo, PRESENTACION_ALERTA[t].color, PRESENTACION_ALERTA[t].accion], [SIMBOLO_REVISAR, 'orange', 'Revisar'], t);
    }
  });
  test('◎ (revisar) no coincide con ningún estado, la bandera ni los chips de alerta; ▲ y ◆ no entran en las alertas', () => {
    // Un símbolo, un significado (docs/14 §3): ◆ es «Mayor desgaste» y ▲ «Poco desgaste»; antes ◆ también era «Revisar».
    assert.equal(SIMBOLO_REVISAR, '◎');
    const usados = [...Object.values(ESTADOS).map(e => e.simbolo), BANDERA.simbolo, ...Object.values(CHIP_ESTADO_ALERTA).map(c => c[1])];
    assert.ok(!usados.includes(SIMBOLO_REVISAR));
    assert.ok(!Object.values(PRESENTACION_ALERTA).some(p => p.simbolo === '▲' || p.simbolo === ESTADOS.mayor.simbolo));
  });
  test('dirección: «Pasar atrás» y «Pasar atrás ya»', () => {
    assert.equal(PRESENTACION_ALERTA.direccion_aviso.etiqueta, 'Pasar atrás');
    assert.equal(PRESENTACION_ALERTA.direccion_limite.etiqueta, 'Pasar atrás ya');
  });
  test('`critico` no es clave de la tabla: la base ya no lo admite (alertas_tipo_ck)', () => {
    assert.equal(PRESENTACION_ALERTA.critico, undefined);
  });
  test('un tipo desconocido se muestra en amarillo como «Revisar», nunca en rojo', () => {
    const p = presentacionAlerta({ tipo: 'critico', mensaje: 'Neumático en desgaste límite' });
    assert.deepEqual([p.etiqueta, p.simbolo, p.color, p.accion], ['Revisar', '◎', 'orange', 'Revisar']);
    assert.equal(presentacionAlerta({ tipo: 'limite' }).color, 'red');
  });
  test('swap: la etiqueta nombra el umbral de la base con formato de miles; sin dato, «Primera rotación» a secas', () => {
    assert.deepEqual(presentacionAlerta({ tipo: 'swap', umbral_km: 30000 }), { etiqueta: 'Primera rotación a 30.000 km', simbolo: '◎', color: 'orange', accion: 'Revisar' });
    assert.equal(presentacionAlerta({ tipo: 'swap', umbral_km: null }).etiqueta, 'Primera rotación');
    assert.equal(presentacionAlerta({ tipo: 'swap', umbral_km: 0 }).etiqueta, 'Primera rotación');
    assert.equal(presentacionAlerta({ tipo: 'swap' }).etiqueta, 'Primera rotación');
  });
  test('detalleAlerta de swap compone los km del tramo desde km_actual, sin el mensaje de la base', () => {
    assert.equal(detalleAlerta({ tipo: 'swap', km_actual: 38000, umbral_km: 20000, mensaje: 'Primera rotación: 38.000 km desde el montaje' }), '38.000 km desde el montaje');
  });
  test('detalleAlerta de swap sin km_actual da cadena vacía: el chip ya dice qué hacer', () => {
    assert.equal(detalleAlerta({ tipo: 'swap', km_actual: null, mensaje: 'Primera rotación: 38.000 km desde el montaje' }), '');
  });
  test('ningún resultado de presentacionAlerta ni de detalleAlerta nombra «swap», en ningún tipo', () => {
    for (const t of Object.keys(PRESENTACION_ALERTA)) {
      const a = { tipo: t, umbral_km: 20000, km_actual: 38000, mensaje: 'Mensaje de la base' };
      assert.doesNotMatch(JSON.stringify(presentacionAlerta(a)), /swap/i, t);
      assert.doesNotMatch(detalleAlerta(a), /swap/i, t);
    }
  });
  test('detalleAlerta quita el prefijo «<etiqueta>:» que trae la base: el chip ya nombra el tipo', () => {
    assert.equal(detalleAlerta({ tipo: 'limite', mensaje: 'Desgaste límite: 2,9 mm' }), '2,9 mm');
  });
  test('detalleAlerta deja igual un mensaje sin prefijo', () => {
    assert.equal(detalleAlerta({ tipo: 'limite', mensaje: '2,9 mm' }), '2,9 mm');
  });
  test('detalleAlerta de un mensaje nulo da cadena vacía', () => {
    assert.equal(detalleAlerta({ tipo: 'limite', mensaje: null }), '');
  });
});

describe('recuadro «cambiar» y «revisar»', () => {
  test('cambiar: tipo limite o color rojo; revisar: el resto, también un tipo desconocido', () => {
    const c = conteoRecuadro([
      { tipo: 'limite', color: 'rojo', estado: 'abierta' },
      { tipo: 'limite', estado: 'reconocida' },
      { tipo: 'direccion_limite', color: 'rojo' },
      { tipo: 'direccion_aviso', color: 'amarillo' },
      { tipo: 'critico', color: 'amarillo' },
      null,
    ], AHORA);
    assert.deepEqual(c, { cambiar: 3, revisar: 2 });
  });
  test('un tipo desconocido con color «rojo» cuenta como cambiar: lo decide el color que manda la base', () => {
    assert.deepEqual(conteoRecuadro([{ tipo: 'critico', color: 'rojo' }], AHORA), { cambiar: 1, revisar: 0 });
  });
  test('las silenciadas no cuentan; el silencio vencido sí', () => {
    assert.deepEqual(conteoRecuadro([
      { tipo: 'swap', silenciada_hasta: '2026-06-12T00:00:00Z' },
      { tipo: 'swap', silenciada_hasta: '2026-06-01T00:00:00Z' },
    ], AHORA), { cambiar: 0, revisar: 1 });
    assert.deepEqual(conteoRecuadro([], AHORA), { cambiar: 0, revisar: 0 });
  });
  test('partesRecuadro: «cambiar» en rojo y «revisar» en amarillo; sin nada que contar, vacío', () => {
    assert.deepEqual(partesRecuadro([], AHORA), []);
    assert.deepEqual(partesRecuadro([{ tipo: 'swap', silenciada_hasta: '2026-06-12T00:00:00Z' }], AHORA), []);
    assert.deepEqual(partesRecuadro([
      { tipo: 'limite', estado: 'abierta' },
      { tipo: 'limite', estado: 'reconocida' },
      { tipo: 'swap', estado: 'abierta' },
      { tipo: 'direccion_aviso', estado: 'abierta' },
      { tipo: 'swap', estado: 'abierta', silenciada_hasta: '2026-06-12T00:00:00Z' },
    ], AHORA), [
      { color: 'red', simbolo: '×', texto: '2 cambiar' },
      { color: 'orange', simbolo: '◎', texto: '2 revisar' },
    ]);
  });
  test('partesRecuadro no muestra las cifras en cero', () => {
    assert.deepEqual(partesRecuadro([{ tipo: 'limite' }, { tipo: 'limite' }], AHORA), [
      { color: 'red', simbolo: '×', texto: '2 cambiar' },
    ]);
    assert.deepEqual(partesRecuadro([{ tipo: 'irregular' }], AHORA), [
      { color: 'orange', simbolo: '◎', texto: '1 revisar' },
    ]);
    assert.deepEqual(partesRecuadro([{ tipo: 'limite' }], AHORA), [
      { color: 'red', simbolo: '×', texto: '1 cambiar' },
    ]);
    assert.deepEqual(partesRecuadro([{ tipo: 'limite' }, { tipo: 'swap' }, { tipo: 'swap' }, { tipo: 'swap' }], AHORA), [
      { color: 'red', simbolo: '×', texto: '1 cambiar' },
      { color: 'orange', simbolo: '◎', texto: '3 revisar' },
    ]);
  });
  test('tiempoRelativo: minutos, horas, días; sin fecha, «–»', () => {
    const hace = ms => new Date(AHORA - ms).toISOString();
    assert.equal(tiempoRelativo(hace(30 * 60000), AHORA), 'hace 30 min');
    assert.equal(tiempoRelativo(hace(26 * 3600000), AHORA), 'hace 1 día');
    assert.equal(tiempoRelativo(hace(3 * 86400000), AHORA), 'hace 3 días');
    assert.equal(tiempoRelativo(null, AHORA), '–');
    assert.equal(tiempoRelativo('no es fecha', AHORA), '–');
  });
});

describe('orden de la lista (ordenarAlertas, sin tocarlo)', () => {
  test('la roja (severidad 3) va antes que las amarillas (severidad 2), aunque estas sean más antiguas', () => {
    const orden = ordenarAlertas([
      { tipo: 'swap', severidad: 2, ultima_medicion_at: '2026-01-01', vehiculo_nombre: 'A', posicion: 1 },
      { tipo: 'direccion_aviso', severidad: 2, ultima_medicion_at: '2026-01-02', vehiculo_nombre: 'A', posicion: 2 },
      { tipo: 'limite', severidad: 3, ultima_medicion_at: '2026-06-01', vehiculo_nombre: 'B', posicion: 1 },
    ]).map(a => a.tipo);
    assert.deepEqual(orden, ['limite', 'swap', 'direccion_aviso']);
  });
});

describe('desgaste lateral (tipo lateral: «Revisar alineación» en la base)', () => {
  test('presentacionAlerta: etiqueta «Desgaste lateral», ◎ y amarillo; nunca rojo', () => {
    assert.deepEqual(presentacionAlerta({ tipo: 'lateral' }), { etiqueta: 'Desgaste lateral', simbolo: '◎', color: 'orange', accion: 'Revisar' });
  });
  test('detalleAlerta quita el prefijo «Revisar alineación:» que trae la base', () => {
    assert.equal(detalleAlerta({ tipo: 'lateral', mensaje: 'Revisar alineación: 2,5 mm entre bordes (umbral 2 mm)' }), '2,5 mm entre bordes (umbral 2 mm)');
  });
  test('detalleAlerta sigue quitando la etiqueta de los demás tipos', () => {
    assert.equal(detalleAlerta({ tipo: 'irregular', mensaje: 'Desgaste irregular: diferencia de 2,5 mm' }), 'diferencia de 2,5 mm');
  });
  test('el lateral cuenta como «revisar» en el recuadro, no como «cambiar»', () => {
    assert.deepEqual(conteoRecuadro([{ tipo: 'lateral', color: 'amarillo', estado: 'abierta' }]), { cambiar: 0, revisar: 1 });
  });
});

