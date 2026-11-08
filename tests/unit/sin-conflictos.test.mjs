// Falla si algún archivo versionado conserva marcadores de conflicto de git sin resolver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../..', import.meta.url));
const MARCADOR = /^(<{7} |>{7} |={7}$)/;

test('ningún archivo versionado tiene marcadores de conflicto', () => {
  const archivos = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter(f => !/\.(png|jpe?g|gif|ico|woff2?|pdf|zip)$/i.test(f));
  assert.ok(archivos.length > 50, 'git ls-files debería listar el repo');
  const malos = [];
  for (const f of archivos) {
    let txt;
    try { txt = readFileSync(`${raiz}/${f}`, 'utf8'); } catch { continue; }
    txt.split('\n').forEach((l, i) => { if (MARCADOR.test(l)) malos.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(malos, [], `marcadores de conflicto sin resolver: ${malos.join(', ')}`);
});
