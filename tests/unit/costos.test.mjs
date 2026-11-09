// Costos y CPK (domain/costos.js): presentación de v_costo_cubierta, validación del formulario, errores de la RPC,
// filas del reporte por grupo y CSV.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumenCosto, indexarCostos, puedeGestionarCostos, fmtMonto, fmtCpk, parseMonto, validarCosto, traducirErrorCosto,
  filasCpk, cpkCsv, etiquetaConcepto, MUESTRA_MINIMA, AVISO_COMPARAR, NOTA_SIN_KM, SIN_COSTOS, ERROR_GENERICO_COSTO,
} from '../../assets/js/domain/costos.js';
import { NOTA_FALTAN_LECTURAS, NOTA_SIN_DATO } from '../../assets/js/domain/km-cubierta.js';

const fila = (o = {}) => ({
  neumatico_id: 7, vehiculo_id: 1, tiene_costo: true, moneda: 'UYU', monedas: ['UYU'], moneda_mixta: false,
  costo_total: 1500, costo_por_concepto: { compra: 1000, reparacion: 200, recauchutado: 300 },
  km_totales: 10000, km_confiable: true, cpk: 0.15, cpk_provisional: null, ...o,
});

describe('resumenCosto', () => {
  test('datos completos: costo, CPK y desglose ordenado, sin nota', () => {
    const r = resumenCosto(fila());
    assert.equal(r.disponible, true);
    assert.equal(r.total, 1500);
    assert.equal(r.textoCosto, 'UYU 1.500,00');
    assert.equal(r.textoCpk, 'UYU 0,150 por km');
    assert.equal(r.estimado, false);
    assert.equal(r.nota, null);
    assert.deepEqual(r.porConcepto.map(c => c.id), ['compra', 'reparacion', 'recauchutado']);
    assert.equal(r.porConcepto[0].label, 'Compra');
  });
  test('sin fila (vista no disponible o perfil sin acceso): no disponible, sin inventar valores', () => {
    for (const f of [null, undefined]) {
      const r = resumenCosto(f);
      assert.equal(r.disponible, false);
      assert.equal(r.total, null);
      assert.equal(r.cpk, null);
    }
  });
  test('sin ningún costo: «Sin costos registrados», nunca 0', () => {
    const r = resumenCosto(fila({ tiene_costo: false, costo_total: null, costo_por_concepto: null, moneda: null, cpk: null }));
    assert.equal(r.tieneCosto, false);
    assert.equal(r.total, null);
    assert.equal(r.textoCosto, SIN_COSTOS);
    assert.equal(r.textoCpk, 'Sin dato');
  });
  test('moneda mixta: sin total ni CPK y nota', () => {
    const r = resumenCosto(fila({ moneda: null, moneda_mixta: true, costo_total: null, costo_por_concepto: null, cpk: null }));
    assert.equal(r.mixta, true);
    assert.equal(r.total, null);
    assert.equal(r.cpk, null);
    assert.equal(r.textoCosto, 'Monedas mixtas');
    assert.match(r.nota, /monedas distintas/);
  });
  test('km no confiables con CPK provisional: se muestra como estimado con la nota de odómetro', () => {
    const r = resumenCosto(fila({ km_confiable: false, cpk: null, cpk_provisional: 1 }));
    assert.equal(r.estimado, true);
    assert.equal(r.cpk, 1);
    assert.equal(r.nota, NOTA_FALTAN_LECTURAS);
    assert.equal(r.textoCpk, 'UYU 1,000 por km');
  });
  test('km NULL: «Sin dato» con la nota de odómetro', () => {
    const r = resumenCosto(fila({ km_totales: null, km_confiable: false, cpk: null, cpk_provisional: null }));
    assert.equal(r.cpk, null);
    assert.equal(r.textoCpk, 'Sin dato');
    assert.equal(r.nota, NOTA_SIN_DATO);
  });
  test('0 km confiables: sin CPK (no divide por cero) y nota propia', () => {
    const r = resumenCosto(fila({ km_totales: 0, cpk: null }));
    assert.equal(r.cpk, null);
    assert.equal(r.textoCpk, 'Sin dato');
    assert.equal(r.nota, NOTA_SIN_KM);
  });
  test('CPK 0 (costo 0) es un dato, no una ausencia', () => {
    const r = resumenCosto(fila({ costo_total: 0, cpk: 0, costo_por_concepto: { compra: 0 } }));
    assert.equal(r.cpk, 0);
    assert.equal(r.textoCpk, 'UYU 0,000 por km');
    assert.equal(r.nota, null);
  });
  test('números como texto (numeric de PostgREST) se interpretan', () => {
    const r = resumenCosto(fila({ costo_total: '1500.00', cpk: '0.150000', costo_por_concepto: { compra: '1500.00' } }));
    assert.equal(r.total, 1500);
    assert.equal(r.cpk, 0.15);
  });
  test('otra moneda se muestra tal cual', () => {
    assert.equal(resumenCosto(fila({ moneda: 'USD', costo_total: 200 })).textoCosto, 'USD 200,00');
  });
  test('conceptos desconocidos o nulos en el desglose se descartan', () => {
    const r = resumenCosto(fila({ costo_por_concepto: { compra: 10, raro: 5, otro: null } }));
    assert.deepEqual(r.porConcepto.map(c => c.id), ['compra']);
  });
});

describe('indexarCostos, permisos y formatos', () => {
  test('indexa por neumatico_id y tolera null', () => {
    assert.equal(indexarCostos([fila()]).get(7).costo_total, 1500);
    assert.equal(indexarCostos(null).size, 0);
  });
  test('quién gestiona costos: admin y cliente global; no sucursal ni sin rol', () => {
    assert.equal(puedeGestionarCostos({ admin: true }), true);
    assert.equal(puedeGestionarCostos({ cliente: true, sucursalId: null }), true);
    assert.equal(puedeGestionarCostos({ cliente: true, sucursalId: 12 }), false);
    assert.equal(puedeGestionarCostos({ cliente: true, sucursalId: 0 }), false);
    assert.equal(puedeGestionarCostos({}), false);
    assert.equal(puedeGestionarCostos(), false);
  });
  test('fmtMonto y fmtCpk sin dato', () => {
    assert.equal(fmtMonto(null), '—');
    assert.equal(fmtMonto('abc'), '—');
    assert.equal(fmtCpk(undefined), '—');
    assert.equal(fmtMonto(0.5, 'USD'), 'USD 0,50');
  });
  test('etiquetas de concepto', () => {
    assert.equal(etiquetaConcepto('recauchutado'), 'Recauchutado');
    assert.equal(etiquetaConcepto('zzz'), 'zzz');
  });
});

describe('validarCosto', () => {
  const ok = (o = {}) => ({ neumaticoId: 5, concepto: 'compra', monto: '1250,5', moneda: 'usd', fecha: '2026-06-01', notas: ' Factura 12 ', ...o });
  const hoy = { hoy: '2026-06-15' };
  test('caso válido: normaliza moneda, monto y notas', () => {
    const r = validarCosto(ok(), hoy);
    assert.equal(r.ok, true);
    assert.deepEqual(r.args, { p_neumatico_id: 5, p_concepto: 'compra', p_monto: 1250.5, p_fecha: '2026-06-01', p_notas: 'Factura 12', p_moneda: 'USD' });
  });
  test('moneda por omisión UYU, fecha y notas opcionales', () => {
    const r = validarCosto(ok({ moneda: '', fecha: '', notas: '' }), hoy);
    assert.equal(r.args.p_moneda, 'UYU');
    assert.equal(r.args.p_fecha, null);
    assert.equal(r.args.p_notas, null);
  });
  test('monto 0 es válido', () => assert.equal(validarCosto(ok({ monto: '0' }), hoy).ok, true));
  test('rechazos con mensaje', () => {
    const err = (o) => { const r = validarCosto(ok(o), hoy); assert.equal(r.ok, false); return r.error; };
    assert.equal(err({ neumaticoId: '' }), 'Falta el neumático');
    assert.equal(err({ concepto: '' }), 'Elegir el concepto');
    assert.equal(err({ concepto: 'regalo' }), 'Elegir el concepto');
    assert.equal(err({ monto: '' }), 'Falta el monto');
    assert.match(err({ monto: '-1' }), /mayor o igual a 0/);
    assert.match(err({ monto: '1,234' }), /hasta 2 decimales/);
    assert.match(err({ monto: 'abc' }), /mayor o igual a 0/);
    assert.equal(err({ monto: '99999999999' }), 'El monto es demasiado alto');
    assert.match(err({ moneda: 'US' }), /3 letras/);
    assert.match(err({ moneda: 'U5D' }), /3 letras/);
    assert.equal(err({ fecha: '2026-13-40' }), 'La fecha no es válida');
    assert.equal(err({ fecha: '01/06/2026' }), 'La fecha no es válida');
    assert.equal(err({ fecha: '2026-06-16' }), 'La fecha no puede ser futura');
    assert.match(err({ notas: 'x'.repeat(501) }), /hasta 500/);
  });
  test('la fecha de hoy es válida', () => assert.equal(validarCosto(ok({ fecha: '2026-06-15' }), hoy).ok, true));
  test('parseMonto con coma y con punto', () => {
    assert.equal(parseMonto('10,25').valor, 10.25);
    assert.equal(parseMonto('10.25').valor, 10.25);
    assert.equal(parseMonto(' 7 ').valor, 7);
  });
});

describe('traducirErrorCosto', () => {
  test('permiso, inexistente, validaciones y genérico', () => {
    assert.equal(traducirErrorCosto({ code: '42501', message: 'permiso denegado' }), 'Sin permiso para registrar costos');
    assert.equal(traducirErrorCosto({ code: 'P0002', message: 'neumático inexistente' }), 'El neumático ya no existe. Actualizar la lista');
    assert.equal(traducirErrorCosto({ code: '23514', message: 'fecha inválida' }), 'La fecha no es válida');
    assert.equal(traducirErrorCosto({ code: '23514', message: 'moneda inválida: código de 3 letras' }), 'La moneda debe ser un código de 3 letras');
    assert.equal(traducirErrorCosto({ code: '22003', message: 'monto fuera de rango' }), 'El monto no es válido');
    assert.equal(traducirErrorCosto({ code: '23514', message: 'concepto inválido' }), 'Datos del formulario inválidos');
    assert.equal(traducirErrorCosto({ code: '08006', message: 'boom' }), ERROR_GENERICO_COSTO);
    assert.equal(traducirErrorCosto(null), ERROR_GENERICO_COSTO);
  });
});

describe('filasCpk y cpkCsv', () => {
  const g = (o = {}) => ({ grupo: 'marca', clave: 'Beta', cliente_id: null, moneda: 'UYU', n_neumaticos: 2, n_sin_km: 0, km_totales: 11000, costo_total: 1100, cpk: 0.1, muestra_baja: true, ...o });
  test('usa el CPK ponderado de la base; no promedia', () => {
    // Dos neumáticos con CPK 1,0 y 0,01: el promedio sería 0,505; el ponderado es 1100 / 11000.
    const [r] = filasCpk([g()]);
    assert.equal(r.cpk, 0.1);
    assert.equal(r.textoCpk, 'UYU 0,100 por km');
    assert.equal(r.km, 11000);
    assert.equal(r.n, 2);
  });
  test('muestra baja: la que marca la base y toda con menos de 5', () => {
    assert.equal(MUESTRA_MINIMA, 5);
    assert.equal(filasCpk([g({ n_neumaticos: 5, muestra_baja: false })])[0].muestraBaja, false);
    assert.equal(filasCpk([g({ n_neumaticos: 4, muestra_baja: false })])[0].muestraBaja, true);
    assert.equal(filasCpk([g({ n_neumaticos: 9, muestra_baja: true })])[0].muestraBaja, true);
  });
  test('grupo sin km confiables: «Sin dato» y 0 km (no un CPK inventado)', () => {
    const [r] = filasCpk([g({ n_neumaticos: 0, n_sin_km: 3, km_totales: 0, costo_total: null, cpk: null })]);
    assert.equal(r.cpk, null);
    assert.equal(r.textoCpk, 'Sin dato');
    assert.equal(r.costo, null);
    assert.equal(r.sinKm, 3);
  });
  test('vacío y null', () => {
    assert.deepEqual(filasCpk([]), []);
    assert.deepEqual(filasCpk(null), []);
  });
  test('CSV: cabecera, BOM, una fila por grupo y moneda, celdas peligrosas con comilla', () => {
    const csv = cpkCsv([g(), g({ clave: '=SUMA(A1)', moneda: 'USD', cpk: null, muestra_baja: false })]);
    const lineas = csv.replace('﻿', '').trim().split('\r\n');
    assert.equal(csv[0], '﻿');
    assert.equal(lineas[0], 'grupo,clave,moneda,n_neumaticos,n_sin_km,km_totales,costo_total,cpk,muestra_baja');
    assert.equal(lineas[1], 'marca,Beta,UYU,2,0,11000,1100,0.1,true');
    assert.equal(lineas[2], "marca,'=SUMA(A1),USD,2,0,11000,1100,,false");
  });
  test('el aviso para comparar marcas está definido', () => {
    assert.equal(AVISO_COMPARAR, 'Comparar marcas sin ajustar por eje, carga y época puede engañar.');
  });
});
