import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  posicionesLibres, siguienteLibre, etiquetaPosicion, cubiertasParaMontar, validarMontaje, validarRetiro,
  traducirErrorMontaje, traducirErrorRetiro, DESTINOS_RETIRO, MAX_LISTA,
} from '../../assets/js/domain/montaje.js';
import { layoutRuedas } from '../../assets/js/domain/vehiculo-diagrama.js';

const pos = lista => lista.map(p => p.posicion);

// ── Posiciones libres ──
test('posicionesLibres: un coche sin neumáticos ofrece sus ruedas (10 o 16) y el auxilio al final', () => {
  assert.deepEqual(pos(posicionesLibres([], 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]);
  assert.deepEqual(pos(posicionesLibres([], 16)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 99]);
  assert.deepEqual(pos(posicionesLibres(null, 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]);
  assert.equal(posicionesLibres([], 10).at(-1).auxilio, true);
});

test('posicionesLibres: descuenta las ocupadas, incluido el auxilio', () => {
  assert.deepEqual(pos(posicionesLibres([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10)), [99]);
  assert.deepEqual(pos(posicionesLibres([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99], 10)), []);
  assert.deepEqual(pos(posicionesLibres([2, 99], 10)), [1, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('posicionesLibres: tipo 10 con un neumático en 11..98 se trata como de 16 (igual que el diagrama y la base)', () => {
  assert.deepEqual(pos(posicionesLibres([12], 10)).filter(p => p > 10 && p < 99), [11, 13, 14, 15, 16]);
  assert.deepEqual(pos(posicionesLibres([], 99)).slice(0, 3), [1, 2, 3], 'un tipo desconocido cae a 10');
  assert.equal(pos(posicionesLibres([], 99)).includes(11), false);
});

test('posicionesLibres: coincide con las ruedas vacías del diagrama', () => {
  const ocupadas = [1, 2, 5];
  const vacias = layoutRuedas(ocupadas, 10).ruedas.filter(r => !r.presente).map(r => r.posicion);
  assert.deepEqual(pos(posicionesLibres(ocupadas, 10)).filter(p => p !== 99), vacias);
});

test('siguienteLibre: avanza a la siguiente, da la vuelta y devuelve null sin libres', () => {
  const libres = posicionesLibres([1, 2, 4], 10);
  assert.equal(siguienteLibre(libres, 3).posicion, 5);
  assert.equal(siguienteLibre(libres, 10).posicion, 99);
  assert.equal(siguienteLibre(libres, 99).posicion, 3, 'tras el último vuelve al primero libre');
  assert.equal(siguienteLibre([{ posicion: 3 }], 3), null);
  assert.equal(siguienteLibre([], 1), null);
  assert.equal(siguienteLibre(null, 1), null);
});

test('etiquetaPosicion: nombre en las listas y auxilio', () => {
  assert.equal(etiquetaPosicion({ posicion: 3, etiqueta: 'Eje 2 · izquierda externa', auxilio: false }), 'P3 · Eje 2 · izquierda externa');
  assert.equal(etiquetaPosicion({ posicion: 99, etiqueta: 'Auxilio', auxilio: true }), 'Auxilio');
});

// ── Cubiertas del stock ──
const cubs = [
  { id: 1, numero_quema: 'S-010', marca: 'Michelin', modelo: 'X Multi', condicion: 'nuevo', sucursal_id: null, vehiculo_id: null, estado: 'almacenado' },
  { id: 2, numero_quema: 'S-002', marca: 'Pirelli', modelo: 'FR85', condicion: 'usado', sucursal_id: 5, vehiculo_id: null, estado: 'almacenado' },
  { id: 3, numero_quema: 'S-003', marca: 'Otra', modelo: null, condicion: 'usado', sucursal_id: null, vehiculo_id: 9, estado: 'montado' },
];

test('cubiertasParaMontar: solo almacenadas sin vehículo, filtradas por quema, marca o modelo y en orden natural', () => {
  assert.deepEqual(cubiertasParaMontar(cubs, '').map(c => c.id), [2, 1]);
  assert.deepEqual(cubiertasParaMontar(cubs, 'pirelli').map(c => c.id), [2]);
  assert.deepEqual(cubiertasParaMontar(cubs, 's 010').map(c => c.id), [1]);
  assert.deepEqual(cubiertasParaMontar(cubs, 'fr85').map(c => c.id), [2]);
  assert.deepEqual(cubiertasParaMontar(cubs, 'inexistente'), []);
  assert.deepEqual(cubiertasParaMontar(null, 'x'), []);
  assert.equal(MAX_LISTA > 0, true);
});

// ── Validar montaje ──
const libres = posicionesLibres([1], 10);
const base = { vehiculoId: 7, posicion: 3, libres, origen: 'nuevo', marca: 'Bridgestone', modelo: '', quema: '', kmPrevios: '0',
  fechaCompra: '', precio: '', vida: '0', odometro: '', odometroActual: 1000, cubiertas: cubs, cubiertaId: '', hoy: '2026-11-10' };

test('validarMontaje: cubierta nueva con solo la marca', () => {
  const r = validarMontaje(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 7, p_posicion: 3, p_cubierta_id: null, p_nuevo: { marca: 'Bridgestone', vida: 0, km_previos: 0 }, p_odometro_km: null });
  assert.match(r.resumen, /^P3: entra Bridgestone/);
});

test('validarMontaje: todos los datos, recortados y tipados', () => {
  const r = validarMontaje({ ...base, marca: ' Goodyear ', modelo: ' R249 ', quema: ' q-1 ', kmPrevios: '4500', fechaCompra: '2026-01-10', precio: '450,50', vida: '2', odometro: '1500' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params.p_nuevo, { marca: 'Goodyear', modelo: 'R249', numero_quema: 'q-1', km_previos: 4500, fecha_compra: '2026-01-10', precio: 450.5, vida: 2 });
  assert.equal(r.params.p_odometro_km, 1500);
  assert.match(r.resumen, /quema q-1/);
  assert.match(r.resumen, /odómetro 1500 km/);
});

test('validarMontaje: del stock envía solo el id de la cubierta (sin quema ni km propios)', () => {
  const r = validarMontaje({ ...base, origen: 'stock', cubiertaId: '2', marca: 'ignorada', quema: 'ignorada' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 7, p_posicion: 3, p_cubierta_id: 2, p_nuevo: null, p_odometro_km: null });
  assert.match(r.resumen, /cubierta S-002 \(Pirelli FR85\)/);
});

test('validarMontaje: rechaza cubierta no elegida, ya montada o inexistente', () => {
  assert.match(validarMontaje({ ...base, origen: 'stock', cubiertaId: '' }).error, /Elegir una cubierta/);
  assert.match(validarMontaje({ ...base, origen: 'stock', cubiertaId: '3' }).error, /Elegir una cubierta/, 'una montada no es montable');
  assert.match(validarMontaje({ ...base, origen: 'stock', cubiertaId: '99' }).error, /Elegir una cubierta/);
});

test('validarMontaje: posición no libre, inexistente o sin elegir', () => {
  assert.match(validarMontaje({ ...base, posicion: 1 }).error, /posición libre/, 'P1 está ocupada');
  assert.match(validarMontaje({ ...base, posicion: 11 }).error, /posición libre/, 'tipo 10: no hay P11');
  assert.match(validarMontaje({ ...base, posicion: '' }).error, /posición libre/);
  assert.match(validarMontaje({ ...base, posicion: 'x' }).error, /posición libre/);
  assert.equal(validarMontaje({ ...base, posicion: 99 }).ok, true, 'el auxilio está libre');
  assert.match(validarMontaje({ ...base, posicion: 99 }).resumen, /^auxilio: entra/);
  assert.match(validarMontaje({ ...base, libres: [] }).error, /posición libre/);
});

test('validarMontaje: campos de la cubierta nueva', () => {
  assert.match(validarMontaje({ ...base, marca: '  ' }).error, /Falta la marca/);
  assert.match(validarMontaje({ ...base, marca: 'x'.repeat(61) }).error, /hasta 60/);
  assert.match(validarMontaje({ ...base, modelo: 'x'.repeat(61) }).error, /hasta 60/);
  assert.match(validarMontaje({ ...base, quema: 'q'.repeat(41) }).error, /hasta 40/);
  assert.match(validarMontaje({ ...base, kmPrevios: '-1' }).error, /km/);
  assert.match(validarMontaje({ ...base, kmPrevios: '1.5' }).error, /km/);
  assert.match(validarMontaje({ ...base, kmPrevios: '1e3' }).error, /km/);
  assert.match(validarMontaje({ ...base, precio: '-5' }).error, /precio/i);
  assert.match(validarMontaje({ ...base, precio: 'abc' }).error, /precio/i);
  assert.match(validarMontaje({ ...base, fechaCompra: '2027-01-01' }).error, /futura/);
  assert.match(validarMontaje({ ...base, fechaCompra: '10/01/2026' }).error, /fecha/i);
  assert.match(validarMontaje({ ...base, vida: '4' }).error, /0 a 3/);
  assert.match(validarMontaje({ ...base, vida: '-1' }).error, /0 a 3/);
  assert.match(validarMontaje({ ...base, vida: '1.5' }).error, /0 a 3/);
  assert.equal(validarMontaje({ ...base, vida: '3' }).ok, true);
  assert.equal(validarMontaje({ ...base, vida: '' }).params.p_nuevo.vida, 0, 'vacío = banda original');
});

test('validarMontaje: odómetro no menor al actual y origen desconocido', () => {
  assert.match(validarMontaje({ ...base, odometro: '999' }).error, /no puede ser menor al actual \(1000 km\)/);
  assert.equal(validarMontaje({ ...base, odometro: '1000' }).params.p_odometro_km, 1000);
  assert.match(validarMontaje({ ...base, odometro: '-1' }).error, /odómetro/i);
  assert.equal(validarMontaje({ ...base, odometroActual: null, odometro: '5' }).ok, true);
  assert.match(validarMontaje({ ...base, origen: '' }).error, /origen/);
  assert.equal(validarMontaje(null).ok, false);
  assert.equal(validarMontaje(undefined).ok, false);
});

// ── Validar retiro ──
const neum = { numero_quema: 'Q-1', marca: 'Michelin', modelo: 'X' };
const ret = { vehiculoId: 7, posicion: 3, neum, destino: 'almacenado', motivo: '', sucursalStock: '4', quema: '', odometro: '', odometroActual: 1000, puedeStock: true };

test('validarRetiro: a stock en una sucursal', () => {
  const r = validarRetiro(ret);
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 7, p_posicion: 3, p_destino: 'almacenado', p_motivo: null, p_odometro_km: null, p_sucursal_stock: 4, p_quema: null });
  assert.match(r.resumen, /^P3: sale Michelin X \(stock\)/);
  assert.equal(validarRetiro({ ...ret, sucursalStock: '' }).params.p_sucursal_stock, null, 'sin sucursal');
});

test('validarRetiro: sin quema exige indicarla para volver al stock', () => {
  const sin = { ...ret, neum: { marca: 'X', numero_quema: null } };
  assert.match(validarRetiro(sin).error, /Falta el número de quema/);
  assert.equal(validarRetiro({ ...sin, quema: ' NQ-9 ' }).params.p_quema, 'NQ-9');
  assert.match(validarRetiro({ ...sin, quema: 'q'.repeat(41) }).error, /hasta 40/);
  assert.equal(validarRetiro({ ...sin, destino: 'baja', motivo: 'x' }).ok, true, 'la baja no exige quema');
});

test('validarRetiro: baja exige motivo; reparación y stock no', () => {
  assert.match(validarRetiro({ ...ret, destino: 'baja' }).error, /Falta el motivo de la baja/);
  assert.match(validarRetiro({ ...ret, destino: 'baja', motivo: '   ' }).error, /Falta el motivo/);
  const b = validarRetiro({ ...ret, destino: 'baja', motivo: ' Montaje equivocado ' });
  assert.equal(b.ok, true);
  assert.equal(b.params.p_motivo, 'Montaje equivocado');
  assert.equal(b.params.p_sucursal_stock, null, 'sin sucursal fuera del stock');
  assert.match(b.resumen, /baja: Montaje equivocado/);
  assert.equal(validarRetiro({ ...ret, destino: 'reparacion' }).ok, true);
  assert.match(validarRetiro({ ...ret, destino: 'baja', motivo: 'm'.repeat(201) }).error, /demasiado largo/);
});

test('validarRetiro: sin permiso de stock, destino inválido, odómetro y auxilio', () => {
  assert.match(validarRetiro({ ...ret, puedeStock: false }).error, /no puede usar el stock/);
  assert.equal(validarRetiro({ ...ret, puedeStock: false, destino: 'reparacion' }).ok, true);
  assert.match(validarRetiro({ ...ret, destino: 'reencauche' }).error, /Elegir el destino/);
  assert.match(validarRetiro({ ...ret, destino: '' }).error, /Elegir el destino/);
  assert.match(validarRetiro({ ...ret, odometro: '10' }).error, /no puede ser menor al actual/);
  assert.equal(validarRetiro({ ...ret, odometro: '1200' }).params.p_odometro_km, 1200);
  assert.match(validarRetiro({ ...ret, neum: null }).error, /No hay un neumático/);
  assert.match(validarRetiro({ ...ret, posicion: 99 }).resumen, /^Auxilio: sale/);
  assert.deepEqual(DESTINOS_RETIRO.map(d => d.id), ['almacenado', 'reparacion', 'baja']);
});

// ── Errores ──
test('traducirErrorMontaje: mensajes de negocio y genérico', () => {
  assert.match(traducirErrorMontaje({ code: '42501', message: 'permiso denegado' }), /Sin permiso/);
  assert.match(traducirErrorMontaje({ code: '55000', message: 'la posición 3 ya tiene un neumático' }), /posición ya tiene un neumático/);
  assert.match(traducirErrorMontaje({ code: '55000', message: 'el vehículo ya tiene un neumático de auxilio' }), /auxilio/);
  assert.match(traducirErrorMontaje({ code: 'P0002', message: 'cubierta del stock inexistente o ya montada' }), /ya no está disponible/);
  assert.match(traducirErrorMontaje({ code: '23505', message: 'el número de quema ya está registrado en otro neumático' }), /quema ya está registrado/);
  assert.match(traducirErrorMontaje({ code: '23514', message: 'la posición 11 no existe en un vehículo de 10 ruedas (posiciones 1-10 y auxilio 99)' }), /no existe en este vehículo/);
  assert.match(traducirErrorMontaje({ code: '23514', message: 'el odómetro del vehículo no puede ser menor al actual (1500 km)' }), /actual \(1500 km\)/);
  assert.match(traducirErrorMontaje({ code: '42501', message: 'el stock lo gestiona el perfil global: ingresar el neumático a mano' }), /Sin permiso/);
  assert.match(traducirErrorMontaje({ code: '22023', message: 'campo desconocido: x' }), /Datos del formulario/);
  assert.match(traducirErrorMontaje({ message: 'boom' }), /No se pudo montar/);
  assert.match(traducirErrorMontaje(null), /No se pudo montar/);
});

test('traducirErrorRetiro: mensajes de negocio y genérico', () => {
  assert.match(traducirErrorRetiro({ code: '42501', message: 'permiso denegado' }), /Sin permiso/);
  assert.match(traducirErrorRetiro({ code: 'P0002', message: 'no hay neumático montado en la posición 3 del vehículo' }), /Ya no hay un neumático/);
  assert.match(traducirErrorRetiro({ code: '22023', message: 'el neumático necesita número de quema para volver al stock' }), /número de quema/);
  assert.match(traducirErrorRetiro({ code: '22023', message: 'indicar el motivo de la baja' }), /motivo de la baja/);
  assert.match(traducirErrorRetiro({ code: '53400', message: 'no hay posición libre para guardar el neumático retirado' }), /No hay lugar/);
  assert.match(traducirErrorRetiro({ code: '23505', message: 'el número de quema ya está registrado en otro neumático' }), /quema ya está registrado/);
  assert.match(traducirErrorRetiro({ message: 'boom' }), /No se pudo retirar/);
});
