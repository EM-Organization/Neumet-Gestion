// Dominio PURO: pestañas de la vista Neumáticos (Stock | Recauchutado). Sin DOM ni supabase.

export const PESTANA_STOCK = 'stock';
export const PESTANA_RECAUCHUTADO = 'recauchutado';

// Quien ve Stock ve Recauchutado, salvo el usuario de sucursal (no gestiona recauchutado y la lista no le corresponde).
// El equipo Neumet la ve en solo lectura; el administrador de empresa la gestiona. Las acciones las guarda recauchutado.js.
export function pestanasVisibles({ admin = false, adminEmpresa = false } = {}) {
  return admin || adminEmpresa ? [PESTANA_STOCK, PESTANA_RECAUCHUTADO] : [PESTANA_STOCK];
}

// Pestaña destino de una tecla de navegación (flechas con vuelta, Inicio, Fin); null si la tecla no navega
// o no hay otra pestaña a la que ir.
export function pestanaPorTecla(visibles, actual, tecla) {
  const n = (visibles || []).length;
  if (n < 2) return null;
  const i = visibles.indexOf(actual);
  const base = i < 0 ? 0 : i;
  if (tecla === 'ArrowRight' || tecla === 'ArrowDown') return visibles[(base + 1) % n];
  if (tecla === 'ArrowLeft' || tecla === 'ArrowUp') return visibles[(base - 1 + n) % n];
  if (tecla === 'Home') return visibles[0];
  if (tecla === 'End') return visibles[n - 1];
  return null;
}

// El tablist solo se muestra si hay más de una pestaña: una sola no ayuda a decidir nada.
export const hayPestanas = visibles => (visibles || []).length > 1;
