// Búsqueda de vehículos por matrícula o número de coche (lógica pura, sin DOM). Tests: tests/unit/vehiculo-detalle.test.mjs

// Igual que public.normalizar_patente (init_schema): mayúsculas y sin espacios en blanco; vacío -> null.
export function normalizarPatente(p) {
  const s = String(p ?? '').replace(/\s+/g, '').toUpperCase();
  return s === '' ? null : s;
}

// Clave de comparación para el buscador: como normalizarPatente, y además sin tildes (sirve para nombres: "Camión" = "camion").
export function claveBusqueda(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase();
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
