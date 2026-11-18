import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISTRIBUCIONES, OTRA_DISTRIBUCION, buscarDistribucion, tipoRuedasDe, detalleEjes, etiquetaDistribucion, textoOpcion, textoRuedas,
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
    assert.equal(textoOpcion(d), '6x2 · 8 ruedas (simple, doble, simple)');
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
