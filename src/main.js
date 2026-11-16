// Entrada de /panel/ (andamiaje, F11 PR 1). El shell nuevo llega en la ola 5; hasta entonces esta página no
// muestra nada: la isla de humo está detrás de una bandera sin roles y aquí no hay sesión que consultar.
import { montar, API_ISLAS } from './islas.js';

const el = document.getElementById('app');
if (el) montar('hola', el, { api: API_ISLAS, rol: null });
