// Inventario de rutas que leen o escriben `perfiles` (docs/17 §2.5). «Quitar acceso» = borrar la fila: es seguro solo si
// ninguna ruta de autorización consulta `perfiles` sin haber sido revisada. Esta prueba repite los cuatro grep del plan y
// compara archivo, número de línea Y texto de la línea con la lista revisada (datos/inventario-perfiles.json): una línea
// nueva, movida o editada falla hasta que alguien la clasifique (tabla de rutas o exclusiones de docs/17 §2.5) y regenere
// la lista con `node tests/unit/inventario-perfiles.test.mjs --regenerar`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const LISTA = fileURLToPath(new URL('./datos/inventario-perfiles.json', import.meta.url));

const GREPS = [
  ['-rnE', 'perfiles', 'assets/js'],
  ['-rn', 'perfiles', 'supabase/functions'],
  ['-rnE', 'from public\\.perfiles|from perfiles|public\\.perfiles|join public\\.perfiles', 'supabase/migrations'],
  ['-rn', 'rest/v1/perfiles', 'assets', 'supabase']
];

function inventario() {
  const filas = new Map();
  for (const args of GREPS) {
    let salida = '';
    try { salida = execFileSync('grep', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { if (e.status !== 1) throw e; }
    for (const l of salida.split('\n').filter(Boolean)) {
      const m = /^([^:]+):(\d+):(.*)$/.exec(l);
      filas.set(`${m[1]}:${m[2]}`, { archivo: m[1], linea: Number(m[2]), texto: m[3].trim() });
    }
  }
  return [...filas.values()].sort((a, b) => a.archivo.localeCompare(b.archivo) || a.linea - b.linea);
}

if (process.argv.includes('--regenerar')) {
  const hoy = inventario();
  writeFileSync(LISTA, JSON.stringify(hoy, null, 1) + '\n');
  console.log(`inventario regenerado: ${hoy.length} líneas`);
} else {
  test('Inventario de perfiles: toda línea que consulta perfiles está en la lista revisada (archivo, línea y texto)', () => {
    const revisada = new Map(JSON.parse(readFileSync(LISTA, 'utf8')).map(f => [`${f.archivo}:${f.linea}`, f.texto]));
    const hoy = inventario();
    const nuevas = hoy.filter(f => revisada.get(`${f.archivo}:${f.linea}`) !== f.texto).map(f => `${f.archivo}:${f.linea}  ${f.texto}`);
    assert.deepEqual(nuevas, [], 'líneas nuevas o cambiadas que leen perfiles: clasificarlas en docs/17 §2.5 y regenerar la lista');
    const claves = new Set(hoy.map(f => `${f.archivo}:${f.linea}`));
    const faltan = [...revisada.keys()].filter(k => !claves.has(k));
    assert.deepEqual(faltan, [], 'líneas de la lista que ya no existen: regenerar la lista tras revisarlas');
  });

  test('Inventario de perfiles: las rutas de la migración de administración de empresa están revisadas', () => {
    assert.ok(inventario().some(f => f.archivo === 'supabase/migrations/20261119000000_admin_empresa.sql'));
  });
}
