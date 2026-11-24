import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoInicio, resumenNeumaticos, requierenAtencion, proximosCambios, resumenDispositivos, ultimaMedicion,
  clientesConUrgencias, textoSemanas, ultimasMediciones, comparativaDesgaste,
} from '../../assets/js/domain/inicio.js';

// Fila de v_estado_neumaticos con los campos que usa Inicio.
const fila = (vid, pos, estado, extra = {}) => ({
  cliente_id: 1, vehiculo_id: vid, vehiculo_nombre: `Camión ${vid}`, patente: `P${vid}`, posicion: pos, estado,
  mm1: estado === 'desconocido' ? null : 10, mm2: estado === 'desconocido' ? null : 10, mm3: estado === 'desconocido' ? null : 10, promedio: estado === 'desconocido' ? null : 10, sin_medir: false, desgaste_irregular: false, dias_desde_medicion: 2,
  semanas_hasta_critico: null, semanas_hasta_retiro: null, tasa_mm_semana: null, ultima_medicion_at: '2026-06-10T10:00:00Z', ...extra,
});

test('sin vehiculos ni filas: vacio', () => {
  assert.equal(estadoInicio({}), 'vacio');
  assert.equal(estadoInicio({ vehiculosTotal: 0, estadoRows: [], alertas: [], salud: [] }), 'vacio');
});

test('14 vehiculos sin neumaticos medidos: NO es vacio (bug de Inicio)', () => {
  assert.equal(estadoInicio({ vehiculosTotal: 14, estadoRows: [], alertas: [], salud: [] }), 'sin_mediciones');
  assert.equal(estadoInicio({ vehiculosTotal: '14' }), 'sin_mediciones');
});

test('dispositivos o alertas sin vehiculos contados tampoco es vacio', () => {
  assert.equal(estadoInicio({ salud: [{ estado: 'activo' }] }), 'sin_mediciones');
  assert.equal(estadoInicio({ alertas: [{ tipo: 'critico' }] }), 'sin_mediciones');
});

test('con filas de estado: con_datos', () => {
  assert.equal(estadoInicio({ vehiculosTotal: 2, estadoRows: [{ estado: 'nuevo' }] }), 'con_datos');
});

test('resumenNeumaticos: proporciones que suman 100 y casos límite', () => {
  const r = resumenNeumaticos([
    fila(1, 1, 'nuevo'), fila(1, 2, 'nuevo'), fila(1, 3, 'poco_desgaste'),
    fila(2, 1, 'mayor_desgaste'), fila(2, 2, 'desgaste_limite'), fila(2, 3, 'desconocido'),
    fila(3, 1, 'nuevo')
  ]);
  assert.deepEqual([r.total, r.nuevo, r.poco_desgaste, r.mayor_desgaste, r.desgaste_limite, r.desconocido], [7, 3, 1, 1, 1, 1]);
  assert.equal(r.pct.nuevo + r.pct.poco_desgaste + r.pct.mayor_desgaste + r.pct.desgaste_limite + r.pct.desconocido, 100);
  const vacio = resumenNeumaticos([]);
  assert.equal(vacio.total, 0);
  assert.deepEqual(vacio.pct, { nuevo: 0, poco_desgaste: 0, mayor_desgaste: 0, desgaste_limite: 0, desconocido: 0 });
  assert.deepEqual(resumenNeumaticos(null).pct, { nuevo: 0, poco_desgaste: 0, mayor_desgaste: 0, desgaste_limite: 0, desconocido: 0 });
  const todoOk = resumenNeumaticos([fila(1, 1, 'nuevo'), fila(1, 2, 'nuevo'), fila(1, 3, 'nuevo')]);
  assert.equal(todoOk.pct.nuevo, 100);
  const tercios = resumenNeumaticos([fila(1, 1, 'nuevo'), fila(1, 2, 'poco_desgaste'), fila(1, 3, 'mayor_desgaste')]);
  assert.equal(tercios.pct.nuevo + tercios.pct.poco_desgaste + tercios.pct.mayor_desgaste, 100);
  assert.equal(resumenNeumaticos([fila(1, 1, 'raro')]).desconocido, 1);
});

test('textoSemanas', () => {
  assert.equal(textoSemanas(0.4), 'menos de 1 semana');
  assert.equal(textoSemanas(1), '~1 semana');
  assert.equal(textoSemanas(5.6), '~6 semanas');
  assert.equal(textoSemanas(null), '');
});

test('requierenAtencion: flota vacía o todo en orden no devuelve nada', () => {
  assert.deepEqual(requierenAtencion([]), { items: [], total: 0 });
  assert.deepEqual(requierenAtencion(null), { items: [], total: 0 });
  assert.equal(requierenAtencion([fila(1, 1, 'nuevo'), fila(1, 2, 'nuevo'), fila(2, 1, 'nuevo')]).total, 0);
});

test('requierenAtencion: sin mediciones en toda la flota es "sin medir", no límite', () => {
  const r = requierenAtencion([fila(1, 1, 'desconocido', { sin_medir: true, dias_desde_medicion: null, ultima_medicion_at: null })]);
  assert.equal(r.items[0].nivel, 'sin_medir');
  assert.equal(r.items[0].causa, 'Sin mediciones registradas');
});

test('requierenAtencion: orden por urgencia y una frase de causa por vehículo', () => {
  const rows = [
    fila(1, 1, 'nuevo', { sin_medir: true, dias_desde_medicion: 19 }),                       // sin medir
    fila(2, 1, 'nuevo', { semanas_hasta_retiro: 2.4 }),                                      // cruza pronto
    fila(3, 1, 'desgaste_limite', { mm1: 3, mm2: 3, mm3: 3 }), fila(3, 2, 'desgaste_limite', { mm1: 4, mm2: 4, mm3: 4 }),        // 2 límite
    fila(4, 1, 'desgaste_limite', { mm1: 2, mm2: 2, mm3: 2 }),                                                // 1 límite
    fila(5, 1, 'mayor_desgaste'),                                                                    // mayor desgaste
    fila(6, 1, 'nuevo', { desgaste_irregular: true }),                                        // desgaste acelerado
    fila(7, 1, 'nuevo'),
  ];
  const r = requierenAtencion(rows, { max: 10 });
  assert.deepEqual(r.items.map(v => v.vehiculo_id), [3, 4, 2, 5, 6, 1]);
  assert.equal(r.total, 6);
  assert.equal(r.items[0].causa, '2 neumáticos en desgaste límite');
  assert.equal(r.items[1].causa, '1 neumático en desgaste límite');
  assert.equal(r.items[2].causa, 'Cruza el desgaste límite en ~2 semanas');
  assert.equal(r.items[3].causa, '1 neumático con mayor desgaste');
  assert.equal(r.items[4].causa, 'Desgaste acelerado');
  assert.equal(r.items[5].causa, 'Sin medir hace 19 días');
  // Las posiciones van aparte (la vista las dibuja en el mini vehículo): nunca en el texto como «P1».
  assert.deepEqual(r.items.map(v => v.posiciones), [[1, 2], [1], [1], [1], [1], [1]]);
  assert.ok(r.items.every(v => !/\bP\d/.test(v.causa)));
});

test('requierenAtencion: respeta el máximo y devuelve el total real; un solo vehículo funciona', () => {
  const muchos = Array.from({ length: 20 }, (_, i) => fila(i + 1, 1, 'desgaste_limite'));
  const r = requierenAtencion(muchos, { max: 6 });
  assert.equal(r.items.length, 6);
  assert.equal(r.total, 20);
  const uno = requierenAtencion([fila(9, 1, 'desgaste_limite')]);
  assert.equal(uno.items.length, 1);
});

test('requierenAtencion: cruza más allá de 4 semanas no cuenta; el límite no se mezcla con cruza', () => {
  assert.equal(requierenAtencion([fila(1, 1, 'nuevo', { semanas_hasta_retiro: 9 })]).total, 0);
  const r = requierenAtencion([fila(1, 1, 'desgaste_limite', { semanas_hasta_retiro: 0 }), fila(1, 2, 'nuevo', { semanas_hasta_retiro: 1 })]);
  assert.equal(r.items[0].nivel, 'limite');
});

test('proximosCambios: solo neumáticos aún no en límite dentro del horizonte, el más cercano primero', () => {
  const rows = [
    fila(1, 1, 'nuevo', { semanas_hasta_retiro: 9 }), fila(1, 2, 'mayor_desgaste', { semanas_hasta_retiro: 3.2 }),
    fila(2, 1, 'desgaste_limite', { semanas_hasta_retiro: 0 }), fila(3, 1, 'nuevo', { semanas_hasta_retiro: 30 }),
    fila(4, 1, 'nuevo'), fila(5, 1, 'nuevo', { semanas_hasta_retiro: 0.5 }),
  ];
  const r = proximosCambios(rows);
  assert.deepEqual(r.items.map(x => [x.vehiculo_id, x.posicion]), [[5, 1], [1, 2], [1, 1]]);
  assert.equal(r.total, 3);
  assert.deepEqual(proximosCambios([]), { items: [], total: 0 });
  assert.equal(proximosCambios(rows, { max: 1 }).items.length, 1);
  assert.equal(proximosCambios(rows, { max: 1 }).total, 3);
});

test('resumenDispositivos y ultimaMedicion', () => {
  assert.deepEqual(resumenDispositivos([]), { total: 0, activos: 0, inactivos: 0 });
  assert.deepEqual(resumenDispositivos([{ estado: 'activo' }, { estado: 'caido' }, { estado: 'nunca' }]), { total: 3, activos: 1, inactivos: 2 });
  assert.equal(ultimaMedicion([]), null);
  assert.equal(ultimaMedicion([fila(1, 1, 'nuevo', { ultima_medicion_at: null }), fila(1, 2, 'nuevo', { ultima_medicion_at: '2026-06-12T00:00:00Z' }), fila(1, 3, 'nuevo')]), '2026-06-12T00:00:00Z');
});

test('clientesConUrgencias: solo con urgencias, más urgencias primero, acotado', () => {
  const res = [
    { cliente_id: 1, nombre: 'A', n_critico: 0, n_alertas_sev3: 0 },
    { cliente_id: 2, nombre: 'B', n_critico: 1, n_alertas_sev3: 1 },
    { cliente_id: 3, nombre: 'C', n_critico: 5, n_alertas_sev3: 4 },
  ];
  assert.deepEqual(clientesConUrgencias(res).map(c => c.cliente_id), [3, 2]);
  assert.equal(clientesConUrgencias(res, 1).length, 1);
  assert.deepEqual(clientesConUrgencias([]), []);
  assert.deepEqual(clientesConUrgencias(null), []);
});

// ---- Últimas mediciones ----
const um = (vid, pos, ahora, antes, extra = {}) => ({
  vehiculo_id: vid, nombre: `Camión ${vid}`, patente: `P${vid}`, numero: String(100 + vid), medido_at: '2026-06-10T10:00:00Z',
  posicion: pos, idneumatico: `N-${vid}-${pos}`, mm_ahora: ahora, mm_antes: antes, antes_at: antes === null ? null : '2026-06-03T10:00:00Z', ...extra,
});

test('comparativa: sin medición previa no hay comparativa (null, undefined, vacío)', () => {
  assert.equal(comparativaDesgaste(9, null), null);
  assert.equal(comparativaDesgaste(9, undefined), null);
  assert.equal(comparativaDesgaste(9, ''), null);
  assert.equal(comparativaDesgaste(null, 9), null);
  assert.equal(comparativaDesgaste('x', 9), null);
});

test('comparativa: diferencia y nivel (normal, alto, lectura mayor)', () => {
  assert.deepEqual(comparativaDesgaste(8.6, 9), { antes: 9, ahora: 8.6, dif: -0.4, nivel: 'normal' });
  assert.equal(comparativaDesgaste('8.60', '9.00').dif, -0.4);   // PostgREST puede devolver numeric como texto
  assert.equal(comparativaDesgaste(8, 9).nivel, 'normal');       // exactamente 1 mm: no se destaca
  assert.equal(comparativaDesgaste(7.9, 9).nivel, 'alto');
  assert.equal(comparativaDesgaste(9, 9).dif, 0);
  assert.equal(comparativaDesgaste(9.3, 9).nivel, 'normal');     // +0,3 es ruido de lectura
  assert.equal(comparativaDesgaste(9.4, 9).nivel, 'sube');
  assert.equal(comparativaDesgaste(0.1 + 0.2, 0.3).dif, 0);      // sin errores de coma flotante
});

test('ultimasMediciones: vacío o null', () => {
  assert.deepEqual(ultimasMediciones([]), []);
  assert.deepEqual(ultimasMediciones(null), []);
  assert.deepEqual(ultimasMediciones(undefined), []);
});

test('ultimasMediciones: agrupa por vehículo, conserva el orden y ordena las posiciones', () => {
  const r = ultimasMediciones([um(2, 3, 9, 9.5), um(2, 1, 10, 10.4), um(1, 1, 7, null), um(2, 2, 11, null)]);
  assert.deepEqual(r.map(v => v.vehiculo_id), [2, 1]);
  assert.deepEqual(r[0].neumaticos.map(n => n.posicion), [1, 2, 3]);
  assert.deepEqual(r[0], {
    vehiculo_id: 2, nombre: 'Camión 2', patente: 'P2', numero: '102', medido_at: '2026-06-10T10:00:00Z',
    neumaticos: r[0].neumaticos,
  });
});

test('ultimasMediciones: neumático sin medición previa conserva los mm y no tiene comparativa', () => {
  const [v] = ultimasMediciones([um(1, 1, 15.5, null), um(1, 2, 12, 12.5)]);
  assert.equal(v.neumaticos[0].comparativa, null);
  assert.equal(v.neumaticos[0].mm, 15.5);
  assert.equal(v.neumaticos[1].comparativa.dif, -0.5);
});

test('ultimasMediciones: acota a 8 vehículos por defecto y respeta max', () => {
  const rows = Array.from({ length: 12 }, (_, i) => um(i + 1, 1, 9, 9.2));
  assert.equal(ultimasMediciones(rows).length, 8);
  assert.equal(ultimasMediciones(rows, { max: 3 }).length, 3);
  // las filas de un vehículo ya aceptado no se pierden aunque lleguen después del corte
  const mezcladas = [...rows.slice(0, 8), um(1, 2, 9, 9.1)];
  assert.equal(ultimasMediciones(mezcladas)[0].neumaticos.length, 2);
});

test('ultimasMediciones: un solo vehículo con un solo neumático y campos faltantes', () => {
  const [v] = ultimasMediciones([{ vehiculo_id: 5, posicion: 4, mm_ahora: 6, mm_antes: null }]);
  assert.equal(v.nombre, '');
  assert.equal(v.patente, '');
  assert.equal(v.numero, '');
  assert.equal(v.neumaticos.length, 1);
});
