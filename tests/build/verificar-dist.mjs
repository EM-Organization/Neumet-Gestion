// Comprueba que dist/ contiene exactamente lo publicable y que cada archivo es
// idéntico byte a byte a su origen. Correr tras `npm run build`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(RAIZ, 'dist');
// Lista propia (no importada del build): si el build se desvía, esta prueba lo detecta.
const PUBLICADOS = ['index.html', 'adminpanel', 'assets', 'app-demo.mp4'];

function archivos(base, ruta) {
  const abs = join(base, ruta);
  if (!statSync(abs).isDirectory()) return [ruta];
  return readdirSync(abs).filter((n) => n !== '.DS_Store')
    .flatMap((n) => archivos(base, join(ruta, n)));
}

if (!existsSync(DIST)) {
  console.error('Falta dist/: correr `npm run build` antes.');
  process.exit(1);
}

const errores = [];
const esperados = PUBLICADOS.flatMap((p) => archivos(RAIZ, p)).sort();
const obtenidos = readdirSync(DIST).flatMap((n) => archivos(DIST, n)).sort();

for (const f of esperados) if (!obtenidos.includes(f)) errores.push(`falta en dist: ${f}`);
for (const f of obtenidos) if (!esperados.includes(f)) errores.push(`sobra en dist: ${f}`);
for (const f of esperados.filter((x) => obtenidos.includes(x))) {
  if (!readFileSync(join(RAIZ, f)).equals(readFileSync(join(DIST, f)))) errores.push(`difiere del origen: ${f}`);
}
for (const f of ['assets/config.js', 'index.html', 'adminpanel/index.html', 'app-demo.mp4']) {
  if (!obtenidos.includes(f)) errores.push(`obligatorio ausente: ${f}`);
}
for (const f of obtenidos) {
  if (/^(vercel\.json|package(-lock)?\.json|docs|tests|supabase|\.github|\.claude|scripts)(\/|$)/.test(f) || basename(f) === '.env') {
    errores.push(`no debe publicarse: ${f}`);
  }
}

if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log(`dist/ ok: ${obtenidos.length} archivos idénticos al origen, sin vercel.json ni docs/tests/supabase.`);
