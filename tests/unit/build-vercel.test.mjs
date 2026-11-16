// scripts/build.mjs: en Vercel, si falta el verificador de dist/ el build FALLA (docs/19 §7.1.1); fuera de Vercel solo avisa.
// Se ejecuta una copia del script en un directorio temporal con un «vite» vacío, sin tocar el repositorio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function correrBuild({ vercel, conVerificador }) {
  const t = mkdtempSync(join(tmpdir(), 'neumet-build-'));
  try {
    mkdirSync(join(t, 'scripts'));
    copyFileSync(join(RAIZ, 'scripts', 'build.mjs'), join(t, 'scripts', 'build.mjs'));
    writeFileSync(join(t, 'index.html'), '<!doctype html>');
    writeFileSync(join(t, 'app-demo.mp4'), '');
    mkdirSync(join(t, 'adminpanel')); writeFileSync(join(t, 'adminpanel', 'index.html'), '');
    mkdirSync(join(t, 'assets')); writeFileSync(join(t, 'assets', 'config.js'), '');
    mkdirSync(join(t, 'node_modules', 'vite', 'bin'), { recursive: true });
    writeFileSync(join(t, 'node_modules', 'vite', 'bin', 'vite.js'), ''); // «vite build» que no hace nada y sale en 0
    if (conVerificador) {
      mkdirSync(join(t, 'tests', 'build'), { recursive: true });
      writeFileSync(join(t, 'tests', 'build', 'verificar-dist.mjs'), 'process.exit(0);\n');
    }
    const env = { ...process.env };
    delete env.VERCEL;
    if (vercel) env.VERCEL = '1';
    return spawnSync(process.execPath, [join(t, 'scripts', 'build.mjs')], { cwd: t, env, encoding: 'utf8' });
  } finally { rmSync(t, { recursive: true, force: true }); }
}

test('en Vercel, sin tests/build/verificar-dist.mjs el build falla', () => {
  const r = correrBuild({ vercel: true, conVerificador: false });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /verificar-dist\.mjs/);
});

test('fuera de Vercel, sin el verificador solo avisa y termina bien', () => {
  const r = correrBuild({ vercel: false, conVerificador: false });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /AVISO/);
});

test('en Vercel, con el verificador presente el build pasa', () => {
  const r = correrBuild({ vercel: true, conVerificador: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
