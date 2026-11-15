// Build neutro (F11 PR 0): copia tal cual a dist/ lo único que se publica.
// Sin dependencias ni transformaciones: el contenido servido no cambia respecto
// de servir la raíz del repositorio. vercel.json no se copia (lo lee Vercel desde la raíz).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
