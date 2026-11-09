// Precios de compra y costos de eventos. La base NO entrega neumaticos.precio_unidad ni eventos_neumatico.costo por
// select (privilegios por columna, migración 20261116500000): se leen con las funciones neumaticos_precios() y
// eventos_costos(), que solo responden a admin y perfil global. Un perfil de sucursal no pide nada: ni se hace la
// llamada ni se muestra el campo. Las vistas y las pantallas solo incorporan estos valores si están en el Map.
import { db } from './supabase.js';
import { puedeVerPrecios } from './auth.js';
import { fetchAll, PAGE_SIZE } from '../domain/reportes.js';

export { conValor } from '../domain/precios.js';

const aMap = filas => new Map((filas || []).map(f => [f.id, f.valor]));

// Map id de neumático -> precio de compra. opciones: { vehiculoId, soloStock }.
// Devuelve { precios: Map, error }: ante un fallo el Map queda vacío y el llamador sigue sin precios.
export async function traerPrecios({ vehiculoId = null, soloStock = false } = {}) {
  if (!puedeVerPrecios()) return { precios: new Map(), error: null };
  const r = await fetchAll((from, to) => db.rpc('neumaticos_precios', { p_vehiculo: vehiculoId, p_solo_stock: soloStock })
    .order('id').range(from, to), { pageSize: PAGE_SIZE, max: 50000 });
  if (r.error) return { precios: new Map(), error: r.error };
  return { precios: aMap(r.rows.map(x => ({ id: x.id, valor: x.precio_unidad }))), error: null };
}

// Map id de evento -> costo.
export async function traerCostos({ vehiculoId = null } = {}) {
  if (!puedeVerPrecios()) return { costos: new Map(), error: null };
  const r = await fetchAll((from, to) => db.rpc('eventos_costos', { p_vehiculo: vehiculoId })
    .order('id').range(from, to), { pageSize: PAGE_SIZE, max: 50000 });
  if (r.error) return { costos: new Map(), error: r.error };
  return { costos: aMap(r.rows.map(x => ({ id: x.id, valor: x.costo }))), error: null };
}
