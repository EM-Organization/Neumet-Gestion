// Lógica del panel de una rueda del detalle de vehículo y de su cabecera (sin DOM ni base de datos).
import { fmtNum } from './formato.js';

const nulo = v => v === null || v === undefined;

// Plazo en semanas con concordancia: «en 1 semana», «en unas 2 semanas», «en unas 2,5 semanas». Se redondea a un decimal;
// si el resultado es entero se escribe sin decimal («2», no «2,0»).
export function textoSemanas(semanas) {
  const r = Math.round(semanas * 10) / 10;
  if (r < 1) return 'en menos de 1 semana'; // «en unas 0 semanas» o «0,4 semanas» no se leen bien
  if (r === 1) return 'en 1 semana';
  if (Number.isInteger(r)) return `en unas ${fmtNum(r)} semanas`;
  return `en unas ${fmtNum(r, 1)} semanas`;
}

// Semanas hasta un umbral por la huella mínima (RN-01), la misma que decide el estado. v_estado_neumaticos.semanas_hasta_*
// todavía proyecta con el promedio (G-04, pendiente en docs/08): con 3,2 mm de mínimo y 6 de promedio anunciaría semanas de más.
// Sin tasa positiva o sin mínimo no hay proyección (null); por debajo del umbral, 0.
export function semanasHasta(minimo, umbral, tasa) {
  if (nulo(minimo) || nulo(umbral) || nulo(tasa) || !(Number(tasa) > 0)) return null;
  return Math.max(Number(minimo) - Number(umbral), 0) / Number(tasa);
}

// Un solo aviso por rueda, por prioridad: bajo el límite de retiro manda retirar (no se rota); si no, el desgaste acelerado
// (la razón es el aviso y la proyección va debajo); si no, la proyección a límite. Sin nada que decir, null.
// La etiqueta «Desgaste acelerado» ya la pone el panel, así que el aviso no la repite.
export function avisoPanel({ bajoRetiro, razonAcelerado, semanasRetiro }) {
  if (bajoRetiro) return { titulo: 'Retirar ya.', texto: 'Bajo el límite de retiro no se rota a otro eje.', proyeccion: null };
  const proyeccion = nulo(semanasRetiro) ? null : `Llega a desgaste límite ${textoSemanas(semanasRetiro)}`;
  if (razonAcelerado) return { titulo: null, texto: razonAcelerado, proyeccion };
  return proyeccion ? { titulo: null, texto: proyeccion, proyeccion: null } : null;
}

// «Km que ya traía»: sin registrar (null) no es lo mismo que 0 km.
export function textoKmPrevios(v) {
  return nulo(v) ? 'Sin registrar' : `${fmtNum(v)} km`;
}

// Ítems del menú «Más» de la cabecera del vehículo, en el orden en que se muestran. Sin ítems, la vista no dibuja el menú.
// Eliminar va último y en rojo: es lo único destructivo de la cabecera.
export function itemsMasCabecera({ puedeOperar, esAdminEmpresa, vehiculoId }) {
  const items = [];
  if (puedeOperar) items.push({ label: 'Distribución y servicio', action: 'vehiculo-cambiar-distribucion', args: [vehiculoId] });
  if (esAdminEmpresa) items.push({ label: 'Odómetro y ciclo de vida', action: 'openCicloVida', args: [vehiculoId, true] });
  if (esAdminEmpresa) items.push({ label: 'Eliminar vehículo', action: 'vehiculo-eliminar', args: [vehiculoId], peligro: true });
  return items;
}
