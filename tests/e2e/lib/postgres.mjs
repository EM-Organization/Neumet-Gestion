// Postgres desechable con TODAS las migraciones y el seed demo.
//   - E2E_PG_URL (superusuario, p. ej. el servicio postgres:16 de CI): crea una base temporal y la borra al terminar.
//   - Si no, initdb + pg_ctl en un directorio temporal (Postgres del PATH, Homebrew o /usr/lib/postgresql).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHENTICATOR_PASSWORD, DB_NAME } from './config.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function freePort() {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on('error', ko);
  });
}

function findPgBin() {
  const cands = [];
  const which = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).stdout.trim();
  if (which) cands.push(join(which, '..'));
  for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
    if (existsSync(base)) for (const d of readdirSync(base)) if (d.startsWith('postgresql@')) cands.push(join(base, d, 'bin'));
  }
  if (existsSync('/usr/lib/postgresql')) for (const d of readdirSync('/usr/lib/postgresql')) cands.push(join('/usr/lib/postgresql', d, 'bin'));
  return cands.find(d => existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl')));
}

function psql(url, args) {
  const r = spawnSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' }
  });
  if (r.error) throw new Error(`psql no disponible: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql falló (${args.join(' ')}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
export const runFile = (url, file) => psql(url, ['-f', file]);
export const query = (url, sql) => psql(url, ['-At', '-c', sql]).trim();

export async function startPostgres() {
  const work = mkdtempSync(join(tmpdir(), 'neumet-e2e-pg-'));
  let adminUrl, stop = () => {}, port;
  if (process.env.E2E_PG_URL) {
    adminUrl = process.env.E2E_PG_URL;
    port = Number(new URL(adminUrl).port || 5432);
  } else {
    const bin = findPgBin();
    if (!bin) throw new Error('No hay Postgres: define E2E_PG_URL (superusuario) o instala postgresql (initdb/pg_ctl).');
    const data = join(work, 'data');
    port = await freePort();
    const run = (cmd, args) => { const r = spawnSync(join(bin, cmd), args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`); };
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale']);
    run('pg_ctl', ['-D', data, '-o', `-c listen_addresses=127.0.0.1 -c port=${port} -c unix_socket_directories=${work} -c fsync=off`, '-l', join(work, 'pg.log'), '-w', 'start']);
    stop = () => spawnSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  }
  const dbName = process.env.E2E_PG_URL ? `${DB_NAME}_${process.pid}` : DB_NAME;
  psql(adminUrl, ['-c', `create database ${dbName}`]);
  const u = new URL(adminUrl); u.pathname = `/${dbName}`;
  const url = u.toString();
  const apiUrl = new URL(url); apiUrl.username = 'authenticator'; apiUrl.password = AUTHENTICATOR_PASSWORD;
  return {
    url, apiUrl: apiUrl.toString(), port,
    async stop() {
      if (process.env.E2E_PG_URL) { try { psql(adminUrl, ['-c', `drop database if exists ${dbName} with (force)`]); } catch { /* ya no existe */ } }
      stop(); rmSync(work, { recursive: true, force: true });
    }
  };
}

// Roles/auth mínimos de Supabase + migraciones (todas, en orden) + datos de prueba + seed demo.
export function prepararBase(url) {
  const sqlDir = join(ROOT, 'tests/e2e/sql');
  runFile(url, join(ROOT, 'tests/sql/00_stub_auth.sql'));
  const migDir = join(ROOT, 'supabase/migrations');
  const migs = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const m of migs) runFile(url, join(migDir, m));
  runFile(url, join(sqlDir, '10_usuarios_y_cliente.sql'));
  runFile(url, join(ROOT, 'supabase/seed/demo.sql'));
  runFile(url, join(sqlDir, '20_perfiles_seccional.sql'));
  return { migraciones: migs };
}
