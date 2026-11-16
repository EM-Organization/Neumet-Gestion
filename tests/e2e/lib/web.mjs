// Servidor local: sirve el panel CONSTRUIDO (dist/, salida de scripts/build.mjs: lo viejo idéntico más /panel/), con las
// cabeceras de vercel.json (CSP incluida: una violación sale como error del navegador y rompe el flujo), y hace de proxy de
// /rest/v1 hacia PostgREST, registrando cada petición de datos (método, ruta, estado, cuerpo de error) para los contratos.
// Solo se sustituyen dos cosas en adminpanel/index.html: el CDN de supabase-js (por la misma versión servida desde
// node_modules) y assets/config.js (URL del proxy). La autenticación es la REAL de supabase-js: la sesión de prueba se
// precarga en localStorage (chrome.mjs) y este servidor responde /auth/v1/{user,token,logout} como lo haría GoTrue.
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './postgres.mjs';

const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

export async function startWeb({ postgrestBase }) {
  const peticiones = [];
  // Archivos servidos en lugar de los de dist/ (ruta -> cuerpo JS): permite probar al panel viejo contra un /panel/islas.js
  // distinto (versión de `ctx` ajena, `montar` que lanza, que tarda...) sin tocar el build. Siempre se restaura al terminar.
  const reemplazos = new Map();
  // Cabeceras de vercel.json: cada bloque cuyo `source` (una expresión regular de ruta) coincide, en orden; el último gana.
  const bloques = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).headers
    .map(b => ({ re: new RegExp(`^${b.source}$`), headers: b.headers }));
  const cabecerasDe = pathname => Object.fromEntries(bloques.filter(b => b.re.test(pathname)).flatMap(b => b.headers.map(h => [h.key.toLowerCase(), h.value])));
  const supabaseUmd = readFileSync(join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
  const cdn = /<script[^>]*cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^>]*><\/script>/;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/rest/v1/') || url.pathname === '/rest/v1') return proxy(req, res, url);
    if (url.pathname === '/__e2e/supabase.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); return res.end(supabaseUmd); }
    if (url.pathname.startsWith('/auth/v1/')) return auth(req, res, url);
    if (url.pathname === '/__e2e/config.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end(`window.NEUMET_CONFIG = { SUPABASE_URL: location.origin, SUPABASE_KEY: 'clave-publica-de-prueba' };`);
    }
    if (reemplazos.has(url.pathname)) {
      res.writeHead(200, { 'cache-control': 'no-store', ...cabecerasDe(url.pathname), 'content-type': MIME['.js'] });
      return res.end(reemplazos.get(url.pathname));
    }
    estatico(url.pathname, res);
  });

  function estatico(pathname, res) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(DIST, rel));
    if (!file.startsWith(DIST) || rel.includes('/node_modules/') || rel.includes('/.git/') || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); return res.end('no encontrado');
    }
    let body = readFileSync(file);
    if (rel === '/adminpanel/index.html') {
      let h = body.toString('utf8');
      if (!cdn.test(h)) throw new Error('adminpanel/index.html ya no carga supabase-js desde el CDN esperado: actualizar tests/e2e/lib/web.mjs');
      h = h.replace(cdn, '<script src="/__e2e/supabase.js"></script>')
        .replace('../assets/config.js', '/__e2e/config.js');
      body = Buffer.from(h);
    }
    res.writeHead(200, { 'cache-control': 'no-store', ...cabecerasDe(pathname), 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  }

  // GoTrue mínimo. El JWT de la sesión de prueba ya viene firmado por el arnés; aquí solo se devuelve lo que supabase-js pide.
  function auth(req, res, url) {
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/auth/v1/user') {
      try {
        const c = JSON.parse(Buffer.from((req.headers.authorization || '').replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'));
        return json(200, { id: c.sub, email: c.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
      } catch { return json(401, { message: 'jwt inválido' }); }
    }
    // /token (login o refresco): la sesión de prueba dura todo el arnés; si algo intenta renovarla es un fallo del test.
    return json(400, { error: 'e2e_no_soportado', error_description: `el arnés e2e no atiende ${url.pathname}` });
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
    reemplazar: (ruta, cuerpo) => reemplazos.set(ruta, cuerpo),
    restaurar: () => reemplazos.clear(),
    stop: () => new Promise(ok => { server.closeAllConnections?.(); server.close(ok); })
  };
}
