// Chrome headless controlado por CDP (WebSocket global de Node 22; sin dependencias).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function buscarChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const fijos = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  for (const f of fijos) if (existsSync(f)) return f;
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' });
    if (r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('No se encontró Chrome: define CHROME=/ruta/al/binario');
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id) { const p = this.pend.get(m.id); this.pend.delete(m.id); if (p) (m.error ? p.ko(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result)); return; }
      const hs = this.handlers.get(`${m.sessionId || ''}|${m.method}`) || [];
      hs.forEach(h => h(m.params));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((ok, ko) => { this.pend.set(id, { ok, ko, method }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  on(sessionId, method, h) {
    const k = `${sessionId || ''}|${method}`;
    this.handlers.set(k, [...(this.handlers.get(k) || []), h]);
  }
}

// Un intento de arranque: espera hasta ~20 s a que Chrome publique su puerto de depuración. Si no lo hace, mata el
// proceso y devuelve el motivo (código de salida y últimas líneas de stderr) para que el error sea diagnosticable.
async function arrancar(binario) {
  const dir = mkdtempSync(join(tmpdir(), 'neumet-e2e-chrome-'));
  const proc = spawn(binario, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', salida = null;
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  proc.on('exit', (code, sig) => { salida = `código ${code ?? sig}`; });
  proc.on('error', e => { salida = `no se pudo ejecutar: ${e.message}`; });
  let ws;
  for (let i = 0; i < 130 && !ws && !salida; i++) {
    await new Promise(r => setTimeout(r, 150));
    const f = join(dir, 'DevToolsActivePort');
    if (!existsSync(f)) continue;
    const [port, path] = readFileSync(f, 'utf8').trim().split('\n');
    if (port && path) ws = `ws://127.0.0.1:${port}${path}`;
  }
  if (!ws) {
    proc.kill('SIGKILL');
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ }
    return { motivo: `${salida ? `Chrome terminó (${salida})` : 'Chrome no publicó el puerto en 20 s'}${stderr ? `; stderr: ${stderr.trim().split('\n').slice(-5).join(' | ')}` : ''}` };
  }
  return { ws, proc, dir };
}

// Reintenta el arranque (el primer arranque en un runner frío puede tardar o fallar de forma esporádica). Si todos los
// intentos fallan, el error incluye el motivo de cada uno: no se oculta un Chrome realmente roto.
export async function lanzarChrome() {
  const binario = buscarChrome();
  const motivos = [];
  let r;
  for (let intento = 1; intento <= 3; intento++) {
    r = await arrancar(binario);
    if (r.ws) break;
    motivos.push(`intento ${intento}: ${r.motivo}`);
    console.error(`[e2e] ${motivos.at(-1)}`);
    await new Promise(ok => setTimeout(ok, 1000));
  }
  if (!r.ws) throw new Error(`Chrome no expuso el puerto de depuración (${binario}). ${motivos.join(' / ')}`);
  const { ws, proc, dir } = r;
  const sock = new WebSocket(ws);
  await new Promise((ok, ko) => { sock.addEventListener('open', ok); sock.addEventListener('error', () => ko(new Error('WebSocket CDP'))); });
  const cdp = new Cdp(sock);
  return {
    cdp,
    async cerrar() { try { sock.close(); } catch { /* ya cerrado */ } proc.kill('SIGKILL'); await esperar(300); try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temporal del SO */ } }
  };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

// Página aislada (contexto de navegador propio) con sesión de prueba y recolección de problemas.
export class Pagina {
  static async abrir(browser, { origin, sesion, capturas }) {
    const { cdp } = browser;
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Pagina(cdp, sessionId, browserContextId, targetId, origin, capturas);
    await Promise.all(['Page', 'Runtime', 'Log'].map(d => cdp.send(`${d}.enable`, {}, sessionId)));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__E2E = ${JSON.stringify(sesion)};` }, sessionId);
    cdp.on(sessionId, 'Runtime.consoleAPICalled', e => {
      if (e.type === 'error' || e.type === 'assert') p.problemas.push({ tipo: 'console.error', texto: e.args.map(a => a.value ?? a.description ?? '').join(' ') });
      else if (e.type === 'warning') p.avisos.push(e.args.map(a => a.value ?? a.description ?? '').join(' '));
    });
    cdp.on(sessionId, 'Runtime.exceptionThrown', e => {
      const d = e.exceptionDetails;
      p.problemas.push({ tipo: 'excepcion', texto: (d.exception && (d.exception.description || d.exception.value)) || d.text });
    });
    cdp.on(sessionId, 'Log.entryAdded', e => {
      // Los 4xx/5xx de red ya los registra el proxy con su cuerpo; aquí se conservan para poder permitirlos por URL.
      if (e.entry.level === 'error') p.problemas.push({ tipo: e.entry.source === 'network' ? 'http' : 'log.error', texto: e.entry.text, url: e.entry.url || '' });
    });
    return p;
  }

  constructor(cdp, sessionId, ctxId, targetId, origin, capturas) {
    Object.assign(this, { cdp, sessionId, ctxId, targetId, origin, capturas, problemas: [], avisos: [] });
  }

  send(m, p) { return this.cdp.send(m, p, this.sessionId); }

  async ir(path) {
    const cargado = new Promise(ok => this.cdp.on(this.sessionId, 'Page.loadEventFired', ok));
    await this.send('Page.navigate', { url: this.origin + path });
    await cargado;
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}\n${expr.slice(0, 200)}`);
    return r.result.value;
  }

  async esperar(expr, { ms = 15000, que = expr } = {}) {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await this.eval(`(() => { try { return (${expr}); } catch (e) { return false; } })()`); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`Tiempo agotado esperando: ${que}`);
      await esperar(80);
    }
  }

  click(sel) { return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no existe ${sel.replace(/'/g, '')}'); if (typeof e.click === 'function') e.click(); else e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; })()`); }

  async escribir(sel, texto) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select(); return true; })()`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    if (texto) await this.send('Input.insertText', { text: texto });
  }

  async enter() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  async captura(nombre) {
    if (!this.capturas) return;
    mkdirSync(this.capturas, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(this.capturas, `${nombre.replace(/[^\w.-]+/g, '_')}.png`), Buffer.from(data, 'base64'));
  }

  async cerrar() {
    try { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); } catch { /* ya cerrada */ }
  }
}
