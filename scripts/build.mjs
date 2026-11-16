// Build (F11): 1) copia tal cual a dist/ lo único que se publica de lo viejo (sin transformaciones: el
// contenido servido no cambia respecto de servir la raíz del repositorio); 2) corre Vite, que añade solo dist/panel/.
// vercel.json no se copia (lo lee Vercel desde la raíz).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RAIZ, 'dist');
// Lista exacta de docs/19 §5.1; cualquier otra cosa (docs, tests, supabase) nunca se publica.
const PUBLICADOS = ['index.html', 'adminpanel', 'assets', 'app-demo.mp4'];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const entrada of PUBLICADOS) {
  cpSync(join(RAIZ, entrada), join(DIST, entrada), {
    recursive: true,
    // .DS_Store es basura local de macOS, no del repositorio
    filter: (origen) => basename(origen) !== '.DS_Store',
  });
}
console.log(`dist/ listo: ${PUBLICADOS.join(', ')}`);

// Front nuevo (F11 PR 1): Vite escribe solo en dist/panel/ y no toca lo copiado arriba.
const vite = spawnSync(process.execPath, [join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: RAIZ, stdio: 'inherit' });
if (vite.status !== 0) {
  console.error('vite build falló: el build completo falla (nunca se promueve a medias).');
  process.exit(vite.status ?? 1);
}
