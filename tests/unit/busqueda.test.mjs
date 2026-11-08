// Buscador por matrícula o número de coche con datos como los del seed de demo y los que escribe un usuario real.
// Un PR que arregla un bug debe incluir un test que falle sin el arreglo: los casos con guion, punto y separadores
// fallaban cuando claveBusqueda solo quitaba espacios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { claveBusqueda, buscarVehiculos, coincidenciaExacta, resolverBusqueda, quemaCoincidente } from '../../assets/js/domain/vehiculo-busqueda.js';

// Patentes DEMO001..DEMO014 y números de coche 101-109 / 201-205 (nombre = número, como en supabase/seed/demo.sql), más patentes con formatos reales.
const demo = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: i + 1, nombre: `10${i + 1}`, patente: `DEMO00${i + 1}`, numero: `10${i + 1}`, activo: true })),
  { id: 10, nombre: '201', patente: 'DEMO010', numero: '201', activo: true },
  { id: 11, nombre: '202', patente: 'DEMO011', numero: '202', activo: true },
  { id: 20, nombre: 'Camión con guion', patente: 'SAB-1234', numero: null, activo: true },
  { id: 21, nombre: 'Camión con espacio', patente: 'SBC 5678', numero: 301, activo: true },
  { id: 22, nombre: 'Sin matrícula', patente: null, numero: null, activo: true },
];
const ids = (texto) => buscarVehiculos(demo, texto).map(v => v.id);

describe('claveBusqueda', () => {
  test('solo letras y dígitos, en mayúsculas y sin tildes', () => {
    assert.equal(claveBusqueda('sab-1234'), 'SAB1234');
    assert.equal(claveBusqueda(' SBC  56.78 '), 'SBC5678');
    assert.equal(claveBusqueda('Camión_01'), 'CAMION01');
    assert.equal(claveBusqueda(null), '');
    assert.equal(claveBusqueda(' - '), '');
  });
});

describe('matrícula', () => {
  test('mayúsculas, minúsculas y mezcla', () => {
    assert.deepEqual(ids('DEMO010'), [10]);
    assert.deepEqual(ids('demo010'), [10]);
    assert.deepEqual(ids('DeMo010'), [10]);
  });
  test('con espacios y guiones, tal como se escriba', () => {
    assert.deepEqual(ids(' demo 010 '), [10]);
    assert.deepEqual(ids('DEMO-010'), [10]);
    assert.deepEqual(ids('sab1234'), [20]);   // guardada con guion, escrita sin él
    assert.deepEqual(ids('SAB 1234'), [20]);
    assert.deepEqual(ids('sbc-5678'), [21]);  // guardada con espacio, escrita con guion
    assert.deepEqual(ids('SBC5678'), [21]);
  });
  test('parcial', () => {
    assert.deepEqual(ids('DEMO01').sort((a, b) => a - b), [10, 11]);
    assert.deepEqual(ids('1234'), [20]);
  });
});

describe('número de coche', () => {
  test('exacto y como número, no solo como texto', () => {
    assert.deepEqual(ids('201'), [10]);
    assert.deepEqual(ids('301'), [21]);   // numero guardado como número
  });
  test('el exacto va antes que los parciales', () => {
    assert.equal(buscarVehiculos([{ id: 1, nombre: 'a', numero: '101' }, { id: 2, nombre: 'b', numero: '10' }], '10')[0].id, 2);
  });
});

describe('resolverBusqueda', () => {
  test('una coincidencia exacta abre el detalle', () => {
    assert.equal(resolverBusqueda(demo, 'DEMO010').accion, 'abrir');
    assert.equal(resolverBusqueda(demo, 'DEMO010').vehiculo.id, 10);
    assert.equal(resolverBusqueda(demo, '201').vehiculo.id, 10);
    assert.equal(resolverBusqueda(demo, 'sab-1234').vehiculo.id, 20);
  });
  test('una única coincidencia parcial abre el detalle', () => {
    assert.equal(resolverBusqueda(demo, 'SBC56').accion, 'abrir');
  });
  test('varias coincidencias: lista acotada, con el total real', () => {
    const r = resolverBusqueda(demo, 'DEMO', 5);
    assert.equal(r.accion, 'lista');
    assert.equal(r.items.length, 5);
    assert.equal(r.total, 11);
    assert.equal(r.vehiculo, null);
  });
  test('sin coincidencias, texto vacío o solo separadores', () => {
    assert.equal(resolverBusqueda(demo, 'ZZZ999').accion, 'ninguno');
    assert.equal(resolverBusqueda(demo, '   ').accion, 'vacio');
    assert.equal(resolverBusqueda(demo, '--').accion, 'vacio');
  });
  test('catálogo vacío o nulo', () => {
    assert.equal(resolverBusqueda([], 'DEMO010').accion, 'ninguno');
    assert.equal(resolverBusqueda(null, 'DEMO010').accion, 'ninguno');
  });
  test('misma matrícula en dos clientes (admin): no se abre solo', () => {
    const dos = [{ id: 1, nombre: 'A', patente: 'AB123CD', numero: null }, { id: 2, nombre: 'B', patente: 'AB-123-CD', numero: null }];
    assert.equal(coincidenciaExacta(dos, 'ab123cd'), null);
    assert.equal(resolverBusqueda(dos, 'ab123cd').accion, 'lista');
  });
});

describe('el nombre es el número de coche (sin prefijo "Camión")', () => {
  test('buscar "106" y "Coche 106" encuentra el mismo vehículo; la matrícula también', () => {
    const v = [{ id: 6, nombre: '106', patente: 'DEMO006', numero: '106', activo: true }, { id: 7, nombre: '107', patente: 'DEMO007', numero: '107', activo: true }];
    assert.equal(resolverBusqueda(v, '106').vehiculo.id, 6);
    assert.equal(resolverBusqueda(v, 'coche 106').vehiculo.id, 6);           // lo que muestra la interfaz
    assert.equal(resolverBusqueda(v, 'COCHE-107').vehiculo.id, 7);
    assert.equal(resolverBusqueda(v, 'DEMO006').vehiculo.id, 6);
    assert.equal(resolverBusqueda(v, 'demo 007').vehiculo.id, 7);
  });
  test('"Coche 106" abre el vehículo aunque solo tenga nombre (sin numero) y el prefijo solo no filtra nada', () => {
    const v = [{ id: 6, nombre: '106', patente: null, numero: null, activo: true }, { id: 7, nombre: '107', patente: null, numero: null, activo: true }];
    assert.equal(resolverBusqueda(v, 'Coche 106').vehiculo.id, 6);
    assert.equal(resolverBusqueda(v, 'coche106').vehiculo.id, 6);
    assert.equal(resolverBusqueda(v, '106').vehiculo.id, 6);
    assert.equal(resolverBusqueda(v, 'coche 10').total, 2);           // "coche" + número parcial también acota
    assert.equal(resolverBusqueda(v, 'coche').accion, 'ninguno');     // el prefijo solo no coincide con nada
  });
  test('un vehículo anterior con nombre de texto se sigue encontrando por nombre, matrícula y número', () => {
    const v = [{ id: 1, nombre: 'Unidad Sur', patente: 'AB 123 CD', numero: '112', activo: true }];
    assert.equal(resolverBusqueda(v, 'unidad sur').vehiculo.id, 1);
    assert.equal(resolverBusqueda(v, 'ab123cd').vehiculo.id, 1);
    assert.equal(resolverBusqueda(v, '112').vehiculo.id, 1);
  });
});

describe('número de quema', () => {
  const conQuemas = [
    { id: 1, nombre: '101', patente: 'DEMO001', numero: '101', quemas: ['Q01-01', 'Q01-02'] },
    { id: 2, nombre: '102', patente: 'DEMO002', numero: '102', quemas: ['Q02-01', 'AB 9000'] },
    { id: 3, nombre: '103', patente: 'DEMO003', numero: '103' },                // sin quemas cargadas
    { id: 4, nombre: '104', patente: 'DEMO004', numero: '104', quemas: [] },
  ];
  test('la quema exacta abre el vehículo donde está montado', () => {
    const r = resolverBusqueda(conQuemas, 'Q02-01');
    assert.equal(r.accion, 'abrir');
    assert.equal(r.vehiculo.id, 2);
  });
  test('sin distinguir mayúsculas, espacios ni guiones', () => {
    assert.equal(resolverBusqueda(conQuemas, 'q0101').vehiculo.id, 1);
    assert.equal(resolverBusqueda(conQuemas, 'ab9000').vehiculo.id, 2);
    assert.equal(resolverBusqueda(conQuemas, ' ab-9000 ').vehiculo.id, 2);
  });
  test('parcial: lista los vehículos con quemas parecidas; el exacto va primero', () => {
    const r = resolverBusqueda(conQuemas, 'Q0');
    assert.equal(r.accion, 'lista');
    assert.deepEqual(r.items.map(v => v.id).sort(), [1, 2]);
  });
  test('quema inexistente, vehículos sin quemas y vehículos sin el campo no rompen la búsqueda', () => {
    assert.equal(resolverBusqueda(conQuemas, 'Q99-99').accion, 'ninguno');
    assert.equal(resolverBusqueda(conQuemas, '103').vehiculo.id, 3);
    assert.equal(buscarVehiculos([{ id: 9, nombre: 'x', quemas: null }], 'x').length, 1);
  });
  test('la quema contenida en medio de otro número no genera coincidencias sin relación', () => {
    const v = [{ id: 1, nombre: '201', numero: '201', patente: 'DEMO010', quemas: ['Q11-01', 'Q1101'] }];
    assert.equal(resolverBusqueda(v, '101').accion, 'ninguno');
    assert.equal(resolverBusqueda(v, '110').accion, 'ninguno');
    assert.equal(resolverBusqueda(v, 'q11').vehiculo.id, 1);   // por prefijo sí
  });
  test('la matrícula y el número de coche siguen funcionando con quemas cargadas', () => {
    assert.equal(resolverBusqueda(conQuemas, 'DEMO001').vehiculo.id, 1);
    assert.equal(resolverBusqueda(conQuemas, '104').vehiculo.id, 4);
  });
  test('coincidenciaExacta con la misma quema en dos vehículos no abre ninguno', () => {
    const dup = [{ id: 1, nombre: 'a', quemas: ['Z1'] }, { id: 2, nombre: 'b', quemas: ['z1'] }];
    assert.equal(coincidenciaExacta(dup, 'Z1'), null);
    assert.equal(resolverBusqueda(dup, 'Z1').accion, 'lista');
  });
  test('quemaCoincidente devuelve la quema que explica el resultado', () => {
    assert.equal(quemaCoincidente(conQuemas[1], 'ab9000'), 'AB 9000');
    assert.equal(quemaCoincidente(conQuemas[1], 'Q02'), 'Q02-01');
    assert.equal(quemaCoincidente(conQuemas[1], 'DEMO002'), null);
    assert.equal(quemaCoincidente(conQuemas[2], 'Q'), null);
    assert.equal(quemaCoincidente(null, 'Q'), null);
    assert.equal(quemaCoincidente(conQuemas[1], ''), null);
  });
});
