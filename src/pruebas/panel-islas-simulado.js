// Solo para Vitest (vite.config.mjs lo pone como alias de /panel/islas.js): el paquete real solo existe tras el build.
// Cada prueba fija globalThis.__panelIslas = { API_ISLAS, montar, desmontar } antes de montar.
export const API_ISLAS = 1;
export const montar = (...a) => globalThis.__panelIslas.montar(...a);
export const desmontar = (...a) => globalThis.__panelIslas.desmontar(...a);
