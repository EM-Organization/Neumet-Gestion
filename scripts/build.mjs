// Build (F11): 1) copia tal cual a dist/ lo único que se publica de lo viejo (sin transformaciones: el
// contenido servido no cambia respecto de servir la raíz del repositorio); 2) corre Vite, que añade solo dist/panel/.
// vercel.json no se copia (lo lee Vercel desde la raíz).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
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

// Comprobación final de lo que se publica (docs/19 §7.1.1 d): lo viejo idéntico a su origen y dist/panel/** dentro de la CSP.
// Si falla, el build falla y Vercel no promueve el despliegue. .vercelignore deja subir tests/build/; si faltara (subida
// incompleta) se avisa y se sigue: CI la corre siempre como paso propio y un archivo de prueba ausente no debe tumbar un despliegue.
const verificador = join(RAIZ, 'tests', 'build', 'verificar-dist.mjs');
if (!existsSync(verificador)) {
  console.warn('AVISO: falta tests/build/verificar-dist.mjs en este entorno; se omite la verificación de dist/ (CI la corre aparte).');
} else {
  const v = spawnSync(process.execPath, [verificador], { cwd: RAIZ, stdio: 'inherit' });
  if (v.status !== 0) {
    console.error('verificar-dist falló: el build completo falla.');
    process.exit(v.status ?? 1);
  }
}
