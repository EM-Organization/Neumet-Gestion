// Reglas puras de la pantalla de Inicio (sin DOM ni supabase). Tests: tests/unit/inicio.test.mjs

// El estado "sin datos" solo corresponde cuando NO hay vehículos registrados ni ninguna fila en las vistas derivadas
// (neumáticos, alertas, dispositivos). Un cliente con vehículos pero sin neumáticos medidos NO está "sin datos":
// tiene vehículos y debe verlos (las vistas v_estado_neumaticos/v_alertas solo traen filas con neumáticos o mediciones).
//   'vacio' | 'sin_mediciones' | 'con_datos'
export function estadoInicio({ vehiculosTotal = 0, estadoRows = [], alertas = [], salud = [] } = {}) {
  const v = Number(vehiculosTotal) || 0;
  if (!v && !estadoRows.length && !alertas.length && !salud.length) return 'vacio';
  if (!estadoRows.length) return 'sin_mediciones';
  return 'con_datos';
}
