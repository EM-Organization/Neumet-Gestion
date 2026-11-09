// Precios y costos (lógica pura). Tests: tests/unit/precios.test.mjs
// La base entrega precio_unidad y costo aparte (neumaticos_precios / eventos_costos): se incorporan a las filas por id.

// Copia cada fila agregando `campo` con el valor del Map por id; sin valor (o sin permiso: Map vacío) queda en null.
export function conValor(filas, mapa, campo) {
  const m = mapa instanceof Map ? mapa : new Map();
  return (Array.isArray(filas) ? filas : []).map(f => ({ ...f, [campo]: m.has(f.id) ? m.get(f.id) : null }));
}

// Texto del costo de un evento para la línea de tiempo; vacío si no hay costo.
export function textoCosto(costo) {
  return costo === null || costo === undefined || costo === '' ? '' : ' · costo ' + costo;
}
