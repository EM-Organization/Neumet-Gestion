// Rendimiento de cubiertas en Stock y su CSV (domain/rendimiento-cubierta.js): columna de la lista y exportación.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rendimientoFila, filasCubiertasCsv, cubiertasCsv, cabeceraCubiertasCsv, COLUMNAS_CSV, COLUMNAS_CSV_SIN_COSTOS,
  COLUMNAS_COMPRA, SIN_DATO,
} from '../../assets/js/domain/rendimiento-cubierta.js';
import { NOTA_FALTAN_LECTURAS, NOTA_SIN_DATO } from '../../assets/js/domain/km-cubierta.js';
import { nombrePosicion } from '../../assets/js/domain/posicion.js';

// CSV de una línea por registro: entiende comillas dobles (RFC 4180) y el BOM inicial.
function parsearCsv(texto) {
  const sin = texto.replace(/^\uFEFF/, '');
  const filas = [];
  for (const linea of sin.split('\r\n').filter(l => l !== '')) {
    const celdas = [];
    let celda = '';
    let citado = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (citado) {
        if (c === '"' && linea[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') citado = false; else celda += c;
      } else if (c === '"') citado = true;
      else if (c === ',') { celdas.push(celda); celda = ''; } else celda += c;
    }
    celdas.push(celda);
    filas.push(celdas);
  }
  return filas;
}

const CPK_TOTAL_1 = 1400 / 22000; // 0.0636..., la base lo entrega sin redondear
const POSICION_3 = nombrePosicion(3, 10);

const neumaticos = [
  { id: 1, numero_quema: 'R91-1', idneumatico: 'CB-1-0001', marca: 'Michelin', modelo: 'X', vida: 0, estado: 'montado',
    vehiculo_id: 10, posicion: 3, vehiculos: { nombre: 'Camión 01', tipo_ruedas: 10 } },
  { id: 2, numero_quema: 'S-001', idneumatico: null, marca: 'Bridgestone, "R268"', modelo: null, vida: 0, estado: 'almacenado',
    vehiculo_id: null, posicion: null, vehiculos: null },
  { id: 3, numero_quema: '=1+1', idneumatico: null, marca: 'Pirelli', modelo: 'G', vida: 1, estado: 'reparacion',
    vehiculo_id: null, posicion: null, vehiculos: null },
  { id: 4, numero_quema: 'S-004', idneumatico: null, marca: 'Goodyear', modelo: 'G661', vida: 0, estado: 'baja',
    vehiculo_id: null, posicion: null, vehiculos: null },
  { id: 5, numero_quema: 'S-005', idneumatico: null, marca: 'Dunlop', modelo: null, vida: 3, estado: 'almacenado',
    vehiculo_id: null, posicion: null, vehiculos: null },
];
const km = [
  { neumatico_id: 1, km_previos: 0, km_totales: 22000, km_confiable: true },
  { neumatico_id: 2, km_previos: 0, km_totales: 1200, km_confiable: false, tramos_sin_dato: 1 },
];
const costos = [
  { neumatico_id: 1, moneda: 'UYU', moneda_mixta: false, costo_total: 1400, cpk_carcasa: CPK_TOTAL_1 },
  { neumatico_id: 3, moneda: null, moneda_mixta: true, costo_total: null, cpk_carcasa: null },
];
const vidas = [
  { neumatico_id: 1, vida: 0, moneda: 'UYU', km_recorridos: 10000, km_confiable: true, cpk: 1000 / 10000 },
  { neumatico_id: 1, vida: 1, moneda: 'UYU', km_recorridos: 12000, km_confiable: true, cpk: 400 / 12000 },
  { neumatico_id: 3, vida: 1, moneda: null, km_recorridos: 5000, km_confiable: false, cpk: null },
];
const enReca = new Set([5]);

const fila = (filas, quema) => filas.find(f => f[COLUMNAS_CSV.indexOf('quema')] === quema);

describe('Columna Rendimiento de la lista de Stock', () => {
  test('km totales en miles y CPK de carcasa con la moneda', () => {
    const r = rendimientoFila(km[0], costos[0], { conCostos: true });
    assert.equal(r.kmTexto, '22.000 km');
    assert.equal(r.kmNota, null);
    assert.equal(r.cpkTexto, 'UYU 0,064 por km');
  });

  test('sin fila de km: «Sin dato» y la nota de la vista', () => {
    const r = rendimientoFila(undefined, undefined, { conCostos: true });
    assert.equal(r.kmTexto, SIN_DATO);
    assert.equal(r.kmNota, NOTA_SIN_DATO);
    assert.equal(r.cpkTexto, SIN_DATO);
  });

  test('km no confiables: lleva «aprox.» en el texto y la nota en la celda', () => {
    const r = rendimientoFila(km[1], undefined, { conCostos: false });
    assert.equal(r.kmTexto, '1.200 km aprox.');
    assert.equal(r.kmNota, NOTA_FALTAN_LECTURAS);
  });

  test('sin permiso de costos (sucursal): no hay texto de CPK', () => {
    const r = rendimientoFila(km[0], costos[0], { conCostos: false });
    assert.equal(r.cpkTexto, null);
  });

  test('con permiso, sin CPK en la base: «Sin dato»', () => {
    assert.equal(rendimientoFila(km[0], costos[1], { conCostos: true }).cpkTexto, SIN_DATO);
  });
});

describe('CSV de cubiertas', () => {
  test('encabezado exacto con costos y sin costos', () => {
    assert.deepEqual(COLUMNAS_CSV, ['cpk_total', 'moneda', 'km_total', 'km_vida_0', 'km_vida_1', 'km_vida_2', 'km_vida_3',
      'cpk_vida_0', 'cpk_vida_1', 'cpk_vida_2', 'cpk_vida_3', 'quema', 'idneumatico', 'marca', 'modelo', 'vida', 'situacion',
      'vehiculo', 'posicion', 'km_confiable', 'medida', 'dot', 'profundidad_inicial_mm', 'fecha_compra', 'proveedor', 'factura',
      'soporte', 'ubicacion', 'precio_compra', 'precio_por_mm']);
    const sin = parsearCsv(cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: false, enReca }))[0];
    assert.deepEqual(sin, COLUMNAS_CSV_SIN_COSTOS);
    assert.deepEqual(parsearCsv(cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca }))[0], COLUMNAS_CSV);
  });

  test('sin permiso de costos no lleva columnas cpk_, moneda ni km_vida_ (ni sus valores)', () => {
    const texto = cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: false, enReca });
    const encabezado = parsearCsv(texto)[0];
    assert.equal(encabezado.some(c => /^cpk_|^moneda$|^km_vida_/.test(c)), false);
    assert.doesNotMatch(texto, /0\.1|UYU/);
  });

  test('cifras con punto decimal y 6 decimales, km en número, columnas vacías y no 0', () => {
    const r = fila(filasCubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca }), 'R91-1');
    const col = n => r[COLUMNAS_CSV.indexOf(n)];
    assert.equal(col('cpk_total'), 0.063636);
    assert.equal(col('moneda'), 'UYU');
    assert.equal(col('km_total'), 22000);
    assert.equal(col('km_vida_0'), 10000);
    assert.equal(col('km_vida_1'), 12000);
    assert.equal(col('km_vida_2'), null);
    assert.equal(col('km_vida_3'), null);
    assert.equal(col('cpk_vida_0'), 0.1);
    assert.equal(col('cpk_vida_1'), 0.033333);
    assert.equal(col('cpk_vida_2'), null);
    assert.equal(col('km_confiable'), true);
    const csv = cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca });
    assert.match(csv, /\r\n0\.063636,UYU,22000,10000,12000,,,0\.1,0\.033333,,,R91-1,CB-1-0001,/);
  });

  test('situación, vehículo y posición: montada, en stock, recauchutado, baja y en reparación', () => {
    const filas = filasCubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca });
    const ver = (quema, campo) => fila(filas, quema)[COLUMNAS_CSV.indexOf(campo)];
    assert.equal(ver('R91-1', 'situacion'), 'Montada');
    assert.equal(ver('R91-1', 'vehiculo'), 'Camión 01');
    assert.equal(ver('R91-1', 'posicion'), POSICION_3);
    assert.equal(ver('S-001', 'situacion'), 'En stock');
    assert.equal(ver('S-001', 'vehiculo'), '');
    assert.equal(ver('S-001', 'posicion'), '');
    assert.equal(ver('=1+1', 'situacion'), 'En reparación');
    assert.equal(ver('S-004', 'situacion'), 'Baja');
    assert.equal(ver('S-005', 'situacion'), 'En recauchutado');
  });

  test('comillas y comas se escapan; una fórmula se neutraliza como en csvCell', () => {
    const texto = cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca });
    assert.match(texto, /"Bridgestone, ""R268"""/);
    assert.equal(parsearCsv(texto).some(f => f.includes('\'=1+1')), true);
  });

  test('sin fila de km: km_total y km_confiable vacíos', () => {
    const f = fila(filasCubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca }), 'S-004');
    assert.equal(f[COLUMNAS_CSV.indexOf('km_total')], null);
    assert.equal(f[COLUMNAS_CSV.indexOf('km_confiable')], null);
    const csv = parsearCsv(cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca }));
    const linea = csv.find(c => c[COLUMNAS_CSV.indexOf('quema')] === 'S-004');
    assert.equal(linea[COLUMNAS_CSV.indexOf('km_total')], '');
    assert.equal(linea[COLUMNAS_CSV.indexOf('km_confiable')], '');
  });

  test('moneda mixta: moneda, cpk_total y cpk_vida vacíos', () => {
    const csv = parsearCsv(cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: true, enReca }));
    const linea = csv.find(c => c[COLUMNAS_CSV.indexOf('quema')] === '\'=1+1');
    assert.equal(linea[COLUMNAS_CSV.indexOf('moneda')], '');
    assert.equal(linea[COLUMNAS_CSV.indexOf('cpk_total')], '');
    assert.equal(linea[COLUMNAS_CSV.indexOf('cpk_vida_1')], '');
    assert.equal(linea[COLUMNAS_CSV.indexOf('km_vida_1')], '');
  });

  test('una cubierta sin datos de costo ni de km sale igual que una nueva: todas las celdas de costo vacías', () => {
    const csv = parsearCsv(cubiertasCsv([neumaticos[3]], [], [], [], { conCostos: true, enReca: new Set() }));
    assert.equal(csv.length, 2);
    assert.deepEqual(csv[1].slice(0, 4), ['', '', '', '']);
  });

  test('las cabeceras terminan en las columnas de compra (con costos, además precio_compra y precio_por_mm)', () => {
    assert.deepEqual(COLUMNAS_CSV_SIN_COSTOS.slice(-COLUMNAS_COMPRA.length), COLUMNAS_COMPRA);
    assert.deepEqual(COLUMNAS_CSV.slice(-2), ['precio_compra', 'precio_por_mm']);
    const sin = parsearCsv(cubiertasCsv(neumaticos, km, costos, vidas, { conCostos: false, enReca }))[0];
    assert.equal(sin.some(c => c.startsWith('precio')), false, 'sin costos no hay columnas de precio');
  });

  test('dot, factura y medida se exportan; las celdas sin dato quedan vacías, sin null ni undefined', () => {
    const compra = [
      { ...neumaticos[0], dot: '0825', factura: 'A-1', medida: '11R22.5', profundidad_inicial_mm: 16, sucursal_id: 1, fecha_compra: '2026-03-02' },
      { ...neumaticos[1] },
    ];
    const sucursales = [{ id: 1, nombre: 'Montevideo' }];
    const filas = filasCubiertasCsv(compra, km, costos, vidas, { conCostos: true, enReca, sucursales });
    const ver = (quema, campo) => fila(filas, quema)[COLUMNAS_CSV.indexOf(campo)];
    assert.equal(ver('R91-1', 'dot'), '0825');
    assert.equal(ver('R91-1', 'factura'), 'A-1');
    assert.equal(ver('R91-1', 'medida'), '11R22.5');
    assert.equal(ver('R91-1', 'profundidad_inicial_mm'), 16);
    assert.equal(ver('R91-1', 'ubicacion'), 'Montevideo');
    assert.equal(ver('S-001', 'dot'), '');
    assert.equal(ver('S-001', 'factura'), '');
    assert.equal(ver('S-001', 'profundidad_inicial_mm'), '');
    assert.equal(ver('S-001', 'ubicacion'), 'Sin sucursal');
    const texto = cubiertasCsv(compra, km, costos, vidas, { conCostos: true, enReca, sucursales });
    assert.doesNotMatch(texto, /null|undefined/);
  });

  test('precio_por_mm con el umbral del cliente a 2 decimales; sin umbral o sin dato, vacío', () => {
    const conPrecio = [{ ...neumaticos[0], precio_unidad: 450000, profundidad_inicial_mm: 16 }];
    const ver = (umbral, campo) => fila(filasCubiertasCsv(conPrecio, km, costos, vidas, { conCostos: true, enReca, umbral }), 'R91-1')[COLUMNAS_CSV.indexOf(campo)];
    assert.equal(ver(2, 'precio_compra'), 450000);
    assert.equal(ver(2, 'precio_por_mm'), 32142.86);
    assert.equal(ver(null, 'precio_por_mm'), null);
    assert.equal(ver(16, 'precio_por_mm'), null, 'sin mm por gastar');
  });

  test('vidas 4 o más suman su par km_vida_N, cpk_vida_N tras cpk_vida_3 y el resto de columnas no cambia', () => {
    const vidasMas = [...vidas, { neumatico_id: 5, vida: 5, moneda: 'UYU', km_recorridos: 8000, km_confiable: true, cpk: 800 / 8000 }];
    const cab = cabeceraCubiertasCsv({ conCostos: true, vidas: vidasMas });
    const i = n => cab.indexOf(n);
    assert.deepEqual(cab.slice(i('cpk_vida_3') + 1, i('quema')), ['km_vida_4', 'cpk_vida_4', 'km_vida_5', 'cpk_vida_5']);
    assert.equal(cab.length, COLUMNAS_CSV.length + 4);
    const csv = parsearCsv(cubiertasCsv(neumaticos, km, costos, vidasMas, { conCostos: true, enReca }));
    const linea = csv.find(c => c[i('quema')] === 'S-005');
    assert.equal(linea.length, cab.length, 'todas las filas tienen las columnas del encabezado');
    assert.equal(linea[i('km_vida_5')], '8000');
    assert.equal(linea[i('cpk_vida_5')], '0.1');
    assert.equal(linea[i('km_vida_4')], '');
    assert.equal(linea[i('km_total')], '');
  });

  test('sin vidas 4 o más la cabecera es la de siempre; sin costos nunca hay vidas extra', () => {
    assert.deepEqual(cabeceraCubiertasCsv({ conCostos: true, vidas }), COLUMNAS_CSV);
    const vidasMas = [...vidas, { neumatico_id: 5, vida: 5, km_recorridos: 8000, km_confiable: true, cpk: 0.1 }];
    assert.deepEqual(cabeceraCubiertasCsv({ conCostos: false, vidas: vidasMas }), COLUMNAS_CSV_SIN_COSTOS);
  });
});
