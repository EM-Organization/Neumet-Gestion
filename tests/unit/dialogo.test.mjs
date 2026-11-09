// Tests de domain/dialogo.js y del uso de confirmDialog en el código. Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configDialogo } from '../../assets/js/domain/dialogo.js';

describe('configDialogo', () => {
  test('destructivo: botón rojo e icono de papelera', () => {
    const c = configDialogo('Eliminar cliente', '¿Eliminar?', 'Eliminar', true);
    assert.equal(c.okLabel, 'Eliminar');
    assert.equal(c.okClass, 'danger');
    assert.equal(c.iconClass, 'danger');
    assert.equal(c.icono, 'papelera');
  });
  test('rotación: botón primario, icono neutro de flechas y sin papelera', () => {
    const c = configDialogo('Rotar neumáticos', 'msg', 'Rotar', false);
    assert.equal(c.okLabel, 'Rotar');
    assert.equal(c.okClass, 'primary');
    assert.equal(c.iconClass, 'neutral');
    assert.equal(c.icono, 'intercambio');
  });
  test('otras acciones no destructivas usan icono de información, no las flechas', () => {
    for (const l of ['Continuar', 'Mover']) {
      const c = configDialogo('t', 'm', l, false);
      assert.equal(c.icono, 'info'); assert.equal(c.okClass, 'primary'); assert.equal(c.iconClass, 'neutral');
    }
  });
  test('destructivo con la etiqueta «Rotar» sigue con papelera', () => assert.equal(configDialogo('t', 'm', 'Rotar', true).icono, 'papelera'));
  test('sin etiqueta o con etiqueta vacía falla (no hay default «Eliminar»)', () => {
    for (const l of [undefined, null, '', '   ', 5]) assert.throws(() => configDialogo('t', 'm', l, false), /etiqueta/);
  });
  test('sin intención explícita falla', () => {
    for (const d of [undefined, null, 'true', 1]) assert.throws(() => configDialogo('t', 'm', 'Eliminar', d), /destructiva/);
  });
  test('título o mensaje nulos no rompen', () => {
    const c = configDialogo(null, undefined, 'Mover', false);
    assert.equal(c.title, ''); assert.equal(c.msg, '');
  });
});

// Recorre assets/js y verifica que cada llamada a confirmDialog pase etiqueta y booleano.
function archivos(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.js') ? [p] : [];
  });
}
// Argumentos de nivel superior de la llamada que empieza en el paréntesis `i` (respeta comillas, plantillas y anidación).
function argumentos(src, i) {
  const args = []; let prof = 0, ini = i + 1, q = null;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if ('([{'.includes(ch)) prof++;
    else if (')]}'.includes(ch)) { prof--; if (prof === 0) { args.push(src.slice(ini, k).trim()); return args; } }
    else if (ch === ',' && prof === 1) { args.push(src.slice(ini, k).trim()); ini = k + 1; }
  }
  return args;
}

describe('llamadas a confirmDialog en el código fuente', () => {
  const llamadas = [];
  for (const f of archivos('assets/js')) {
    if (f.endsWith('core/ui.js')) continue; // definición
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/confirmDialog\(/g)) {
      llamadas.push({ f, args: argumentos(src, m.index + m[0].length - 1) });
    }
  }
  test('hay llamadas que revisar', () => assert.ok(llamadas.length >= 10));
  test('todas pasan etiqueta literal e intención booleana literal', () => {
    for (const { f, args } of llamadas) {
      assert.equal(args.length, 4, `${f}: confirmDialog debe recibir título, mensaje, etiqueta y danger`);
      assert.match(args[2], /^['"][^'"]+['"]$/, `${f}: etiqueta literal`);
      assert.match(args[3], /^(true|false)$/, `${f}: danger literal`);
    }
  });
  test('los intercambios y movimientos no son destructivos', () => {
    for (const { f, args } of llamadas) {
      if (/Rotar|Mover|Continuar|Retirar a stock/.test(args[2])) assert.equal(args[3], 'false', f);
      if (/^['"]Eliminar['"]$/.test(args[2])) assert.equal(args[3], 'true', f);
    }
  });
});
