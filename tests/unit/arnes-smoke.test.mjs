import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const leer = ruta => readFileSync(raiz + ruta, 'utf8');

test('harness: cada window.xFlow que invoca está definida por un script que el propio harness carga', () => {
  const harness = leer('tests/smoke/harness.html');
  const cargados = [...harness.matchAll(/<script src="\/(tests\/[^"]+)"/g)].map(m => m[1]);
  const definidas = new Set();
  for (const f of cargados) for (const m of leer(f).matchAll(/window\.(\w+Flow)\s*=/g)) definidas.add(m[1]);
  const usadas = new Set([...harness.matchAll(/window\.(\w+Flow)\(/g)].map(m => m[1]));
  assert.ok(usadas.size > 10);
  // Un script sin cargar da «window.xFlow is not a function»; aquí se detecta como lista, no como fallo intermitente.
  for (const u of usadas) assert.ok(definidas.has(u), `${u} no la define ningún script cargado por harness.html`);
  // Y todo *.flow.js del directorio está cargado (no quedan flujos huérfanos)
  for (const f of readdirSync(raiz + 'tests/smoke').filter(n => n.endsWith('.flow.js'))) {
    assert.ok(cargados.includes(`tests/smoke/${f}`), `${f} no está en harness.html`);
  }
});

test('run.sh de smoke y visual usan el servidor Node y no python http.server', () => {
  for (const r of ['tests/smoke/run.sh', 'tests/visual/run.sh']) {
    const s = leer(r);
    assert.doesNotMatch(s, /http\.server/, `${r} volvió al servidor de un hilo`);
    assert.match(s, /lib-servidor\.sh/);
  }
});

test('servidor estático: puerto libre automático, 100 pedidos en paralelo sin pérdida, sin salir de la raíz', async () => {
  const srv = spawn(process.execPath, ['scripts/servir-estatico.mjs', '0', '.'], { cwd: raiz, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const puerto = await new Promise((ok, mal) => {
      let buf = '';
      srv.stdout.on('data', d => { buf += d; const m = buf.match(/PUERTO=(\d+)/); if (m) ok(Number(m[1])); });
      srv.on('exit', c => mal(new Error(`el servidor salió con ${c}`)));
    });
    const base = `http://127.0.0.1:${puerto}`;
    const respuestas = await Promise.all(Array.from({ length: 100 }, () => fetch(`${base}/tests/smoke/stub.js`)));
    assert.ok(respuestas.every(r => r.status === 200));
    assert.match(respuestas[0].headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(`${base}/no-existe.js`)).status, 404);
    // fetch normaliza «..» y «%2e%2e» pero no «..%2f»: llega al servidor y solo la guarda de la raíz lo frena (sin ella sirve /etc/hosts).
    const pedir = async (linea) => {
      const { default: net } = await import('node:net');
      return new Promise(ok => {
        const s = net.connect(puerto, '127.0.0.1', () => s.write(`GET ${linea} HTTP/1.0\r\n\r\n`));
        let t = ''; s.on('data', d => { t += d; }); s.on('close', () => ok(t));
      });
    };
    assert.match(await pedir('/' + '..%2f'.repeat(8) + 'etc/hosts'), /^HTTP\/1\.\d 403/);
    assert.match(await pedir('/%'), /^HTTP\/1\.\d 400/); // URL mal codificada: 400, no 500
  } finally { srv.kill('SIGTERM'); }
});
