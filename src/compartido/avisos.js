// Cola de avisos (toasts) del front nuevo. Sin runes a propósito: es un store clásico para que lo lea Avisos.svelte y para que
// cualquier módulo avise sin depender del componente. Duraciones como en core/ui.js (3,5 s; 6 s los errores).
import { writable } from 'svelte/store';

export function crearAvisos({ duracion = 3500, duracionError = 6000 } = {}) {
  const { subscribe, update, set } = writable([]);
  const temporizadores = new Map();
  let n = 0;

  function cerrar(id) {
    clearTimeout(temporizadores.get(id));
    temporizadores.delete(id);
    update((l) => l.filter((a) => a.id !== id));
  }

  function avisar(mensaje, { error = false } = {}) {
    const id = ++n;
    update((l) => [...l, { id, mensaje, error }]);
    temporizadores.set(id, setTimeout(() => cerrar(id), error ? duracionError : duracion));
    return id;
  }

  function limpiar() {
    temporizadores.forEach((t) => clearTimeout(t));
    temporizadores.clear();
    set([]);
  }

  return { subscribe, avisar, cerrar, limpiar };
}

// Instancia del panel: las pantallas usan `avisar(texto)` o `avisar(texto, { error: true })`.
export const avisos = crearAvisos();
export const avisar = (mensaje, opciones) => avisos.avisar(mensaje, opciones);
