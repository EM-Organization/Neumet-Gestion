// Los nombres de estado salen de `domain/estado-desgaste.js` (docs/14 §3): ningún módulo de assets/js los repite como literal
// con mayúscula inicial o en mayúsculas (la prosa en minúscula no se verifica).
// Si se cambia `ESTADOS.<id>.texto`, el panel entero debe seguir al cambio; este test lo garantiza por código.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ESTADOS, BUENO_O_POCO } from '../../assets/js/domain/estado-desgaste.js';
import { CAMPOS_UMBRAL } from '../../assets/js/domain/umbrales.js';

const raiz = new URL('../../', import.meta.url).pathname;
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const nombres = Object.values(ESTADOS).map(e => e.texto);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`(${nombres.map(esc).join('|')})|(${nombres.map(n => esc(n.toUpperCase())).join('|')})`);

// Excepciones declaradas (assets/js/README.md): vehiculo-diagrama.js no puede importar estado-desgaste.js (estado-desgaste ->
// desgaste-flota -> vehiculo-diagrama sería un ciclo); su NIVEL_INFO queda cubierto por renombres-estados.test.mjs.
// mediciones.js («Mayor desgaste en el lado...») y ficha-cliente.js («Sin datos de flota») son frases, no el nombre de un estado.
const EXCEPCIONES = [
  { archivo: 'assets/js/domain/estado-desgaste.js' },
  { archivo: 'assets/js/domain/vehiculo-diagrama.js' },
  { archivo: 'assets/js/views/mediciones.js', linea: /Mayor desgaste en el lado/ },
  { archivo: 'assets/js/views/ficha-cliente.js', linea: /Sin datos de flota/ },
];

test('ningún módulo repite un nombre de estado como literal fuera de las excepciones', () => {
  const fallos = [];
  for (const f of walk(join(raiz, 'assets/js')).filter(x => x.endsWith('.js'))) {
    const rel = relative(raiz, f);
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l) || !re.test(l)) return;
      if (EXCEPCIONES.some(e => e.archivo === rel && (!e.linea || e.linea.test(l)))) return;
      fallos.push(`${rel}:${i + 1}: ${l.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(fallos, [], 'estos módulos duplican un nombre de estado: tomarlo de ESTADOS');
});

test('la suma de buen estado y poco desgaste tiene una sola redacción y los umbrales usan los nombres de ESTADOS', () => {
  assert.equal(BUENO_O_POCO, 'Buen estado o poco desgaste');
  assert.equal(CAMPOS_UMBRAL.find(c => c.key === 'umbral_bajo_mm').lbl, `${ESTADOS.bueno.texto} desde (mm)`);
  assert.equal(CAMPOS_UMBRAL.find(c => c.key === 'umbral_critico_mm').lbl, `${ESTADOS.poco.texto} desde (mm)`);
});
