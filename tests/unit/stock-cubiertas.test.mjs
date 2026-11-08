// Stock de cubiertas individuales: validación del formulario, argumentos de las RPC, filtros, orden, errores y buscador.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDICIONES, CONDICIONES_MANUALES, etiquetaCondicion, claseCondicion, nombreUbicacion, parsePrecio, parseFecha,
  validarCubierta, validarEdicion, argsMoverCubierta, filtrarCubiertas, ordenarCubiertas, resumenCubiertas,
  etiquetaCubierta, cubiertasMontables, traducirErrorStock, buscarCubiertas, resolverBusquedaConStock
} from '../../assets/js/domain/stock-cubiertas.js';

const sucursales = [{ id: 1, nombre: 'Montevideo' }, { id: 2, nombre: 'Salto' }];
const cubs = [
  { id: 1, cliente_id: 7, numero_quema: 'S-010', marca: 'Michelin', modelo: 'X Multi Z', condicion: 'nuevo', sucursal_id: 1, fecha_compra: '2026-01-10', precio_unidad: '455.00' },
  { id: 2, cliente_id: 7, numero_quema: 'S-002', marca: 'Pirelli', modelo: null, condicion: 'usado', sucursal_id: 2 },
  { id: 3, cliente_id: 7, numero_quema: 'S-001', marca: 'Bridgestone', modelo: 'R249', condicion: 'reparado', sucursal_id: null },
  { id: 4, cliente_id: 8, numero_quema: 'Z-100', marca: 'Goodyear', modelo: 'G661', condicion: 'recauchutado', sucursal_id: 1 },
];
const hoy = '2026-11-08';

describe('condiciones', () => {
  test('los cuatro términos exactos y las dos manuales', () => {
    assert.deepEqual(CONDICIONES.map(c => c.label), ['Nuevo', 'Usado', 'Reparado', 'Recauchutado']);
    assert.deepEqual(CONDICIONES_MANUALES.map(c => c.id), ['reparado', 'recauchutado']);
  });
  test('etiqueta y clase; valores desconocidos no rompen', () => {
    assert.equal(etiquetaCondicion('recauchutado'), 'Recauchutado');
    assert.equal(etiquetaCondicion('roto'), 'roto');
    assert.equal(etiquetaCondicion(null), '—');
    assert.equal(claseCondicion('nuevo'), 'cond-nuevo');
    assert.equal(claseCondicion('roto'), 'cond-usado');
  });
});

describe('ubicación', () => {
  test('sucursal del cliente o «Sin sucursal»', () => {
    assert.equal(nombreUbicacion(2, sucursales), 'Salto');
    assert.equal(nombreUbicacion('2', sucursales), 'Salto');
    assert.equal(nombreUbicacion(null, sucursales), 'Sin sucursal');
    assert.equal(nombreUbicacion('', sucursales), 'Sin sucursal');
    assert.equal(nombreUbicacion(99, sucursales), 'Sin sucursal');
    assert.equal(nombreUbicacion(1, null), 'Sin sucursal');
  });
});

describe('precio y fecha', () => {
  test('precio opcional con hasta 2 decimales', () => {
    assert.deepEqual(parsePrecio(''), { ok: true, valor: null });
    assert.deepEqual(parsePrecio(null), { ok: true, valor: null });
    assert.deepEqual(parsePrecio('455'), { ok: true, valor: 455 });
    assert.deepEqual(parsePrecio('455,5'), { ok: true, valor: 455.5 });
    assert.deepEqual(parsePrecio('0'), { ok: true, valor: 0 });
    for (const malo of ['-1', 'abc', '1.234', '1e3', '12,', '10000000000']) assert.equal(parsePrecio(malo).ok, false, malo);
  });
  test('fecha opcional, válida y no futura', () => {
    assert.deepEqual(parseFecha('', hoy), { ok: true, valor: null });
    assert.deepEqual(parseFecha('2026-11-08', hoy), { ok: true, valor: '2026-11-08' });
    assert.match(parseFecha('2026-11-09', hoy).error, /futura/);
    assert.equal(parseFecha('08/11/2026', hoy).ok, false);
    assert.equal(parseFecha('2026-13-40', hoy).ok, false);
  });
});

describe('validarCubierta (Agregar cubierta)', () => {
  const ok = { quema: ' S-100 ', marca: ' Michelin ', modelo: '', fechaCompra: '2026-05-01', precio: '', sucursalId: '' };
  test('cliente global: argumentos de stock_cubierta_agregar, recortados y con nulos', () => {
    assert.deepEqual(validarCubierta(ok, { hoy }), { ok: true, args: {
      p_numero_quema: 'S-100', p_marca: 'Michelin', p_modelo: null, p_fecha_compra: '2026-05-01', p_precio: null, p_sucursal_id: null } });
  });
  test('con modelo, precio y sucursal', () => {
    const r = validarCubierta({ ...ok, modelo: 'X', precio: '99.5', sucursalId: '2' }, { hoy });
    assert.equal(r.args.p_modelo, 'X'); assert.equal(r.args.p_precio, 99.5); assert.equal(r.args.p_sucursal_id, 2);
  });
  test('admin: exige y envía el cliente', () => {
    assert.match(validarCubierta(ok, { esAdmin: true, hoy }).error, /cliente/);
    assert.equal(validarCubierta({ ...ok, clienteId: '7' }, { esAdmin: true, hoy }).args.p_cliente_id, 7);
    assert.equal('p_cliente_id' in validarCubierta(ok, { hoy }).args, false);
  });
  test('rechazos: quema, marca, largos, fecha y precio', () => {
    assert.match(validarCubierta({ ...ok, quema: '  ' }, { hoy }).error, /quema/);
    assert.match(validarCubierta({ ...ok, quema: 'Q'.repeat(41) }, { hoy }).error, /40/);
    assert.match(validarCubierta({ ...ok, marca: ' ' }, { hoy }).error, /marca/);
    assert.match(validarCubierta({ ...ok, marca: 'M'.repeat(61) }, { hoy }).error, /60/);
    assert.match(validarCubierta({ ...ok, modelo: 'M'.repeat(61) }, { hoy }).error, /60/);
    assert.match(validarCubierta({ ...ok, fechaCompra: '2027-01-01' }, { hoy }).error, /futura/);
    assert.match(validarCubierta({ ...ok, precio: '-5' }, { hoy }).error, /precio/i);
    assert.equal(validarCubierta(null, { hoy }).ok, false);
  });
});

describe('validarEdicion', () => {
  const actual = { id: 1, marca: 'Michelin', modelo: 'X Multi Z', fecha_compra: '2026-01-10', precio_unidad: '455.00', condicion: 'nuevo' };
  const igual = { marca: 'Michelin', modelo: 'X Multi Z', fechaCompra: '2026-01-10', precio: '455', condicion: '' };
  test('sin cambios no llama a la RPC', () => {
    assert.match(validarEdicion(actual, igual, { hoy }).error, /No hay cambios/);
  });
  test('solo envía lo que cambió', () => {
    const r = validarEdicion(actual, { ...igual, marca: 'Goodyear', precio: '' }, { hoy });
    assert.deepEqual(r.args, { p_id: 1, p_datos: { marca: 'Goodyear', precio: null } });
  });
  test('borrar el modelo y la fecha', () => {
    const r = validarEdicion(actual, { ...igual, modelo: ' ', fechaCompra: '' }, { hoy });
    assert.deepEqual(r.args.p_datos, { modelo: null, fecha_compra: null });
  });
  test('condición: solo reparado o recauchutado', () => {
    assert.deepEqual(validarEdicion(actual, { ...igual, condicion: 'recauchutado' }, { hoy }).args.p_datos, { condicion: 'recauchutado' });
    assert.deepEqual(validarEdicion(actual, { ...igual, condicion: 'reparado' }, { hoy }).args.p_datos, { condicion: 'reparado' });
    assert.match(validarEdicion(actual, { ...igual, condicion: 'x' }, { hoy }).error, /Reparado o Recauchutado/);
    assert.match(validarEdicion({ ...actual, condicion: 'usado' }, { ...igual, condicion: 'nuevo' }, { hoy }).error, /Reparado o Recauchutado/);
    assert.match(validarEdicion(actual, { ...igual, condicion: 'usado' }, { hoy }).error, /Reparado o Recauchutado/);
  });
  test('misma condición que la actual no se envía', () => {
    assert.match(validarEdicion({ ...actual, condicion: 'reparado' }, { ...igual, condicion: 'reparado' }, { hoy }).error, /No hay cambios/);
  });
  test('rechazos de formato', () => {
    assert.match(validarEdicion(actual, { ...igual, marca: '' }, { hoy }).error, /marca/);
    assert.match(validarEdicion(actual, { ...igual, precio: 'x' }, { hoy }).error, /precio/i);
    assert.match(validarEdicion(actual, { ...igual, fechaCompra: '2027-02-02' }, { hoy }).error, /futura/);
  });
});

test('argsMoverCubierta: vacío = sin sucursal', () => {
  assert.deepEqual(argsMoverCubierta('5', '2'), { p_id: 5, p_sucursal_id: 2 });
  assert.deepEqual(argsMoverCubierta(5, ''), { p_id: 5, p_sucursal_id: null });
  assert.deepEqual(argsMoverCubierta(5, null), { p_id: 5, p_sucursal_id: null });
});

describe('filtros y orden', () => {
  const ids = f => filtrarCubiertas(cubs, f).map(c => c.id);
  test('sin filtros devuelve todo', () => { assert.deepEqual(ids({}), [1, 2, 3, 4]); assert.deepEqual(ids(undefined), [1, 2, 3, 4]); });
  test('por sucursal, incluida «sin sucursal»', () => {
    assert.deepEqual(ids({ sucursal: '1' }), [1, 4]);
    assert.deepEqual(ids({ sucursal: '2' }), [2]);
    assert.deepEqual(ids({ sucursal: 'ninguna' }), [3]);
  });
  test('por condición y por cliente', () => {
    assert.deepEqual(ids({ condicion: 'nuevo' }), [1]);
    assert.deepEqual(ids({ condicion: 'usado' }), [2]);
    assert.deepEqual(ids({ cliente: '8' }), [4]);
  });
  test('búsqueda por quema, marca o modelo sin distinguir mayúsculas ni separadores', () => {
    assert.deepEqual(ids({ texto: 's-010' }), [1]);
    assert.deepEqual(ids({ texto: 'S010' }), [1]);
    assert.deepEqual(ids({ texto: 'pirelli' }), [2]);
    assert.deepEqual(ids({ texto: 'multi' }), [1]);
    assert.deepEqual(ids({ texto: 'zzz' }), []);
    assert.deepEqual(ids({ texto: '   ' }), [1, 2, 3, 4]);
  });
  test('los filtros se combinan', () => {
    assert.deepEqual(ids({ sucursal: '1', condicion: 'recauchutado' }), [4]);
    assert.deepEqual(ids({ sucursal: '1', condicion: 'usado' }), []);
  });
  test('orden natural por quema', () => {
    assert.deepEqual(ordenarCubiertas(cubs).map(c => c.numero_quema), ['S-001', 'S-002', 'S-010', 'Z-100']);
    assert.deepEqual(ordenarCubiertas(null), []);
  });
  test('resumen por condición, solo las que tienen unidades', () => {
    const r = resumenCubiertas(cubs);
    assert.equal(r.total, 4);
    assert.deepEqual(r.porCondicion.map(c => `${c.label}:${c.n}`), ['Nuevo:1', 'Usado:1', 'Reparado:1', 'Recauchutado:1']);
    assert.deepEqual(resumenCubiertas([]), { total: 0, porCondicion: [] });
  });
});

describe('selector del cambio de neumático', () => {
  test('etiqueta con quema, cubierta, condición y ubicación', () => {
    assert.equal(etiquetaCubierta(cubs[0], sucursales), 'S-010 · Michelin X Multi Z · Nuevo · Montevideo');
    assert.equal(etiquetaCubierta(cubs[2], sucursales), 'S-001 · Bridgestone R249 · Reparado · Sin sucursal');
    assert.equal(etiquetaCubierta({ condicion: 'usado' }, []), 'Sin quema · Sin marca · Usado · Sin sucursal');
  });
  test('solo cubiertas sin vehículo y almacenadas, por quema', () => {
    const filas = [
      { id: 1, numero_quema: 'S-2', vehiculo_id: null, estado: 'almacenado' },
      { id: 2, numero_quema: 'S-1', vehiculo_id: null },
      { id: 3, numero_quema: 'S-3', vehiculo_id: 10, estado: 'montado' },
      { id: 4, numero_quema: 'S-4', vehiculo_id: null, estado: 'baja' },
    ];
    assert.deepEqual(cubiertasMontables(filas).map(c => c.id), [2, 1]);
    assert.deepEqual(cubiertasMontables(null), []);
  });
});

describe('traducirErrorStock', () => {
  test('mensajes de una frase para cada caso', () => {
    assert.match(traducirErrorStock({ code: '42501', message: 'permiso denegado' }), /Sin permiso/);
    assert.match(traducirErrorStock({ code: '42501', message: 'new row violates row-level security policy' }), /Sin permiso/);
    assert.match(traducirErrorStock({ code: '23505', message: 'el número de quema ya está registrado en otro neumático' }), /número de quema ya está registrado/);
    assert.match(traducirErrorStock({ code: 'P0002', message: 'cubierta inexistente' }), /ya no existe/);
    assert.match(traducirErrorStock({ code: '55000', message: 'la cubierta ya tuvo uso (montajes, mediciones o eventos): no se puede eliminar' }), /ya tuvo uso/);
    assert.match(traducirErrorStock({ code: '55000', message: 'la cubierta está montada en un vehículo: no se gestiona desde el stock' }), /montada/);
    assert.match(traducirErrorStock({ code: '22023', message: 'condición inválida: solo reparado o recauchutado' }), /Reparado o Recauchutado/);
    assert.match(traducirErrorStock({ code: '22023', message: 'indicar la marca' }), /marca/);
    assert.match(traducirErrorStock({ code: '23514', message: 'la fecha de compra no puede ser futura' }), /fecha/);
    assert.match(traducirErrorStock({ code: '23514', message: 'precio fuera de rango' }), /precio/);
    assert.match(traducirErrorStock({ code: '22023', message: 'otra cosa' }), /inválidos/);
    assert.match(traducirErrorStock(null), /Reintentar/);
  });
  test('sin segunda persona ni tono informal', () => {
    for (const e of [{ code: '42501' }, { code: '23505' }, { code: 'P0002' }, { code: '55000' }, {}]) {
      assert.doesNotMatch(traducirErrorStock(e), /\b(vos|tú|usted)\b|[a-záéíóú]+(á|és)\b!|!|\.\.\./);
    }
  });
});

describe('buscador: cubiertas en stock por quema', () => {
  const vehiculos = [
    { id: 10, nombre: '101', patente: 'DEMO001', numero: '101', quemas: ['Q01-01'] },
    { id: 11, nombre: '102', patente: 'DEMO002', numero: '102' },
  ];
  test('quema exacta o por prefijo; ignora separadores y mayúsculas', () => {
    assert.deepEqual(buscarCubiertas(cubs, 's-001').map(c => c.id), [3]);
    assert.deepEqual(buscarCubiertas(cubs, 'S001').map(c => c.id), [3]);
    assert.deepEqual(buscarCubiertas(cubs, 'S-0').map(c => c.id), [3, 2, 1]);
    assert.deepEqual(buscarCubiertas(cubs, '001'), []);        // en medio de la quema no cuenta
    assert.deepEqual(buscarCubiertas(cubs, ''), []);
    assert.deepEqual(buscarCubiertas(null, 'S'), []);
    assert.deepEqual(buscarCubiertas([{ id: 9, numero_quema: null }], 'S'), []);
  });
  test('una quema solo de stock abre Stock', () => {
    const r = resolverBusquedaConStock(vehiculos, cubs, 'S-001');
    assert.equal(r.accion, 'abrir-stock');
    assert.equal(r.cubierta.id, 3);
    assert.equal(r.items[0].tipo, 'cubierta');
  });
  test('una quema de un neumático montado sigue abriendo el vehículo', () => {
    const r = resolverBusquedaConStock(vehiculos, cubs, 'Q01-01');
    assert.equal(r.accion, 'abrir');
    assert.equal(r.vehiculo.id, 10);
    assert.deepEqual(r.items.map(i => i.tipo), ['vehiculo']);
  });
  test('varias cubiertas: lista; vehículos y cubiertas juntos: lista con ambos', () => {
    const l = resolverBusquedaConStock(vehiculos, cubs, 'S-0');
    assert.equal(l.accion, 'lista'); assert.equal(l.total, 3);
    assert.ok(l.items.every(i => i.tipo === 'cubierta'));
    const mix = resolverBusquedaConStock([{ id: 1, nombre: 'S-0 coche', patente: 'S0AAA', numero: '1' }], cubs, 'S0');
    assert.equal(mix.accion, 'lista');
    assert.deepEqual(mix.items.map(i => i.tipo), ['vehiculo', 'cubierta', 'cubierta', 'cubierta']);
  });
  test('sin coincidencias, vacío y sin cubiertas', () => {
    assert.equal(resolverBusquedaConStock(vehiculos, cubs, 'nada').accion, 'ninguno');
    assert.equal(resolverBusquedaConStock(vehiculos, cubs, '  ').accion, 'vacio');
    const r = resolverBusquedaConStock(vehiculos, [], 'DEMO001');
    assert.equal(r.accion, 'abrir'); assert.equal(r.vehiculo.id, 10);
    assert.equal(resolverBusquedaConStock(vehiculos, null, 'S-001').accion, 'ninguno');
  });
});
