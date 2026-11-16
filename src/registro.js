// Registro de islas y banderas por rol (docs/19 §5.2 y §5.3). Lógica sin DOM propio, probada en registro.test.js.
export const API_ISLAS = 1;

// Bandera apagada por defecto: sin roles, ningún rol enciende la isla. Encender es un PR de una línea.
export const ISLAS = { hola: { roles: [] } };

// Override de soporte (docs/19 §5.3): localStorage.neumet_islas = 'off' apaga todas las islas.
function apagadaPorSoporte() {
  try { return globalThis.localStorage?.getItem('neumet_islas') === 'off'; } catch { return false; }
}

export function crearRegistro(islas = ISLAS) {
  const montadas = new Map(); // nombre -> función que desmonta

  const activa = (nombre, rol) => {
    if (apagadaPorSoporte()) return false;
    const cfg = islas[nombre];
    return Boolean(cfg && rol && cfg.roles.includes(rol));
  };

  const desmontar = (nombre) => {
    const fin = montadas.get(nombre);
    if (fin) { fin(); montadas.delete(nombre); }
  };

  // `svelte` ({mount, unmount}) se inyecta para que el registro no dependa del runtime en las pruebas de banderas.
  const montar = (nombre, el, ctx, componentes, svelte) => {
    if (!activa(nombre, ctx?.rol) || !componentes[nombre]) return false;
    desmontar(nombre);
    const instancia = svelte.mount(componentes[nombre], { target: el, props: { ctx } });
    montadas.set(nombre, () => svelte.unmount(instancia));
    return true;
  };

  return { activa, montar, desmontar };
}
