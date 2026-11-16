// Punto de entrada que el panel viejo importa como /panel/islas.js (docs/19 §5.2). Nombre fijo en el build.
// Este módulo lleva consigo su CSS: al montar enlaza las hojas del build (estilos-isla.js), sin <style> ni <link> en el HTML viejo.
import './estilos.css';
import { mount, unmount } from 'svelte';
import { crearRegistro, API_ISLAS } from './registro.js';
import { cargarHojas } from './estilos-isla.js';
import Hola from './componentes/Hola.svelte';

const registro = crearRegistro();
const componentes = { hola: Hola };

export { API_ISLAS };

// Asíncrono porque espera las hojas de estilo; devuelve false (sin tocar el DOM) si la bandera está apagada para el rol,
// si la isla no existe o si el `ctx` es de otra versión del contrato (defensa: el panel viejo ya lo comprueba antes).
export async function montar(nombre, el, ctx) {
  if (ctx?.api !== API_ISLAS || !registro.activa(nombre, ctx.rol) || !componentes[nombre]) return false;
  await cargarHojas();
  return registro.montar(nombre, el, ctx, componentes, { mount, unmount });
}
export const desmontar = (nombre) => registro.desmontar(nombre);
export const desmontarTodas = () => registro.desmontarTodas();
// Para que el panel viejo sepa antes de ocultar su vista si la isla se va a montar.
export const activa = (nombre, rol) => registro.activa(nombre, rol);
