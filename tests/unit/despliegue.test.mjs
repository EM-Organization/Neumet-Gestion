import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = ruta => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');

const PROYECTO_ACTUAL = 'kootszosdejmawanfxug';
const PROYECTO_ANTERIOR = 'dqgrlflrjcarxlfetvoj';

function cargarConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(leer('assets/config.js'), ctx);
  return ctx.window.NEUMET_CONFIG;
}

test('config.js apunta al proyecto Supabase actual', () => {
  assert.equal(cargarConfig().SUPABASE_URL, `https://${PROYECTO_ACTUAL}.supabase.co`);
});

test('landing: el formulario de contacto toma la base de NEUMET_CONFIG y llama a la función contacto', () => {
  const src = leer('assets/js/landing.js');
  assert.match(src, /\$\{window\.NEUMET_CONFIG\.SUPABASE_URL\}\/functions\/v1\/contacto/);
  assert.doesNotMatch(src, /supabase\.co/, 'la URL no debe estar duplicada en landing.js');
});

test('index.html carga config.js antes que landing.js', () => {
  const html = leer('index.html');
  const iConfig = html.indexOf('assets/config.js');
  const iLanding = html.indexOf('assets/js/landing.js');
  assert.ok(iConfig >= 0 && iLanding > iConfig);
});

test('el endpoint de contacto resuelve al proyecto actual', () => {
  const url = `${cargarConfig().SUPABASE_URL}/functions/v1/contacto`;
  assert.equal(url, `https://${PROYECTO_ACTUAL}.supabase.co/functions/v1/contacto`);
});

test('CSP: connect-src admite solo el proyecto actual y no el anterior', () => {
  const vercel = JSON.parse(leer('vercel.json'));
  const csp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
  const connect = csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'));
  assert.ok(connect.includes(`https://${PROYECTO_ACTUAL}.supabase.co`));
  assert.ok(connect.includes(`wss://${PROYECTO_ACTUAL}.supabase.co`));
  assert.ok(!csp.includes(PROYECTO_ANTERIOR));
});

test('el proyecto anterior no aparece en el código ni en la configuración operativa', () => {
  for (const f of ['assets/config.js', 'assets/js/landing.js', 'vercel.json', 'index.html', 'adminpanel/index.html']) {
    assert.ok(!leer(f).includes(PROYECTO_ANTERIOR), f);
  }
});
