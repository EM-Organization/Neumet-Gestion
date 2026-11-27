// Dominio del asistente de reportes (docs/24). Funciones PURAS (sin DOM, sin supabase) para testear con node:test.
import { buildCsv } from './reportes.js';
import { plural } from './formato.js';

export const TEXTO_ELEGIR_CLIENTE = 'Elegir un cliente.';
export const TEXTO_SIN_RESPUESTA = 'No se pudo generar la respuesta.';
export const LIMITE_DIARIO = 30;

// Historial que se envía: como mucho 10 turnos y 16 KB (el servidor también lo acota; esto evita pedidos inútiles).
const MAX_TURNOS = 10;
const MAX_BYTES_HISTORIAL = 16384;
// Forma de la respuesta del servidor (contrato C2): tope de lo que se pinta, por si la función devuelve de más.
const MAX_BLOQUES = 20;
const MAX_FILAS = 200;
const MAX_COLUMNAS = 12;

export const PREGUNTA_ALERTAS = 'Alertas activas de la flota agrupadas por tipo y severidad, con los vehículos afectados. Usar alertas_activas.';

// Reportes con botón. Los de la ola 7 existen en el catálogo pero no se muestran todavía (`disponible: false`).
export const REPORTES_LISTOS = [
  { id: 'alertas', titulo: 'Alertas de la flota', pregunta: () => PREGUNTA_ALERTAS, disponible: true, requiereCostos: false, usaPeriodo: false },
  { id: 'mensual', titulo: 'Reporte mensual', pregunta: ({ mes }) => `Reporte mensual de ${mes}: km por mm promedio, costos, ahorro y top de marca y modelo.`, disponible: false, requiereCostos: true, usaPeriodo: true },
  { id: 'trimestral', titulo: 'Reporte trimestral', pregunta: ({ trimestre }) => `Reporte del trimestre ${trimestre} contra el trimestre anterior: costo por km, costo por mm, km por mm, porcentaje de renovación, cubiertas renovadas y ahorro.`, disponible: false, requiereCostos: true, usaPeriodo: true },
  { id: 'descartadas', titulo: 'Rendimiento de descartadas', pregunta: () => 'Rendimiento de las cubiertas descartadas: km por vida y km por mm, por marca, modelo y motivo de baja.', disponible: false, requiereCostos: true, usaPeriodo: false },
];

const pad2 = n => String(n).padStart(2, '0');

// Último mes y último trimestre cerrados respecto de `hoy` («YYYY-MM-DD»). Sin Date: la zona horaria no mueve el resultado.
export function periodosCerrados(hoy) {
  const [anio, mes] = hoy.split('-').map(Number);
  const trimestreActual = Math.floor((mes - 1) / 3) + 1;
  const mesCerrado = mes === 1 ? `${anio - 1}-12` : `${anio}-${pad2(mes - 1)}`;
  const trimestreCerrado = trimestreActual === 1 ? `${anio - 1}-T4` : `${anio}-T${trimestreActual - 1}`;
  return { mes: mesCerrado, trimestre: trimestreCerrado };
}

export function preguntaReporte(id, hoy) {
  const reporte = REPORTES_LISTOS.find(r => r.id === id);
  return reporte ? reporte.pregunta(periodosCerrados(hoy)) : null;
}

// Ids de los reportes que se muestran: los disponibles y, si cuestan costos, solo a quien los ve.
export const reportesVisibles = verCostos => REPORTES_LISTOS
  .filter(r => r.disponible && (!r.requiereCostos || verCostos))
  .map(r => r.id);

// Historial que se envía: pares pregunta/respuesta completos. Una pregunta sin respuesta no entra.
export function turnosCompletados(conversacion) {
  return conversacion
    .filter(e => e.respuesta)
    .flatMap(e => [{ rol: 'usuario', texto: e.pregunta }, { rol: 'asistente', texto: textoRespuesta(e.respuesta.bloques) }]);
}

const bytes = s => new TextEncoder().encode(s).length;

// Se quedan los turnos más recientes. Al primero que no entra se corta: no se salta a turnos más viejos.
export function recortarHistorial(turnos, maxTurnos = MAX_TURNOS, maxBytes = MAX_BYTES_HISTORIAL) {
  const recientes = [];
  let total = 0;
  for (let i = turnos.length - 1; i >= 0 && recientes.length < maxTurnos; i--) {
    const turno = { rol: turnos[i].rol, texto: turnos[i].texto };
    const tamano = bytes(JSON.stringify(turno));
    if (total + tamano > maxBytes) break;
    total += tamano;
    recientes.unshift(turno);
  }
  return recientes;
}

// Qué mostrar según el status. El código solo distingue los 400 (contrato C2).
export function mensajeError(status, codigo) {
  if (status === 429) return { texto: `Se alcanzó el límite de ${LIMITE_DIARIO} preguntas por día. Volver a intentar mañana.`, reintentar: false };
  if (status === 503) return { texto: 'El asistente no está disponible en este momento.', reintentar: false };
  if (status === 403) return { texto: 'Este perfil no tiene acceso al asistente.', reintentar: false };
  if (status === 401) return { texto: 'La sesión venció. Volver a iniciar sesión.', reintentar: false };
  if (status === 400 && codigo === 'cliente_requerido') return { texto: TEXTO_ELEGIR_CLIENTE, reintentar: false };
  return { texto: TEXTO_SIN_RESPUESTA, reintentar: true };
}

// Celdas y textos siempre como string: el modelo no decide qué se interpreta como HTML (eso lo hace html() en la vista).
const celda = v => {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

function normalizarBloque(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.tipo === 'parrafo') return typeof b.texto === 'string' ? { tipo: 'parrafo', texto: b.texto } : null;
  if (b.tipo !== 'tabla' || !Array.isArray(b.columnas) || !Array.isArray(b.filas)) return null;
  const columnas = b.columnas.slice(0, MAX_COLUMNAS).map(celda);
  if (!columnas.length) return null;
  const filas = b.filas
    .filter(Array.isArray)
    .slice(0, MAX_FILAS)
    .map(fila => columnas.map((_, i) => celda(fila[i])));
  return { tipo: 'tabla', columnas, filas };
}

// Valida la forma de C2. Devuelve null si la respuesta no tiene forma usable; los bloques de tipo desconocido se descartan.
export function normalizarRespuesta(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.bloques)) return null;
  const bloques = json.bloques.map(normalizarBloque).filter(Boolean).slice(0, MAX_BLOQUES);
  const fuentes = (Array.isArray(json.fuentes) ? json.fuentes : [])
    .filter(f => f && typeof f === 'object')
    .map(f => ({
      tool: celda(f.tool),
      desde: typeof f.desde === 'string' ? f.desde : null,
      hasta: typeof f.hasta === 'string' ? f.hasta : null,
      filas: Number(f.filas) || 0,
      recortado: f.recortado === true,
    }));
  const cuota = json.cuota && typeof json.cuota === 'object'
    ? { usadas: Number(json.cuota.usadas) || 0, limite: Number(json.cuota.limite) || 0 }
    : null;
  return { bloques, fuentes, modelo: celda(json.modelo), cuota };
}

// Texto de un bloque para el historial que se envía (la tabla va como líneas separadas por « | »).
export function textoRespuesta(bloques) {
  return bloques
    .map(b => (b.tipo === 'parrafo' ? b.texto : [b.columnas, ...b.filas].map(f => f.join(' | ')).join('\n')))
    .join('\n');
}

// Nombres que lee una persona del operario en la línea de fuente (no los nombres internos de las tools).
const NOMBRE_TOOL = {
  estado_flota: 'estado de la flota',
  cpk_por_grupo: 'costo por km',
  alertas_activas: 'alertas activas',
  mediciones_recientes: 'mediciones',
  vehiculos_listar: 'vehículos',
  ficha_cubierta: 'ficha de la cubierta',
};

export function textoFuente(f) {
  const nombre = Object.hasOwn(NOMBRE_TOOL, f.tool) ? NOMBRE_TOOL[f.tool] : f.tool;
  const periodo = f.desde && f.hasta ? `, ${f.desde} a ${f.hasta}` : '';
  const recorte = f.recortado ? ', resultado recortado' : '';
  return `Datos de ${nombre}${periodo}, ${plural(f.filas, 'fila')}${recorte}`;
}

// Mismo separador, escape y BOM que los CSV del panel (domain/reportes.js); las celdas que empiezan con «=», «+», «-» o «@» llevan un apóstrofo delante.
export const tablaACsv = (columnas, filas) => buildCsv(columnas, filas);

