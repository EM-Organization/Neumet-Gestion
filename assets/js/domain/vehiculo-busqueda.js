// Búsqueda de vehículos por matrícula o número de coche (lógica pura, sin DOM). Tests: tests/unit/vehiculo-detalle.test.mjs

// Igual que public.normalizar_patente (init_schema): mayúsculas y sin espacios en blanco; vacío -> null.
export function normalizarPatente(p) {
  const s = String(p ?? '').replace(/\s+/g, '').toUpperCase();
  return s === '' ? null : s;
}

// Clave de comparación del buscador: mayúsculas, sin tildes y solo letras y dígitos. "ab-123 cd", "AB 123 CD" y "AB123CD"
// dan la misma clave, y "Camión 01" = "camion01". Antes solo se quitaban los espacios: una matrícula guardada como
// "SAB-1234" no se encontraba escribiendo "SAB1234", ni al revés.
export function claveBusqueda(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Puntaje de coincidencia de un vehículo con el texto buscado (0 = no coincide).
// 4 = patente o número exactos · 3 = empieza igual · 2 = contiene en patente/número · 1 = contiene en el nombre.
function puntaje(v, needle) {
  const campos = [claveBusqueda(v.patente), claveBusqueda(v.numero)];
  if (campos.some(c => c === needle)) return 4;
  if (campos.some(c => c && c.startsWith(needle))) return 3;
  if (campos.some(c => c && c.includes(needle))) return 2;
  if (claveBusqueda(v.nombre).includes(needle)) return 1;
  return 0;
}

// Vehículos que coinciden (parcial, sin distinguir mayúsculas, tildes ni espacios) con texto.
// Orden: mejor coincidencia primero y, a igual puntaje, por nombre. Texto vacío = todos, en el orden recibido.
export function buscarVehiculos(vehiculos, texto) {
  const needle = claveBusqueda(texto);
  const lista = vehiculos || [];
  if (!needle) return lista.slice();
  return lista
    .map(v => ({ v, p: puntaje(v, needle) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || String(a.v.nombre ?? '').localeCompare(String(b.v.nombre ?? ''), 'es'))
    .map(x => x.v);
}

// Si hay UNA sola coincidencia exacta de matrícula o de número de coche devuelve ese vehículo (Enter lo abre directo); si no, null.
export function coincidenciaExacta(vehiculos, texto) {
  const needle = claveBusqueda(texto);
  if (!needle) return null;
  const exactos = (vehiculos || []).filter(v => claveBusqueda(v.patente) === needle || claveBusqueda(v.numero) === needle);
  return exactos.length === 1 ? exactos[0] : null;
}

// Qué hace el buscador con el texto escrito (lo usan el buscador global y el de Inicio).
//   vacio   -> no hay texto
//   abrir   -> una coincidencia exacta de matrícula o número, o una única coincidencia: se abre el detalle
//   lista   -> varias coincidencias: se muestra la lista (items = las primeras `max`, total = todas)
//   ninguno -> sin coincidencias
export function resolverBusqueda(vehiculos, texto, max = 8) {
  if (!claveBusqueda(texto)) return { accion: 'vacio', items: [], total: 0, vehiculo: null };
  const todos = buscarVehiculos(vehiculos, texto);
  const exacto = coincidenciaExacta(vehiculos, texto);
  if (exacto) return { accion: 'abrir', items: [exacto], total: todos.length, vehiculo: exacto };
  if (todos.length === 1) return { accion: 'abrir', items: todos, total: 1, vehiculo: todos[0] };
  if (!todos.length) return { accion: 'ninguno', items: [], total: 0, vehiculo: null };
  return { accion: 'lista', items: todos.slice(0, max), total: todos.length, vehiculo: null };
}
