// Servidor estático para los arneses de tests/smoke y tests/visual.
// Reemplaza a `python3 -m http.server` (un hilo, cola de 5): Chrome pide decenas de módulos en paralelo y en macOS
// algunas conexiones se perdían («recurso no cargado»). Node atiende en paralelo y con cola larga.
// Uso: node scripts/servir-estatico.mjs [puerto|0] [raíz]   -> imprime "PUERTO=<n>" y queda escuchando. 0 = primer puerto libre.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';

const puerto = Number(process.argv[2] ?? 0);
const raiz = resolve(process.argv[3] ?? '.');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const srv = http.createServer(async (req, res) => {
  try {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let archivo = resolve(join(raiz, ruta));
    // Sin salir de la raíz (../)
    if (archivo !== raiz && !archivo.startsWith(raiz + sep)) { res.writeHead(403).end(); return; }
    let st = await stat(archivo).catch(() => null);
    if (st?.isDirectory()) { archivo = join(archivo, 'index.html'); st = await stat(archivo).catch(() => null); }
    if (!st) { res.writeHead(404).end('no encontrado'); return; }
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch {
    res.writeHead(500).end();
  }
});
srv.on('clientError', (_e, s) => s.destroy());
srv.listen({ port: puerto, host: '127.0.0.1', backlog: 1024 }, () => {
  console.log(`PUERTO=${srv.address().port}`);
});
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { srv.close(); process.exit(0); });
