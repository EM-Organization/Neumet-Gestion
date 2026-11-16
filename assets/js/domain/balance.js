// Lógica pura de Balance (sin DOM ni supabase): unión de clientes con sus precios mensuales y mensajes de error del precio.
// El precio mensual ya no se lee de `clientes` (la migración C2 de docs/17 lo oculta): llega por la RPC cliente_precios_mensuales.

// Clientes + filas { cliente_id, precio_mensual } de la RPC. Un cliente sin fila (o con null) queda en 0.
export function unirPrecios(clientes, precios) {
  const porCliente = new Map((precios || []).map(p => [p.cliente_id, Number(p.precio_mensual) || 0]));
  return (clientes || []).map(c => ({ ...c, precio_mensual: porCliente.get(c.id) ?? 0 }));
}

// Valor tecleado en el campo de precio: vacío o inválido es 0, nunca negativo.
export function precioDeEntrada(val) {
  return Math.max(0, parseFloat(val) || 0);
}

// Aviso para un error de cliente_precio_mensual_fijar (o de cliente_precios_mensuales al cargar), según el código SQLSTATE.
export function mensajeErrorPrecio(error, accion = 'guardar') {
  switch (error && error.code) {
    case '42501': return accion === 'cargar' ? 'Sin permiso para ver los precios' : 'Sin permiso para cambiar precios';
    case '22023': return 'Precio inválido. Ingresar un monto entre 0 y 9.999.999.999';
    case 'P0002': return 'El cliente ya no existe. Recargar la lista';
    default: return accion === 'cargar' ? 'No se pudieron cargar los precios. Reintentar' : 'No se pudo guardar el precio. Reintentar';
  }
}
