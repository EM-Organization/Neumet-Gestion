// Servidor local: sirve el panel real (assets/ y adminpanel/) y hace de proxy de /rest/v1 hacia PostgREST,
// registrando cada petición de datos (método, ruta, estado, cuerpo de error) para los contratos de consultas.
// Solo se sustituyen tres cosas en adminpanel/index.html: el CDN de supabase-js (por la misma versión servida
// desde node_modules), assets/config.js (URL del proxy) y un shim que reemplaza la capa de AUTENTICACIÓN.
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './postgres.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

export async function startWeb({ postgrestBase }) {
  const peticiones = [];
  const shim = readFileSync(join(ROOT, 'tests/e2e/browser/auth-shim.js'), 'utf8');
  const supabaseUmd = readFileSync(join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
  const cdn = /<script[^>]*cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^>]*><\/script>/;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/rest/v1/') || url.pathname === '/rest/v1') return proxy(req, res, url);
    if (url.pathname === '/__e2e/supabase.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); return res.end(supabaseUmd); }
    if (url.pathname === '/__e2e/auth-shim.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); return res.end(shim); }
    if (url.pathname === '/__e2e/config.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end(`window.NEUMET_CONFIG = { SUPABASE_URL: location.origin, SUPABASE_KEY: 'clave-publica-de-prueba' };`);
    }
    estatico(url.pathname, res);
  });

  function estatico(pathname, res) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT) || rel.includes('/node_modules/') || rel.includes('/.git/') || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); return res.end('no encontrado');
    }
    let body = readFileSync(file);
    if (rel === '/adminpanel/index.html') {
      let h = body.toString('utf8');
      if (!cdn.test(h)) throw new Error('adminpanel/index.html ya no carga supabase-js desde el CDN esperado: actualizar tests/e2e/lib/web.mjs');
      h = h.replace(cdn, '<script src="/__e2e/supabase.js"></script><script src="/__e2e/auth-shim.js"></script>')
        .replace('../assets/config.js', '/__e2e/config.js');
      body = Buffer.from(h);
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  }

  function proxy(req, res, url) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const target = new URL(postgrestBase);
      const headers = { ...req.headers, host: target.host };
      const up = httpRequest({ host: target.hostname, port: target.port, path: url.pathname.replace(/^\/rest\/v1/, '') + url.search, method: req.method, headers }, r => {
        const out = [];
        r.on('data', c => out.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(out);
          const rec = { method: req.method, path: url.pathname.replace(/^\/rest\/v1/, ''), search: url.search, status: r.statusCode, body: body.toString('utf8'), at: Date.now(), tag: server.tag || '', error: null };
          if (r.statusCode >= 400) { try { rec.error = JSON.parse(buf.toString('utf8')); } catch { rec.error = { message: buf.toString('utf8').slice(0, 300) }; } }
          peticiones.push(rec);
          res.writeHead(r.statusCode, r.headers);
          res.end(buf);
        });
      });
      up.on('error', e => { res.writeHead(502); res.end(String(e)); });
      up.end(body);
    });
  }

  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, peticiones,
    setTag: t => { server.tag = t; },
    stop: () => new Promise(ok => { server.closeAllConnections?.(); server.close(ok); })
  };
}
