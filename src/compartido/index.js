// Sistema de diseño base y capa de datos del front nuevo (F11 ola 0, PR 2b; docs/19 §3 y §5). Las pantallas importan de aquí.
export { default as Boton } from './Boton.svelte';
export { default as Insignia } from './Insignia.svelte';
export { default as EstadoVacio } from './EstadoVacio.svelte';
export { default as Tabla } from './Tabla.svelte';
export { default as Modal } from './Modal.svelte';
export { default as SelectorRango } from './SelectorRango.svelte';
export { default as Avisos } from './Avisos.svelte';
export { avisos, avisar, crearAvisos } from './avisos.js';
export { userError, mensajeDeError, ejecutar, crearDatos } from './datos.js';
