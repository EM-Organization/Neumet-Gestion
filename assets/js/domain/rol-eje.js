// Rol de cada posición de rueda según el eje al que pertenece (CA-31). Dominio puro: sin DOM ni supabase.
// Sale de la distribución y del numerado de layoutRuedas; no hay tabla a mano:
//   - ejes simples antes del primer doble: dirección (en el catálogo, el primer eje es siempre el delantero y simple);
//   - ejes dobles: tracción (son los motrices, la B del código AxB);
//   - ejes simples después del primer doble: eje loco.
// Tests: tests/unit/rol-eje.test.mjs
import { buscarDistribucion } from './distribucion.js';
import { layoutRuedas, POS_AUXILIO } from './vehiculo-diagrama.js';

export const ROLES_EJE = Object.freeze({ direccion: 'Dirección', traccion: 'Tracción', loco: 'Eje loco', auxilio: 'Auxilio' });

// Rol (clave de ROLES_EJE) de la rueda `posicion` (1 = la primera del eje delantero) en la distribución `distribucion`
// (código del catálogo). null si la posición no existe en esa distribución.
// Sin distribución del catálogo («Otra» o sin definir) no hay ejes: solo se sabe que 1 y 2 son el eje delantero.
export function rolEjePosicion(distribucion, posicion) {
  const p = Number(posicion);
  if (p === POS_AUXILIO) return 'auxilio';
  if (!Number.isInteger(p) || p < 1) return null;
  const d = buscarDistribucion(distribucion);
  if (!d) return p <= 2 ? 'direccion' : null;
  const ejes = layoutRuedas([], d.id).ejes;
  const indice = ejes.findIndex(e => e.ruedas.some(r => r.posicion === p));
  if (indice < 0) return null;
  if (ejes[indice].dual) return 'traccion';
  return indice < ejes.findIndex(e => e.dual) ? 'direccion' : 'loco';
}
