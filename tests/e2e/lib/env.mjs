// Levanta todo el entorno E2E: Postgres + migraciones + seed, PostgREST, servidor del panel y Chrome.
import { createServer } from 'node:net';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { JWT_SECRET, USERS } from './config.mjs';
import { signJwt } from './jwt.mjs';
import { startPostgres, prepararBase, query, ROOT } from './postgres.mjs';
import { startPostgrest } from './postgrest.mjs';
import { startWeb } from './web.mjs';
import { lanzarChrome, Pagina } from './chrome.mjs';

const freePort = () => new Promise((ok, ko) => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); s.on('error', ko);
});

// El panel se prueba CONSTRUIDO (dist/), igual que lo sirve Vercel: lo viejo idéntico más /panel/ (docs/19 §7.1.1 b).
// E2E_SIN_BUILD=1 reutiliza el dist/ existente (iteración local).
function construirDist() {
  if (process.env.E2E_SIN_BUILD && existsSync(join(ROOT, 'dist/panel/islas.js'))) return;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`npm run build falló antes del e2e:\n${r.stdout}\n${r.stderr}`);
}

export async function iniciarEntorno() {
  const t0 = Date.now();
  construirDist();
  const pg = await startPostgres();
  const migs = prepararBase(pg.url);
  const rest = await startPostgrest({ dbUri: pg.apiUrl, port: await freePort() });
  const web = await startWeb({ postgrestBase: rest.base });
  const browser = await lanzarChrome();
  const capturas = process.env.E2E_CAPTURAS || join(ROOT, 'tests/e2e/capturas');
  console.log(`# entorno E2E listo en ${((Date.now() - t0) / 1000).toFixed(1)} s (${migs.migraciones.length} migraciones + seed demo)`);

  const sesion = rol => {
    const u = USERS[rol];
    const expiraEn = 24 * 3600; // la sesión dura todo el arnés: el stub de /auth/v1/token no sabe refrescar
    return { rol, sub: u.sub, email: u.email, jwt: signJwt({ sub: u.sub, email: u.email }, JWT_SECRET, { expiresIn: expiraEn }), expiraEn, expiraAt: Math.floor(Date.now() / 1000) + expiraEn };
  };
  return {
    pg, rest, web, browser, sesion,
    sql: q => query(pg.url, q),
    peticiones: web.peticiones,
    // Abre el panel autenticado como `rol` y espera a que salga del login y pinte Inicio.
    async abrirPanel(rol, { ruta = '/adminpanel/index.html', sinAcceso = false } = {}) {
      const p = await Pagina.abrir(browser, { origin: web.origin, sesion: sesion(rol), capturas });
      await p.ir(ruta);
      if (sinAcceso) await p.esperar(`!document.querySelector('#sin-acceso-screen').classList.contains('hidden')`, { que: 'la pantalla Sin acceso' });
      else await p.esperar(`!document.querySelector('#app').classList.contains('hidden')`, { que: 'el panel sale del login' });
      return p;
    },
    async cerrar() {
      await browser.cerrar(); rest.stop(); await web.stop(); await pg.stop();
    }
  };
}
