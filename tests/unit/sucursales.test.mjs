// Tests de domain/sucursales.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarNombreSucursal, validarVehiculoNuevo, argsMover, contarPorSucursal, filtrarVehiculos,
  textoSucursal, confirmacionMover, confirmacionEliminar, mensajeErrorGestion,
} from '../../assets/js/domain/sucursales.js';

describe('validarNombreSucursal', () => {
  test('recorta espacios', () => assert.deepEqual(validarNombreSucursal('  Salto  '), { ok: true, valor: 'Salto' }));
  test('vacío, solo espacios, null y undefined', () => {
    for (const v of ['', '   ', null, undefined]) assert.equal(validarNombreSucursal(v).ok, false);
  });
  test('límite de 100 caracteres', () => {
    assert.equal(validarNombreSucursal('x'.repeat(100)).ok, true);
    assert.equal(validarNombreSucursal('x'.repeat(101)).ok, false);
  });
});

describe('validarVehiculoNuevo', () => {
  test('arma los argumentos de la RPC', () => {
    assert.deepEqual(validarVehiculoNuevo({ numero: ' 12 ', patente: ' ab 123 ', tipoRuedas: '16', sucursalId: '5' }),
      { ok: true, args: { p_numero: '12', p_patente: 'ab 123', p_tipo_ruedas: 16, p_sucursal_id: 5 } });
  });
  test('matrícula y sucursal opcionales => null', () => {
    const r = validarVehiculoNuevo({ numero: '7', patente: '  ', tipoRuedas: 10, sucursalId: '' });
    assert.equal(r.args.p_patente, null);
    assert.equal(r.args.p_sucursal_id, null);
  });
  test('número obligatorio', () => {
    assert.match(validarVehiculoNuevo({ numero: ' ', tipoRuedas: 10 }).error, /número de coche/);
    assert.equal(validarVehiculoNuevo().ok, false);
  });
  test('tipo de ruedas solo 10 o 16', () => {
    for (const t of [12, 'x', null, undefined, 0]) assert.equal(validarVehiculoNuevo({ numero: '1', tipoRuedas: t }).ok, false);
  });
  test('largos máximos', () => {
    assert.equal(validarVehiculoNuevo({ numero: 'n'.repeat(51), tipoRuedas: 10 }).ok, false);
    assert.equal(validarVehiculoNuevo({ numero: '1', patente: 'p'.repeat(21), tipoRuedas: 10 }).ok, false);
  });
});

describe('argsMover', () => {
  test('sucursal vacía => null (sin sucursal)', () => {
    assert.deepEqual(argsMover('3', ''), { p_vehiculo_id: 3, p_sucursal_id: null });
    assert.deepEqual(argsMover(3, null), { p_vehiculo_id: 3, p_sucursal_id: null });
  });
  test('convierte a número', () => assert.deepEqual(argsMover('3', '9'), { p_vehiculo_id: 3, p_sucursal_id: 9 }));
});

describe('contarPorSucursal', () => {
  test('agrupa y cuenta los sin sucursal en la clave vacía', () => {
    const m = contarPorSucursal([{ sucursal_id: 1 }, { sucursal_id: 1 }, { sucursal_id: null }, {}, { sucursal_id: 2 }]);
    assert.equal(m.get('1'), 2);
    assert.equal(m.get('2'), 1);
    assert.equal(m.get(''), 2);
  });
  test('entrada vacía o nula', () => {
    assert.equal(contarPorSucursal([]).size, 0);
    assert.equal(contarPorSucursal(null).size, 0);
  });
});

describe('filtrarVehiculos', () => {
  const vs = [{ id: 1, patente: 'AB 123', numero: '101', nombre: 'Coche 101' }, { id: 2, patente: null, numero: '202', nombre: 'Coche 202' }];
  test('sin texto devuelve todo', () => assert.equal(filtrarVehiculos(vs, '  ').length, 2));
  test('por matrícula sin importar mayúsculas ni espacios', () => assert.deepEqual(filtrarVehiculos(vs, 'ab123').map(v => v.id), [1]));
  test('ignora guiones', () => assert.deepEqual(filtrarVehiculos([{ id: 9, patente: 'SAB-1234' }], 'sab 1234').map(v => v.id), [9]));
  test('por número de coche', () => assert.deepEqual(filtrarVehiculos(vs, '202').map(v => v.id), [2]));
  test('sin coincidencias y entrada nula', () => {
    assert.deepEqual(filtrarVehiculos(vs, 'zzz'), []);
    assert.deepEqual(filtrarVehiculos(null, 'a'), []);
  });
});

describe('textos', () => {
  const sucs = [{ id: 1, nombre: 'Norte' }];
  test('textoSucursal', () => {
    assert.equal(textoSucursal(1, sucs), 'Norte');
    assert.equal(textoSucursal(null, sucs), 'Sin sucursal');
    assert.equal(textoSucursal(99, sucs), 'Sin sucursal');
  });
  test('confirmación de mover nombra el coche y conserva el historial', () => {
    const c = confirmacionMover({ numero: '101', nombre: 'Coche 101' }, 'Norte');
    assert.match(c.mensaje, /coche 101/);
    assert.match(c.mensaje, /«Norte»/);
    assert.match(c.mensaje, /historial/);
    assert.match(confirmacionMover({ numero: null, nombre: 'Camión' }, 'Sin sucursal').mensaje, /«Camión»/);
  });
  test('confirmación de eliminar distingue con y sin vehículos', () => {
    assert.match(confirmacionEliminar('Norte', 0).mensaje, /¿Eliminar/);
    assert.match(confirmacionEliminar('Norte', 1).mensaje, /1 vehículo\./);
    assert.match(confirmacionEliminar('Norte', 3).mensaje, /3 vehículos/);
  });
});

describe('mensajeErrorGestion', () => {
  test('duplicados según el índice', () => {
    assert.match(mensajeErrorGestion({ code: '23505', message: 'duplicate key value violates unique constraint "vehiculos_cliente_numero_uk"' }), /número de coche/);
    assert.match(mensajeErrorGestion({ code: '23505', message: 'duplicate key ... "vehiculos_cliente_patente_norm_uk"' }), /matrícula/);
    assert.match(mensajeErrorGestion({ code: '23505', message: 'duplicate key ... "sucursales_cliente_nombre_uk"' }), /sucursal/);
  });
  test('borrado restringido usa el mensaje de la base', () => {
    const m = mensajeErrorGestion({ code: '23503', message: 'la sucursal tiene 2 vehículo(s), 0 dispositivo(s) y 1 usuario(s): reasignarlos antes de eliminarla' });
    assert.match(m, /^La sucursal tiene 2 vehículo\(s\)/);
    assert.match(mensajeErrorGestion({ code: '23503', message: 'violates foreign key constraint' }), /Reasignarlos/);
  });
  test('permiso, inexistente, inválido y desconocido', () => {
    assert.match(mensajeErrorGestion({ code: '42501' }), /Sin permiso/);
    assert.match(mensajeErrorGestion({ code: 'P0002' }), /ya no existe/);
    assert.match(mensajeErrorGestion({ code: '23514' }), /inválidos/);
    assert.match(mensajeErrorGestion(null), /No se pudo/);
  });
});
