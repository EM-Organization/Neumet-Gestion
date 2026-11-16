// Las reglas de lint de src/ (docs/19 §5.2 y §5.5) deben rechazar lo prohibido. Necesita `npm ci` (usa ESLint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: new URL('../..', import.meta.url).pathname });

async function reglas(codigo, archivo) {
  const [r] = await eslint.lintText(codigo, { filePath: new URL(`../../${archivo}`, import.meta.url).pathname });
  return r.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
}

test('src/ no puede crear un segundo cliente de supabase', async () => {
  assert.ok((await reglas("import { createClient } from '@supabase/supabase-js';\nexport const db = createClient('a', 'b');\n", 'src/db.js')).includes('no-restricted-imports'));
  assert.ok((await reglas("export const db = window.supabase.createClient('a', 'b');\n", 'src/db.js')).includes('no-restricted-syntax'));
  assert.ok((await reglas("export const db = createClient('a', 'b');\n", 'src/db.js')).includes('no-restricted-syntax'));
  assert.ok((await reglas("export const cargar = () => import('@supabase/supabase-js');\n", 'src/db.js')).includes('no-restricted-syntax'));
});

test('src/ no esquiva la regla con alias, acceso computado, SupabaseClient ni subrutas', async () => {
  const casos = [
    ["const { createClient: c } = window.supabase;\nexport const db = c('a', 'b');\n", 'alias por desestructuración'],
    ["export const db = window.supabase['createClient']('a', 'b');\n", 'acceso computado'],
    ["export const db = (0, window.supabase.createClient)('a', 'b');\n", 'llamada indirecta'],
    ["export const db = globalThis.supabase.createClient('a', 'b');\n", 'globalThis'],
    ["import { SupabaseClient } from '@supabase/supabase-js';\nexport const db = new SupabaseClient('a', 'b');\n", 'new SupabaseClient'],
    ["import { createClient } from '@supabase/supabase-js/dist/module/index.js';\nexport { createClient };\n", 'subruta de supabase-js'],
    ["export const db = new window.supabase.SupabaseClient('a', 'b');\n", 'new window.supabase.SupabaseClient sin import'],
    ["export const cargar = (v) => import(`@supabase/${v}`);\n", 'import() con plantilla'],
    ["import { x } from '@supabase/auth-js';\nexport { x };\n", 'otro paquete @supabase/*'],
  ];
  for (const [codigo, que] of casos) {
    const r = await reglas(codigo, 'src/db.js');
    assert.ok(r.includes('no-restricted-syntax') || r.includes('no-restricted-imports'), `debe fallar: ${que}`);
  }
});

// Elusiones que dejó abiertas el PR 2a (docs/19 §7.1.1): código de otro origen que la CSP permite (jsdelivr) y el global con clave dinámica.
test('src/ no esquiva la regla con import() de URL externa ni con claves dinámicas del global', async () => {
  const casos = [
    ["export const cargar = () => import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');\n", 'import() de jsdelivr'],
    ["export const cargar = () => import('//cdn.jsdelivr.net/npm/x');\n", 'import() de URL relativa al protocolo'],
    ["export const cargar = (u) => import(u);\n", 'import() con ruta calculada'],
    ["import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';\nexport { createClient };\n", 'import estático de URL externa'],
    ["export { createClient } from 'https://esm.sh/@supabase/supabase-js';\n", 're-export de URL externa'],
    ["export const db = window['supabase'].createClient('a', 'b');\n", "window['supabase']"],
    ["export const f = (k) => window['supabase'][k]('a', 'b');\n", "window['supabase'][clave dinámica]"],
    ["export const f = (k, d) => globalThis[k][d]('a', 'b');\n", 'globalThis[clave dinámica]'],
    ["export const f = () => globalThis['supa' + 'base'];\n", 'clave armada con concatenación'],
  ];
  for (const [codigo, que] of casos) {
    const r = await reglas(codigo, 'src/db.js');
    assert.ok(r.includes('no-restricted-syntax'), `debe fallar: ${que}`);
  }
});

test('src/ sí puede importar módulos propios con import() de ruta literal', async () => {
  assert.deepEqual(await reglas("export const cargar = () => import('./otra.js');\n", 'src/x.js'), []);
});

test('el mismo código fuera de src/ no dispara la regla (el panel viejo sigue con su singleton)', async () => {
  const r = await reglas("export const db = window.supabase.createClient('a', 'b');\n", 'assets/js/core/supabase.js');
  assert.ok(!r.includes('no-restricted-syntax'));
});

test('svelte: {@html} y eval en src/ fallan', async () => {
  assert.ok((await reglas('<script>let { x } = $props();</script>\n{@html x}\n', 'src/componentes/X.svelte')).includes('svelte/no-at-html-tags'));
  assert.ok((await reglas("export const f = (s) => eval(s);\n", 'src/x.js')).includes('no-eval'));
});

test('código limpio de src/ no da errores', async () => {
  assert.deepEqual(await reglas('export const suma = (a, b) => a + b;\n', 'src/x.js'), []);
});
