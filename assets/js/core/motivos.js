// Carga del catálogo de motivos y del flag de odómetro obligatorio del cliente (RN-12, RN-14). Las vistas de movimientos
// lo usan para pedir los datos antes de abrir un diálogo. La base vuelve a validar: esto solo guía al operario.
import { db } from './supabase.js';

// Devuelve { catalogo, odometroObligatorio }. Si una consulta falla, el diálogo no se abre: no se adivina el flag.
export async function cargarMotivosCliente(clienteId) {
  const [rc, rk] = await Promise.all([
    db.from('motivos_movimiento').select('tipo,codigo,etiqueta,orden,activo').eq('activo', true),
    db.from('clientes').select('odometro_obligatorio').eq('id', clienteId).maybeSingle()
  ]);
  if (rc.error || rk.error) {
    console.error(rc.error || rk.error);
    return null;
  }
  return { catalogo: rc.data || [], odometroObligatorio: !!(rk.data && rk.data.odometro_obligatorio) };
}
