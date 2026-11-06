// `npm run check`: valida la sintaxis de TODOS los módulos ES de assets/js y del script clásico assets/config.js.
// Cada módulo se copia a un .mjs temporal para que `node --check` lo trate como ES module (no se carga ni se ejecuta nada).
import { readdirSync, statSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
// landing.js y config.js son scripts clásicos (no módulos): se comprueban como tales.
const classic = ['assets/config.js', 'assets/js/landing.js'].map(f => join(root, f));
const modules = walk(join(root, 'assets/js')).filter(f => f.endsWith('.js') && !classic.includes(f));
const tmp = mkdtempSync(join(tmpdir(), 'neumet-check-'));
let failed = 0;
try {
  modules.forEach((f, i) => {
    const copy = join(tmp, `${i}.mjs`);
    copyFileSync(f, copy);
    const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
    if (r.status !== 0) { failed++; console.error(`FAIL ${relative(root, f)}\n${r.stderr}`); }
  });
  classic.forEach(f => {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { failed++; console.error(`FAIL ${relative(root, f)}\n${r.stderr}`); }
  });
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (failed) process.exit(1);
console.log(`OK: ${modules.length} módulos ES + ${classic.length} scripts clásicos`);
