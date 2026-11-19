// Lógica pura de «Eliminar vehículo» (sin DOM ni supabase). La escritura la hace la RPC vehiculo_eliminar, que vuelve a validar
// todo en la base: aquí solo se decide qué ofrecer, qué pedir y cómo explicar un rechazo.
import { plural } from './formato.js';

export const DESTINOS_NEUMATICOS = ['stock', 'baja'];

// Neumáticos que acompañan al vehículo: los que no están dados de baja (montados, auxilio o en reparación).
// Los ya dados de baja quedan como están. `sinQuema` son los que no pueden volver al stock (la quema identifica a la cubierta).
export function resumenNeumaticos(filas) {
  const vivos = (Array.isArray(filas) ? filas : []).filter(n => n && n.estado !== 'baja');
  const sinQuema = vivos.filter(n => !String(n.numero_quema == null ? '' : n.numero_quema).trim()).length;
  return { total: vivos.length, sinQuema };
}

// Qué ofrece el diálogo: el stock se habilita solo si todos los neumáticos tienen quema; «baja» nunca viene elegida
// (es lo irreversible) y el stock tampoco se preelige si no se puede: el operario elige, no corrige.
export function opcionesDestino({ total, sinQuema }) {
  const stockPosible = total > 0 && sinQuema === 0;
  return {
    hayNeumaticos: total > 0,
    stockPosible,
    porDefecto: stockPosible ? 'stock' : '',
    avisoStock: total > 0 && sinQuema > 0
      ? `${plural(sinQuema, 'neumático no tiene', 'neumáticos no tienen')} número de quema: no pueden volver al stock`
      : ''
  };
}

export function etiquetaDestino(destino, total) {
  if (destino === 'stock') return `Enviar ${total === 1 ? 'el neumático' : `los ${total} neumáticos`} al stock`;
  return `Dar de baja ${total === 1 ? 'el neumático' : `los ${total} neumáticos`}`;
}

export function textoResumen({ total, destino }) {
  if (total === 0) return 'El vehículo no tiene neumáticos. Se elimina de la lista.';
  if (destino === 'stock') return `${plural(total, 'neumático vuelve', 'neumáticos vuelven')} al stock y ${total === 1 ? 'conserva' : 'conservan'} su historial.`;
  if (destino === 'baja') return `${plural(total, 'neumático queda', 'neumáticos quedan')} dado${total === 1 ? '' : 's'} de baja con el vehículo.`;
  return 'Elegir qué hacer con los neumáticos';
}

// Valida lo elegido y arma los parámetros de la RPC. Sin neumáticos no se envía destino (la base lo ignora).
export function validarEliminar({ vehiculoId, total, sinQuema, destino }) {
  if (!Number.isInteger(vehiculoId)) return { ok: false, error: 'Elegir el vehículo a eliminar' };
  if (!(total > 0)) return { ok: true, params: { p_vehiculo_id: vehiculoId, p_destino_neumaticos: null }, resumen: textoResumen({ total: 0 }) };
  if (!DESTINOS_NEUMATICOS.includes(destino)) return { ok: false, error: 'Elegir qué hacer con los neumáticos' };
  if (destino === 'stock' && sinQuema > 0) {
    return { ok: false, error: `${plural(sinQuema, 'neumático no tiene', 'neumáticos no tienen')} número de quema: darlos de baja` };
  }
  return { ok: true, params: { p_vehiculo_id: vehiculoId, p_destino_neumaticos: destino }, resumen: textoResumen({ total, destino }) };
}

// Error de la RPC (PostgREST: {code, message}) -> mensaje que dice qué pasó y qué hacer.
export function traducirErrorEliminar(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) {
    return 'Sin permiso para eliminar este vehículo. Solo lo hace el administrador de la empresa';
  }
  if (code === 'P0002' || msg.includes('ya fue eliminado')) return 'El vehículo ya fue eliminado. Actualizar la pantalla';
  if (msg.includes('número de quema')) return 'Hay neumáticos sin número de quema: no pueden volver al stock. Darlos de baja';
  if (code === '55000' || msg.includes('recauchutado')) return 'Un neumático está en recauchutado: cerrar ese proceso antes de eliminar el vehículo';
  if (msg.includes('elegir qué hacer') || msg.includes('destino')) return 'Elegir qué hacer con los neumáticos';
  return 'No se pudo eliminar el vehículo. No se guardó nada. Reintentar';
}
