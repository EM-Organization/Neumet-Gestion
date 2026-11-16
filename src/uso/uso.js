// Lógica pura de la pantalla «Uso» (F11 ola 1). Sin DOM ni Svelte: se prueba en uso.test.js.
// Todos los meses son meses calendario UTC, igual que la base (docs/08 apéndice O.3): una `Date` se lee siempre con getUTC*.
import { fmtNum } from '@domain/formato.js';

export const MESES_OPCIONES = 24; // cuántos meses cerrados se ofrecen en el selector de rango
export const MESES_POR_DEFECTO = 12; // ancho del rango inicial

const dosDigitos = (n) => String(n).padStart(2, '0');
const aClave = (anio, mes0) => `${anio}-${dosDigitos(mes0 + 1)}-01`; // 'YYYY-MM-01'

// 'YYYY-MM-01' del mes en curso (UTC). El mes en curso todavía no está cerrado: la base nunca tiene fila de él.
export function mesEnCurso(ahora = new Date()) {
  return aClave(ahora.getUTCFullYear(), ahora.getUTCMonth());
}

// Suma `n` meses (puede ser negativo) a una clave 'YYYY-MM-01' sin pasar por Date local.
export function sumarMeses(clave, n) {
  const [a, m] = clave.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return aClave(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

export const ultimoMesCerrado = (ahora = new Date()) => sumarMeses(mesEnCurso(ahora), -1);

// Meses elegibles, del más reciente cerrado hacia atrás.
export function mesesElegibles(ahora = new Date(), cantidad = MESES_OPCIONES) {
  const fin = ultimoMesCerrado(ahora);
  return Array.from({ length: cantidad }, (_, i) => sumarMeses(fin, -i));
}

export function rangoPorDefecto(ahora = new Date()) {
  const hasta = ultimoMesCerrado(ahora);
  return { desde: sumarMeses(hasta, -(MESES_POR_DEFECTO - 1)), hasta };
}

const formatoMes = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// '2026-03-01' -> 'marzo de 2026'
export function etiquetaMes(clave) {
  const [a, m] = String(clave).split('-').map(Number);
  if (!a || !m) return '—';
  return formatoMes.format(new Date(Date.UTC(a, m - 1, 1)));
}

// Un solo selector «Mes»: la opción inicial cubre los últimos 12 meses cerrados y las demás son un mes puntual (desde = hasta).
// Reemplaza a «Desde» y «Hasta», que obligaban a 4 clics para ver un mes; ahora son 2 y el caso frecuente (todo el año) no pide ninguno.
export const SELECCION_ULTIMOS = 'ultimos';
export const ETIQUETA_ULTIMOS = `Últimos ${MESES_POR_DEFECTO} meses`;
const ES_CLAVE_MES = /^\d{4}-(0[1-9]|1[0-2])-01$/;
export function rangoDeSeleccion(valor, ahora = new Date()) {
  return ES_CLAVE_MES.test(String(valor)) ? { desde: valor, hasta: valor } : rangoPorDefecto(ahora);
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
function fechaUtc(v) {
  const t = v ? new Date(v) : null;
  return t && !Number.isNaN(t.getTime()) ? formatoFecha.format(t) : null;
}

export const COLUMNAS = [
  { clave: 'mes', etiqueta: 'Mes' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'api', etiqueta: 'Llamadas API', alinear: 'der' },
  { clave: 'logins', etiqueta: 'Inicios de sesión de API', alinear: 'der' },
  { clave: 'mediciones', etiqueta: 'Mediciones', alinear: 'der' },
  { clave: 'vehiculos', etiqueta: 'Vehículos', alinear: 'der' },
  { clave: 'dispositivos', etiqueta: 'Dispositivos', alinear: 'der' },
  { clave: 'usuarios', etiqueta: 'Usuarios', alinear: 'der' },
  { clave: 'ultimoIngreso', etiqueta: 'Último ingreso al panel' },
];

// Filas de uso_clientes_listar -> filas ya formateadas para la tabla. Un mes sin ingresos de usuarios queda como «Sin ingresos»,
// no como una fecha inventada ni un guion que podría leerse como dato faltante.
export function filasDeUso(registros) {
  return (registros ?? []).map((r) => ({
    id: `${r.cliente_id}-${r.mes}`,
    mes: etiquetaMes(r.mes),
    cliente: r.cliente_nombre ?? `Cliente ${r.cliente_id}`,
    api: fmtNum(r.api_llamadas),
    logins: fmtNum(r.logins),
    mediciones: fmtNum(r.mediciones),
    vehiculos: fmtNum(r.vehiculos_activos),
    dispositivos: fmtNum(r.dispositivos_activos),
    usuarios: fmtNum(r.usuarios),
    ultimoIngreso: fechaUtc(r.ultimo_ingreso_at) ?? 'Sin ingresos',
  }));
}
