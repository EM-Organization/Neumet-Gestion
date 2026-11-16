// Punto de entrada que el panel viejo importará como /panel/islas.js (docs/19 §5.2). Nombre fijo en el build.
import { mount, unmount } from 'svelte';
import { crearRegistro, API_ISLAS } from './registro.js';
import Hola from './componentes/Hola.svelte';

const registro = crearRegistro();
const componentes = { hola: Hola };

export { API_ISLAS };
export const montar = (nombre, el, ctx) => registro.montar(nombre, el, ctx, componentes, { mount, unmount });
export const desmontar = (nombre) => registro.desmontar(nombre);
