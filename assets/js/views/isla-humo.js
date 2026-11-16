// Isla de humo (F11 PR 2): registra la vista «hola», que monta src/componentes/Hola.svelte si la bandera lo permite.
// No tiene entrada de menú ni HTML propio: solo se llega por código (ctx.navegar o ACTIONS.irA) y con la bandera apagada no hace nada visible.
// Sirve para probar el contrato `ctx` y el montaje/desmontaje contra el panel construido (tests/e2e/specs/islas.mjs).
import { registrarIsla } from '../core/islas.js';

registrarIsla('hola', 'Isla de prueba');

export function init() {}
