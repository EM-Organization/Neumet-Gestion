// Front nuevo (F11, docs/19 §5.2): Vite + Svelte 5 + Tailwind 4, código en src/, salida en dist/panel/.
// scripts/build.mjs copia primero lo viejo a dist/ y luego corre `vite build`; esta config nunca escribe fuera de dist/panel/.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { cssConIslas } from './scripts/vite-css-islas.mjs';

const ruta = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: ruta('./src'),
  base: '/panel/',
  publicDir: false,
  plugins: [
    // runes: true rechaza la sintaxis de Svelte 4 (docs/19 §4.3); toda advertencia del compilador
    // (incluidas las de accesibilidad) hace fallar el build.
    svelte({
      configFile: false, // toda la configuración vive aquí, no en un svelte.config.js aparte
      compilerOptions: { runes: true },
      onwarn: (aviso) => { throw new Error(`${aviso.code}: ${aviso.message}`); },
    }),
    tailwindcss(),
    // El CSS viaja con /panel/islas.js (docs/19 §7.1.1): sin esto nada enlaza la hoja que Vite extrae de la entrada.
    cssConIslas(),
  ],
  resolve: {
    // domain/ es lógica pura compartida con el panel viejo: una sola copia (docs/19 §5.6).
    alias: { '@domain': ruta('./assets/js/domain') },
    // Vitest necesita la build de navegador de Svelte para mount() en jsdom.
    conditions: process.env.VITEST ? ['browser'] : undefined,
  },
  server: { fs: { allow: [ruta('.')] } },
  build: {
    outDir: ruta('./dist/panel'),
    emptyOutDir: true, // solo dist/panel/: lo viejo en dist/ no se toca
    target: 'es2022',
    rollupOptions: {
      input: { index: ruta('./src/index.html'), islas: ruta('./src/islas.js') },
      // islas.js es una API pública para el panel viejo (import dinámico): Vite la recorta a lo que usa index.html salvo que
      // se pida conservar la firma de la entrada completa.
      preserveEntrySignatures: 'strict',
      output: {
        // islas.js lleva nombre fijo: el panel viejo lo importará como /panel/islas.js (docs/19 §5.2); el resto lleva hash.
        entryFileNames: (chunk) => (chunk.name === 'islas' ? 'islas.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.js'],
  },
});
