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
