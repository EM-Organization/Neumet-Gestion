// Plugin de Vite (F11 PR 2, docs/19 §7.1.1): hace que el CSS viaje con /panel/islas.js.
// Vite extrae el CSS de la entrada `islas` a assets/islas-[hash].css pero nada lo enlaza cuando el panel viejo hace
// import('/panel/islas.js'). Aquí se sustituye, en el código ya empaquetado, el marcador de src/estilos-isla.js por la lista
// real de hojas; el módulo las enlaza con <link rel="stylesheet"> (externo, de /panel/: la CSP no lo bloquea y no hay <style> en línea).
import { posix } from 'node:path';

export const MARCADOR_HOJAS = '__NEUMET_HOJAS_CSS__';

export function cssConIslas() {
  return {
    name: 'neumet-css-con-islas',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opciones, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
      const entrada = chunks.find((c) => c.isEntry && c.name === 'islas');
      if (!entrada) throw new Error('neumet-css-con-islas: no hay entrada «islas» en el bundle');
      // El CSS puede quedar en un chunk compartido que la entrada importa (no solo en la entrada misma): se recorren sus imports estáticos.
      const vistos = new Set();
      const hojas = [];
      const recorrer = (c) => {
        if (!c || c.type !== 'chunk' || vistos.has(c.fileName)) return;
        vistos.add(c.fileName);
        for (const h of c.viteMetadata?.importedCss ?? []) if (!hojas.includes(h)) hojas.push(h);
        for (const i of c.imports ?? []) recorrer(bundle[i]);
      };
      recorrer(entrada);
      if (hojas.length === 0) throw new Error('neumet-css-con-islas: la entrada «islas» no importa CSS (src/islas.js debe importar estilos.css)');
      // El marcador vive donde Rollup ponga src/estilos-isla.js (la entrada o un chunk compartido con index.html): debe haber exactamente uno.
      const conMarcador = chunks.filter((c) => c.code.includes(MARCADOR_HOJAS));
      const apariciones = conMarcador.reduce((n, c) => n + c.code.split(MARCADOR_HOJAS).length - 1, 0);
      if (apariciones !== 1) throw new Error(`neumet-css-con-islas: el marcador ${MARCADOR_HOJAS} debe aparecer una vez en el bundle (aparece ${apariciones})`);
      const chunk = conMarcador[0];
      // estilos-isla.js resuelve cada hoja contra import.meta.url del chunk que lo contiene: se escribe relativa a ese chunk.
      const rel = hojas.map((h) => posix.relative(posix.dirname(chunk.fileName), h));
      chunk.code = chunk.code.replace(MARCADOR_HOJAS, rel.join(','));
    },
  };
}
