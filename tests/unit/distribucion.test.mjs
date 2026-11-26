import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISTRIBUCIONES, OTRA_DISTRIBUCION, buscarDistribucion, tipoRuedasDe, detalleEjes, etiquetaDistribucion, textoOpcion, textoRuedas, tipoLayout, distribucionActual, validarCambioDistribucion, traducirErrorDistribucion, SERVICIOS, validarCambioServicio, traducirErrorServicio,
} from '../../assets/js/domain/distribucion.js';

const leer = ruta => readFileSync(new URL(ruta, import.meta.url), 'utf8');

describe('catálogo de distribuciones', () => {
  test('ejes y ruedas de cada código (de adelante hacia atrás; S = 2 neumáticos, D = 4)', () => {
    assert.deepEqual(DISTRIBUCIONES.map(d => [d.id, d.ejes, d.ruedas]), [
      ['4x2', 'SD', 6], ['6x2', 'SDS', 8], ['6x4', 'SDD', 10], ['8x2', 'SSDS', 10], ['8x4', 'SSDD', 12],
    ]);
  });
  test('el código «otra» no es de la base: no está en el catálogo', () => {
    assert.equal(buscarDistribucion(OTRA_DISTRIBUCION), null);
    assert.equal(buscarDistribucion('4x4'), null);
    assert.equal(buscarDistribucion(null), null);
  });
  test('tipo de ruedas derivado: hasta 10 ruedas es 10; más, 16', () => {
    assert.deepEqual(DISTRIBUCIONES.map(d => tipoRuedasDe(d.id)), [10, 10, 10, 10, 16]);
    assert.equal(tipoRuedasDe('otra'), null);
  });
  test('textos', () => {
    const d = buscarDistribucion('6x2');
    assert.equal(detalleEjes(d), 'simple, doble, simple');
    assert.equal(etiquetaDistribucion(d), '6x2 · 8 ruedas');
    assert.equal(textoOpcion(d), '6x2 · 8 ruedas (simple, doble, simple) · bus convencional');
  });
  test('alias de bus solo en el texto: 8x2 es «bus doble piso»; el resto, sin alias', () => {
    assert.equal(textoOpcion(buscarDistribucion('8x2')), '8x2 · 10 ruedas (simple, simple, doble, simple) · bus doble piso');
    assert.equal(textoOpcion(buscarDistribucion('4x2')), '4x2 · 6 ruedas (simple, doble)');
    assert.equal(textoOpcion(buscarDistribucion('6x4')), '6x4 · 10 ruedas (simple, doble, doble)');
  });
  test('textoRuedas: la distribución si la tiene; si no, el tipo de siempre', () => {
    assert.equal(textoRuedas({ distribucion: '8x4', tipo_ruedas: 16 }), '8x4 · 12 ruedas');
    assert.equal(textoRuedas({ distribucion: null, tipo_ruedas: 10 }), '10 ruedas');
    assert.equal(textoRuedas({ tipo_ruedas: 16 }), '16 ruedas');
  });
});

// El catálogo vive en tres lugares (base, API y panel). Si uno cambia sin los otros, la numeración deja de coincidir.
describe('el catálogo coincide con la base y con la API', () => {
  const esperado = DISTRIBUCIONES.map(d => `${d.id}:${d.ruedas}`).join(',');

  test('public.distribucion_ruedas (migración)', () => {
    const sql = leer('../../supabase/migrations/20261122000000_distribucion_vehiculo.sql');
    const cuerpo = sql.slice(sql.indexOf('create or replace function public.distribucion_ruedas'));
    const casos = [...cuerpo.slice(0, cuerpo.indexOf('$$;')).matchAll(/when '([0-9]x[0-9])' then (\d+)/g)].map(m => `${m[1]}:${m[2]}`);
    assert.equal(casos.join(','), esperado);
  });

  test('api-proveedor/distribuciones.ts', () => {
    const ts = leer('../../supabase/functions/api-proveedor/distribuciones.ts');
    const lista = ts.match(/DISTRIBUCIONES = \[([^\]]*)\]/)[1];
    const ids = [...lista.matchAll(/'([0-9]x[0-9])'/g)].map(m => m[1]);
    assert.equal(ids.join(','), DISTRIBUCIONES.map(d => d.id).join(','));
  });
});

describe('cambiar la distribución de un vehículo', () => {
  test('tipoLayout: el código si es del catálogo; si no, tipo_ruedas', () => {
    assert.equal(tipoLayout({ distribucion: '6x2', tipo_ruedas: 10 }), '6x2');
    assert.equal(tipoLayout({ distribucion: null, tipo_ruedas: 16 }), 16);
    assert.equal(tipoLayout({ distribucion: 'otra', tipo_ruedas: 10 }), 10);
    assert.equal(tipoLayout(null), null);
  });
  test('distribucionActual solo preselecciona una del catálogo', () => {
    assert.equal(distribucionActual({ distribucion: '6x4' }), '6x4');
    assert.equal(distribucionActual({ distribucion: null }), '');
  });
  test('validarCambioDistribucion: igual que al crear', () => {
    assert.equal(validarCambioDistribucion({ vehiculoId: 1, distribucion: '' }).ok, false);
    assert.equal(validarCambioDistribucion({ vehiculoId: null, distribucion: '6x2' }).ok, false);
    assert.equal(validarCambioDistribucion({ vehiculoId: 1, distribucion: '2x2' }).ok, false);
    assert.equal(validarCambioDistribucion({ vehiculoId: 1, distribucion: 'otra', tipoRuedas: '12' }).ok, false);
    assert.deepEqual(validarCambioDistribucion({ vehiculoId: 1, distribucion: '6x2', tipoRuedas: '16' }).params,
      { p_vehiculo_id: 1, p_distribucion: '6x2', p_tipo_ruedas: null });
    assert.deepEqual(validarCambioDistribucion({ vehiculoId: 1, distribucion: 'otra', tipoRuedas: '16' }).params,
      { p_vehiculo_id: 1, p_distribucion: 'otra', p_tipo_ruedas: 16 });
  });
  test('traducirErrorDistribucion muestra el rechazo por posiciones montadas tal cual', () => {
    const m = 'la distribución tiene 10 ruedas y hay neumáticos montados en las posiciones 11: retirarlos o elegir otra distribución';
    assert.match(traducirErrorDistribucion({ code: '23514', message: m }), /^La distribución tiene 10 ruedas .*posiciones 11/);
    assert.equal(traducirErrorDistribucion({ code: '42501' }), 'Sin permiso para cambiar este vehículo');
  });
});

describe('cambiar el servicio del vehículo (bus o camión)', () => {
  test('validarCambioServicio: camión o bus; «Sin definir» se guarda como null', () => {
    assert.deepEqual(SERVICIOS, ['camion', 'bus']);
    assert.deepEqual(validarCambioServicio({ vehiculoId: 1, servicio: 'bus' }).params, { p_vehiculo_id: 1, p_servicio: 'bus' });
    assert.deepEqual(validarCambioServicio({ vehiculoId: 1, servicio: '' }).params, { p_vehiculo_id: 1, p_servicio: null });
    assert.equal(validarCambioServicio({ vehiculoId: 1, servicio: 'camión' }).ok, false);
    assert.equal(validarCambioServicio({ vehiculoId: null, servicio: 'bus' }).ok, false);
  });
  test('traducirErrorServicio: sin permiso, valor no válido y, por defecto, reintentar (sin texto crudo)', () => {
    assert.equal(traducirErrorServicio({ code: '42501' }), 'Sin permiso para cambiar el servicio de este vehículo');
    assert.equal(traducirErrorServicio({ code: '23514' }), 'El servicio no es válido. Elegir camión o bus');
    assert.equal(traducirErrorServicio({ code: '08006', message: 'connection failure' }), 'No se pudo guardar el servicio. Reintentar');
  });
});
