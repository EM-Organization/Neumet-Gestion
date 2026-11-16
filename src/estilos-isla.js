// Carga de las hojas de estilo de las islas (docs/19 §7.1.1). Las hojas las fija el build: scripts/vite-css-islas.mjs sustituye el
// marcador por la lista real. Sin build (vite dev, Vitest) el marcador queda intacto y no hay hojas que enlazar: Vite sirve el CSS por su cuenta.
// El literal aparece UNA sola vez en el fuente (el plugin exige exactamente una aparición en el bundle).
const HOJAS_CRUDAS = '__NEUMET_HOJAS_CSS__';
const ESPERA_MAX_MS = 4000;

export const hojasDelBuild = (crudo = HOJAS_CRUDAS) => (crudo.startsWith('__NEUMET_') ? [] : crudo.split(',').filter(Boolean));

// Enlaza cada hoja una sola vez. Resuelve cuando todas cargaron (o fallaron, o pasó el tope): montar sin estilos es peor
// que esperar unos milisegundos, pero nunca debe quedar colgado.
export function cargarHojas({ hojas = hojasDelBuild(), base = import.meta.url, doc = document } = {}) {
  const esperas = hojas.map((archivo) => {
    const href = new URL(`./${archivo}`, base).href;
    const previo = [...doc.head.querySelectorAll('link[data-neumet-hoja]')].find((l) => l.dataset.neumetHoja === href);
    if (previo) return previo.__listo ?? Promise.resolve();
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.neumetHoja = href;
    link.__listo = new Promise((ok) => {
      link.addEventListener('load', ok, { once: true });
      link.addEventListener('error', ok, { once: true });
      setTimeout(ok, ESPERA_MAX_MS);
    });
    doc.head.appendChild(link);
    return link.__listo;
  });
  return Promise.all(esperas).then(() => undefined);
}
