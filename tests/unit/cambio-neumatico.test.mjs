import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCambio, traducirErrorCambio, stockDisponible, validarRotacion, DESTINOS } from '../../assets/js/domain/cambio-neumatico.js';

const neum = { id: 5, vehiculo_id: 10, posicion: 3, marca: 'Michelin', modelo: 'X', estado: 'montado', vida: 0 };
const stock = [{ id: 1, marca: 'Pirelli', modelo: 'FR', cantidad: 2 }, { id: 2, marca: 'Vacio', cantidad: 0 }];
const base = { neum, destino: 'baja', motivo: 'Desgaste', origen: 'stock', stockId: '1', stock, odometro: '', odometroActual: 1000, kmPrevios: '0', numeroQuema: '' };

test('stockDisponible descarta lotes sin unidades', () => {
  assert.deepEqual(stockDisponible(stock).map(s => s.id), [1]);
  assert.deepEqual(stockDisponible(null), []);
});

test('validarCambio: del stock arma los parámetros de la RPC', () => {
  const r = validarCambio(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 10, p_posicion: 3, p_destino_viejo: 'baja', p_motivo: 'Desgaste',
    p_odometro_km: null, p_stock_id: 1, p_nuevo: null, p_numero_quema: null, p_km_previos: 0 });
  assert.match(r.resumen, /P3: sale Michelin X/);
});

test('validarCambio: neumático nuevo ingresado y odómetro', () => {
  const r = validarCambio({ ...base, origen: 'nuevo', marca: ' Goodyear ', modelo: '', codigo: 'AB-1', odometro: '1500' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params.p_nuevo, { marca: 'Goodyear', codigo: 'AB-1' });
  assert.equal(r.params.p_stock_id, null);
  assert.equal(r.params.p_odometro_km, 1500);
});

test('validarCambio: rechazos', () => {
  assert.equal(validarCambio({ ...base, neum: null }).ok, false);
  assert.equal(validarCambio({ ...base, neum: { ...neum, estado: 'baja' } }).ok, false);
  assert.equal(validarCambio({ ...base, destino: 'tirar' }).ok, false);
  assert.equal(validarCambio({ ...base, motivo: '  ' }).ok, false);               // baja exige motivo
  assert.equal(validarCambio({ ...base, destino: 'reparacion', motivo: '' }).ok, true); // el resto no
  assert.equal(validarCambio({ ...base, destino: 'reencauche', neum: { ...neum, vida: 3 } }).ok, false);
  assert.equal(validarCambio({ ...base, stockId: '2' }).ok, false);               // lote sin unidades
  assert.equal(validarCambio({ ...base, stockId: '99' }).ok, false);
  assert.equal(validarCambio({ ...base, origen: 'nuevo', marca: '' }).ok, false);
  assert.equal(validarCambio({ ...base, origen: 'nuevo', marca: 'x'.repeat(61) }).ok, false);
  assert.equal(validarCambio({ ...base, origen: undefined }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '-1' }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '12.5' }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '999' }).ok, false);            // menor al actual (1000)
  assert.equal(validarCambio({ ...base, motivo: 'x'.repeat(201) }).ok, false);
});

test('traducirErrorCambio: mensajes comprensibles', () => {
  assert.match(traducirErrorCambio({ code: '42501', message: 'permiso denegado' }), /Sin permiso/);
  assert.match(traducirErrorCambio({ code: '55000', message: 'sin unidades en el stock seleccionado' }), /No quedan unidades/);
  assert.match(traducirErrorCambio({ code: 'P0002', message: 'stock inexistente' }), /stock/);
  assert.match(traducirErrorCambio({ code: 'P0002', message: 'no hay neumático en la posición 3' }), /posición/);
  assert.match(traducirErrorCambio({ code: '23514', message: 'el neumático ya alcanzó la vida máxima (3 reencauches)' }), /vida máxima/);
  assert.match(traducirErrorCambio({ code: '23514', message: 'el kilometraje no puede ser menor al actual (5)' }), /Odómetro del vehículo inválido/);
  assert.equal(traducirErrorCambio({ code: '23514', message: 'el odómetro del vehículo no puede ser menor al actual (1500 km)' }),
    'El odómetro del vehículo no puede ser menor al actual (1500 km)');
  assert.match(traducirErrorCambio({ code: '23505', message: 'el número de quema ya está registrado en otro neumático' }), /número de quema ya está registrado/);
  assert.match(traducirErrorCambio({ code: '23505', message: 'duplicate key value violates unique constraint "neumaticos_cliente_quema_uk"' }), /número de quema/);
  assert.match(traducirErrorCambio({ code: '22023', message: 'número de quema demasiado largo (máx. 40)' }), /hasta 40/);
  assert.match(traducirErrorCambio({ code: '23514', message: 'km previos fuera de rango (0 a 999999999)' }), /Los km que ya traía/);
  assert.match(traducirErrorCambio({ message: 'boom' }), /No se guardó nada/);
  assert.match(traducirErrorCambio(null), /No se pudo registrar/);
});

test('validarRotacion', () => {
  const ns = [{ vehiculo_id: 10, posicion: 1, estado: 'montado' }, { vehiculo_id: 10, posicion: 2, estado: 'montado' },
    { vehiculo_id: 10, posicion: 9, estado: 'baja' }, { vehiculo_id: 11, posicion: 5, estado: 'montado' }];
  assert.equal(validarRotacion(ns, 10, 1, 2).intercambio.posicion, 2);
  assert.equal(validarRotacion(ns, 10, 1, 4).intercambio, null);
  assert.deepEqual(validarRotacion(ns, 10, '1', '4').params, { p_vehiculo_id: 10, p_pos_a: 1, p_pos_b: 4 });
  for (const [a, b] of [[1, 1], [4, 1], [1, 9], [1, 100], [0, 1], ['x', 1], [5, 1]]) assert.equal(validarRotacion(ns, 10, a, b).ok, false);
});

test('DESTINOS cubre los cuatro destinos de la RPC', () => {
  assert.deepEqual(DESTINOS.map(d => d.id), ['baja', 'reencauche', 'reparacion', 'almacenado']);
});

// --- Km del neumático y odómetro del vehículo: dos datos distintos ---------------------------------------------
test('0 km previos es válido para un neumático nuevo aunque el vehículo tenga 1000 km (el bug del 0)', () => {
  const r = validarCambio({ ...base, kmPrevios: '0', odometro: '' });
  assert.equal(r.ok, true);
  assert.equal(r.params.p_km_previos, 0);
  assert.equal(r.params.p_odometro_km, null);
});

test('km previos vacío o ausente vale 0; acepta enteros y los pasa a la RPC', () => {
  assert.equal(validarCambio({ ...base, kmPrevios: '' }).params.p_km_previos, 0);
  assert.equal(validarCambio({ ...base, kmPrevios: undefined }).params.p_km_previos, 0);
  assert.equal(validarCambio({ ...base, kmPrevios: ' 45000 ' }).params.p_km_previos, 45000);
  assert.equal(validarCambio({ ...base, kmPrevios: '999999999' }).ok, true);
});

test('km previos inválidos: negativo, decimal, notación científica, texto y demasiado grande', () => {
  for (const v of ['-1', '12.5', '1e3', 'abc', '1000000000', '+5']) {
    const r = validarCambio({ ...base, kmPrevios: v });
    assert.equal(r.ok, false, v);
    assert.match(r.error, /km que ya traía el neumático/);
  }
});

test('el odómetro del vehículo es opcional, independiente de los km previos y no puede bajar', () => {
  assert.equal(validarCambio({ ...base, kmPrevios: '80000', odometro: '' }).ok, true);          // km previos > odómetro: válido
  const r = validarCambio({ ...base, kmPrevios: '0', odometro: '999' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'El odómetro del vehículo no puede ser menor al actual (1000 km)');
  assert.equal(validarCambio({ ...base, odometro: '1000' }).params.p_odometro_km, 1000);       // igual al actual: válido
  assert.equal(validarCambio({ ...base, odometro: '0', odometroActual: null }).params.p_odometro_km, 0); // sin odómetro previo: 0 es válido
  assert.equal(validarCambio({ ...base, odometro: '0', odometroActual: 0 }).ok, true);
  assert.match(validarCambio({ ...base, odometro: '-3' }).error, /odómetro del vehículo/);
});

test('número de quema: se recorta, vacío es null, máximo 40 y viaja a la RPC', () => {
  assert.equal(validarCambio({ ...base, numeroQuema: '  Q-1234  ' }).params.p_numero_quema, 'Q-1234');
  assert.equal(validarCambio({ ...base, numeroQuema: '   ' }).params.p_numero_quema, null);
  assert.equal(validarCambio({ ...base, numeroQuema: 'Q'.repeat(40) }).ok, true);
  const r = validarCambio({ ...base, numeroQuema: 'Q'.repeat(41) });
  assert.equal(r.ok, false);
  assert.match(r.error, /hasta 40/);
});

test('el resumen menciona quema, km previos y odómetro solo cuando se informan', () => {
  assert.doesNotMatch(validarCambio(base).resumen, /quema|previos|odómetro/);
  const r = validarCambio({ ...base, numeroQuema: 'Q-9', kmPrevios: '1200', odometro: '1500' });
  assert.match(r.resumen, /quema Q-9/);
  assert.match(r.resumen, /1200 km previos/);
  assert.match(r.resumen, /odómetro 1500 km/);
});

// --- Cubierta individual del stock y devolución del neumático retirado al stock -----------------------------------
const cubiertas = [
  { id: 41, numero_quema: 'S-001', marca: 'Michelin', modelo: 'X', condicion: 'nuevo', sucursal_id: 1, vehiculo_id: null, estado: 'almacenado' },
  { id: 42, numero_quema: 'S-002', marca: 'Pirelli', condicion: 'usado', sucursal_id: null, vehiculo_id: null },
  { id: 43, numero_quema: 'S-003', marca: 'Montada', vehiculo_id: 10, estado: 'montado' },
];
const sucursales = [{ id: 1, nombre: 'Montevideo' }, { id: 2, nombre: 'Salto' }];
const conCubierta = { ...base, origen: 'cubierta', cubiertaId: '41', cubiertas, sucursales };

test('cubierta individual: envía p_cubierta_id y no la quema ni los km del formulario', () => {
  const r = validarCambio({ ...conCubierta, numeroQuema: 'IGNORADA', kmPrevios: '500' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 10, p_posicion: 3, p_destino_viejo: 'baja', p_motivo: 'Desgaste',
    p_odometro_km: null, p_stock_id: null, p_nuevo: null, p_numero_quema: null, p_km_previos: 0, p_cubierta_id: 41 });
  assert.match(r.resumen, /cubierta S-001 del stock/);
  assert.doesNotMatch(r.resumen, /IGNORADA|km previos/);
});

test('cubierta individual: rechaza la que no está disponible o no existe', () => {
  assert.equal(validarCambio({ ...conCubierta, cubiertaId: '43' }).ok, false);   // montada
  assert.equal(validarCambio({ ...conCubierta, cubiertaId: '99' }).ok, false);
  assert.equal(validarCambio({ ...conCubierta, cubiertaId: '' }).ok, false);
  assert.equal(validarCambio({ ...conCubierta, cubiertas: [] }).ok, false);
});

test('los lotes y el ingreso manual siguen sin parámetros nuevos (compatibles)', () => {
  assert.equal('p_cubierta_id' in validarCambio(base).params, false);
  assert.equal('p_devolver_stock' in validarCambio(base).params, false);
  assert.equal('p_devolver_stock' in validarCambio({ ...base, destino: 'almacenado', devolverStock: false }).params, false);
});

test('almacenar con devolución al stock: sucursal indicada o sin sucursal', () => {
  const a = validarCambio({ ...base, destino: 'almacenado', motivo: '', devolverStock: true, sucursalStock: '2', neum: { ...neum, numero_quema: 'Q-9' }, sucursales });
  assert.equal(a.ok, true);
  assert.equal(a.params.p_devolver_stock, true);
  assert.equal(a.params.p_sucursal_stock, 2);
  assert.equal('p_quema_viejo' in a.params, false);        // ya tiene quema
  assert.match(a.resumen, /vuelve al stock, Salto/);
  const b = validarCambio({ ...base, destino: 'almacenado', motivo: '', devolverStock: true, sucursalStock: '', neum: { ...neum, numero_quema: 'Q-9' }, sucursales });
  assert.equal(b.params.p_sucursal_stock, null);
  assert.match(b.resumen, /vuelve al stock, Sin sucursal/);
});

test('almacenar sin quema propia exige indicarla; la envía recortada', () => {
  const sin = { ...base, destino: 'almacenado', motivo: '', devolverStock: true, sucursalStock: '1', sucursales };
  assert.match(validarCambio(sin).error, /número de quema del neumático retirado/);
  assert.match(validarCambio({ ...sin, quemaViejo: '  ' }).error, /número de quema del neumático retirado/);
  assert.match(validarCambio({ ...sin, quemaViejo: 'Q'.repeat(41) }).error, /40/);
  assert.equal(validarCambio({ ...sin, quemaViejo: ' Q-77 ' }).params.p_quema_viejo, 'Q-77');
});

test('otros destinos no devuelven al stock aunque se pida', () => {
  const r = validarCambio({ ...base, destino: 'reparacion', devolverStock: true, sucursalStock: '1' });
  assert.equal(r.ok, true);
  assert.equal('p_devolver_stock' in r.params, false);
});

test('el destino «reencauche» se presenta como «Recauchutado»', () => {
  assert.equal(DESTINOS.find(d => d.id === 'reencauche').label, 'Recauchutado');
  assert.match(traducirErrorCambio({ code: '23514', message: 'el neumático ya alcanzó la vida máxima (3 reencauches)' }), /3 recauchutados/);
});

test('traducirErrorCambio: cubierta y devolución al stock', () => {
  assert.match(traducirErrorCambio({ code: 'P0002', message: 'cubierta del stock inexistente o ya montada' }), /Esa cubierta ya no está disponible/);
  assert.match(traducirErrorCambio({ code: '22023', message: 'el neumático retirado necesita número de quema para volver al stock' }), /necesita número de quema/);
  assert.match(traducirErrorCambio({ message: 'el stock lo gestiona el perfil global: dejar el neumático retirado en el vehículo' }), /no puede usar el stock/);
});
