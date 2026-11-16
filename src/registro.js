// Registro de islas y banderas por rol (docs/19 §5.2 y §5.3). Lógica sin DOM propio, probada en registro.test.js.
// Versión del contrato `ctx` (ver assets/js/core/islas.js, que define el `ctx`). Subirla en AMBOS lados al cambiar el contrato:
// el panel viejo compara y, si no coincide, pide recargar la página en vez de montar una isla con un `ctx` que no entiende.
import { puedeUsarPanel } from '@domain/rol.js';
export const API_ISLAS = 1;

// Bandera apagada por defecto: sin roles, ningún rol enciende la isla. Encender es un PR de una línea.
// `forzable`: el soporte (y las pruebas e2e) pueden encenderla con localStorage.neumet_islas = 'on:<nombre>'. Solo la isla de humo,
// que no muestra datos de negocio: una pantalla real nunca es forzable (la visibilidad de datos la decide la base, no la bandera).
export const ISLAS = { hola: { roles: [], forzable: true } };

// Override de soporte (docs/19 §5.3): localStorage.neumet_islas = 'off' apaga todas las islas;
// 'on:hola,otra' enciende las islas forzables nombradas, para cualquier rol con acceso al panel.
function overrideDeSoporte() {
  try { return globalThis.localStorage?.getItem('neumet_islas') ?? ''; } catch { return ''; }
}

// «sin_acceso» y la sesión sin resolver nunca montan nada: se usa la misma regla del panel viejo (domain/rol.js).
const rolConPanel = puedeUsarPanel;

export function crearRegistro(islas = ISLAS) {
  const montadas = new Map(); // nombre -> función que desmonta

  const activa = (nombre, rol) => {
    const override = overrideDeSoporte();
    if (override === 'off') return false;
    const cfg = islas[nombre];
    if (!cfg || !rol) return false;
    if (cfg.forzable && rolConPanel(rol) && override.startsWith('on:') && override.slice(3).split(',').includes(nombre)) return true;
    return cfg.roles.includes(rol);
  };

  const desmontar = (nombre) => {
    const fin = montadas.get(nombre);
    if (fin) { fin(); montadas.delete(nombre); }
  };

  const desmontarTodas = () => { for (const nombre of [...montadas.keys()]) desmontar(nombre); };

  // `svelte` ({mount, unmount}) se inyecta para que el registro no dependa del runtime en las pruebas de banderas.
  const montar = (nombre, el, ctx, componentes, svelte) => {
    if (!activa(nombre, ctx?.rol) || !componentes[nombre]) return false;
    desmontar(nombre);
    const instancia = svelte.mount(componentes[nombre], { target: el, props: { ctx } });
    montadas.set(nombre, () => svelte.unmount(instancia));
    return true;
  };

  return { activa, montar, desmontar, desmontarTodas, montadas: () => [...montadas.keys()] };
}
