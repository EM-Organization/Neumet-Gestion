// Comprueba que dist/ contiene exactamente lo publicable (lo viejo idéntico byte a byte a su origen, más
// dist/panel/** que genera Vite) y que el front nuevo cumple la CSP de vercel.json. Correr tras `npm run build`.
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
const todos = readdirSync(DIST).flatMap((n) => archivos(DIST, n)).sort();
// dist/panel/** es lo único nuevo permitido (salida de Vite, docs/19 §5.2); lo demás debe coincidir con la lista vieja.
const panel = todos.filter((f) => f.startsWith('panel/'));
const obtenidos = todos.filter((f) => !f.startsWith('panel/'));

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

// Front nuevo: sin código ni estilo en línea (la CSP de vercel.json no los admite), sin eval, sin secretos, con tope de tamaño.
const TOPE_PANEL_BYTES = 1024 * 1024; // se sube a conciencia cuando lleguen pantallas reales; hoy el humo pesa unos 26 kB
for (const f of ['panel/index.html', 'panel/islas.js']) {
  if (!panel.includes(f)) errores.push(`obligatorio ausente: ${f}`);
}
let bytesPanel = 0;
for (const f of panel) {
  const buf = readFileSync(join(DIST, f));
  bytesPanel += buf.length;
  const texto = buf.toString('utf8');
  if (f.endsWith('.html')) {
    if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(texto)) errores.push(`script en línea (la CSP lo bloquea): ${f}`);
    if (/<style[\s>]/i.test(texto)) errores.push(`<style> en línea: ${f}`);
    if (/\sstyle\s*=/i.test(texto)) errores.push(`atributo style en línea: ${f}`);
    if (/\son[a-z]+\s*=/i.test(texto)) errores.push(`manejador de evento en línea: ${f}`);
    for (const m of texto.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      if (!m[1].startsWith('/panel/')) errores.push(`referencia fuera de /panel/ en ${f}: ${m[1]}`);
    }
  }
  if (f.endsWith('.js') && /\beval\s*\(|new\s+Function\s*\(/.test(texto)) errores.push(`eval o new Function en ${f}`);
  if (/sb_secret_|service_role/.test(texto)) errores.push(`posible secreto en ${f}`);
}
// El CSS viaja con islas.js (docs/19 §7.1.1 a): cada hoja que islas.js enlaza debe existir en dist/panel/, y no puede quedar el marcador sin sustituir.
// islas.js re-exporta un chunk con hash: el enlace a la hoja vive en cualquier .js de dist/panel, relativo a ese archivo.
{
  let enlaces = 0;
  for (const f of panel.filter((x) => x.endsWith('.js'))) {
    const js = readFileSync(join(DIST, f), 'utf8');
    if (js.includes('__NEUMET_HOJAS_CSS__')) errores.push(`${f} conserva el marcador de hojas CSS sin sustituir`);
    for (const m of js.matchAll(/["'`]((?:\.\/)?[\w./-]+\.css)["'`]/g)) {
      enlaces++;
      const destino = join(dirname(f), m[1]).split('\\').join('/');
      if (!panel.includes(destino)) errores.push(`${f} enlaza una hoja que no existe: ${m[1]} (${destino})`);
    }
  }
  if (enlaces === 0) errores.push('ningún .js de dist/panel enlaza la hoja CSS de las islas');
}
if (bytesPanel > TOPE_PANEL_BYTES) errores.push(`dist/panel pesa ${bytesPanel} bytes, sobre el tope de ${TOPE_PANEL_BYTES}`);

if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log(`dist/ ok: ${obtenidos.length} archivos idénticos al origen, dist/panel/ con ${panel.length} archivos (${bytesPanel} bytes), sin vercel.json ni docs/tests/supabase.`);
