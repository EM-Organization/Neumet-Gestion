// PostgREST real (el mismo motor que usa Supabase para /rest/v1).
//   1. E2E_POSTGREST_BIN: ruta a un binario ya instalado.
//   2. Si no, binario oficial con versión fijada y SHA-256 verificado, cacheado en tests/e2e/.cache/.
//   3. E2E_POSTGREST_DOCKER=1: `docker run` de la imagen oficial postgrest/postgrest (Postgres accesible desde el contenedor).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arch, platform } from 'node:os';
import { JWT_SECRET, POSTGREST_ASSETS, POSTGREST_VERSION } from './config.mjs';
import { ROOT } from './postgres.mjs';

const CACHE = join(ROOT, 'tests/e2e/.cache');

async function binario() {
  if (process.env.E2E_POSTGREST_BIN) return process.env.E2E_POSTGREST_BIN;
  const clave = `${platform()}-${arch()}`;
  const asset = POSTGREST_ASSETS[clave];
  if (!asset) throw new Error(`Sin binario de PostgREST para ${clave}: define E2E_POSTGREST_BIN o E2E_POSTGREST_DOCKER=1`);
  const dir = join(CACHE, `postgrest-${POSTGREST_VERSION}-${clave}`);
  const bin = join(dir, 'postgrest');
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  const url = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/${asset.file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== asset.sha256) throw new Error(`SHA-256 de ${asset.file} distinto del fijado: ${sha}`);
  const tarball = join(dir, asset.file);
  writeFileSync(tarball, buf);
  const r = spawnSync('tar', ['-xJf', tarball, '-C', dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar: ${r.stderr} (se necesita xz)`);
  chmodSync(bin, 0o755);
  return bin;
}

// En macOS el binario enlaza libpq dinámica (brew install libpq); si no está en su sitio se busca la de postgresql@N.
function envDarwin() {
  if (platform() !== 'darwin') return {};
  const cands = ['/opt/homebrew/opt/libpq/lib', '/usr/local/opt/libpq/lib', '/opt/homebrew/lib/postgresql@17', '/opt/homebrew/lib/postgresql@16', '/opt/homebrew/lib/postgresql@15'];
  const d = cands.find(c => existsSync(join(c, 'libpq.5.dylib')));
  return d ? { DYLD_FALLBACK_LIBRARY_PATH: d } : {};
}

export async function startPostgrest({ dbUri, port, maxRows = 1000 }) {
  const env = {
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port),
    PGRST_DB_MAX_ROWS: String(maxRows), // igual que Supabase: la paginación del panel (fetchAll) depende de este tope
    PGRST_LOG_LEVEL: 'warn', PGRST_DB_POOL: '5'
  };
  let child, logs = '';
  if (process.env.E2E_POSTGREST_DOCKER === '1') {
    // Contenedor en la red del host: llega a Postgres en 127.0.0.1 (Linux). En macOS usar host.docker.internal.
    const uri = process.env.E2E_POSTGREST_DB_URI || dbUri;
    const args = ['run', '--rm', '--network', 'host', ...Object.entries({ ...env, PGRST_DB_URI: uri }).flatMap(([k, v]) => ['-e', `${k}=${v}`]), `postgrest/postgrest:${POSTGREST_VERSION}`];
    child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    child = spawn(await binario(), [], { env: { ...process.env, ...envDarwin(), ...env, PGRST_DB_URI: dbUri }, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  let muerto = null;
  child.on('exit', c => { muerto = c; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (muerto !== null) throw new Error(`PostgREST terminó (${muerto}):\n${logs}`);
    try { const r = await fetch(`${base}/`); if (r.status < 500) break; } catch { /* aún no escucha */ }
    await new Promise(r => setTimeout(r, 200));
    if (i === 149) throw new Error(`PostgREST no arrancó:\n${logs}`);
  }
  return { base, logs: () => logs, stop: () => child.kill('SIGTERM') };
}
