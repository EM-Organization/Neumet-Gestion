// Dominio: alertas con estado y su presentación (docs/08 apéndice M). Funciones PURAS (sin DOM ni supabase).
// Entradas = filas de v_alertas (estado: abierta | reconocida; silenciada_hasta; tipo; color; severidad).
import { ESTADOS } from './estado-desgaste.js';
import { fmtNum } from './formato.js';

export const ESTADO_ALERTA_LABEL = { abierta: 'Abierta', reconocida: 'Reconocida', silenciada: 'Silenciada' };
// Color del chip de estado: el rojo es de lo crítico (el neumático), no del estado de gestión de la alerta. «Abierta» pide
// atención (naranja); las otras dos ya están atendidas o postergadas (gris). El texto y el símbolo dicen el estado igual.
export const CHIP_ESTADO_ALERTA = { abierta: ['orange', '●'], reconocida: ['gray', '✓'], silenciada: ['gray', '–'] };
export const DIAS_SILENCIO = 7;
export const NOTA_MAX = 200;

const ts = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

// Silenciada = abierta o reconocida con silencio vigente. Sin estado (filas previas a la migración) = abierta.
export function estadoAlerta(a, ahora = Date.now()) {
  const hasta = ts(a && a.silenciada_hasta);
  if (hasta !== null && hasta > ahora) return 'silenciada';
  return a && a.estado === 'reconocida' ? 'reconocida' : 'abierta';
}
export const etiquetaEstadoAlerta = e => ESTADO_ALERTA_LABEL[e] || ESTADO_ALERTA_LABEL.abierta;

export function contarPorEstadoAlerta(alertas, ahora = Date.now()) {
  const c = { abierta: 0, reconocida: 0, silenciada: 0 };
  for (const a of alertas || []) c[estadoAlerta(a, ahora)]++;
  return c;
}

export function filtrarPorEstadoAlerta(alertas, estado = '', ahora = Date.now()) {
  return (alertas || []).filter(a => !estado || estadoAlerta(a, ahora) === estado);
}

// Alertas que nadie atendió: abiertas y no silenciadas (las que Inicio destaca).
export const sinReconocer = (alertas, ahora = Date.now()) => contarPorEstadoAlerta(alertas, ahora).abierta;

// Presentación de cada tipo de v_alertas (columnas tipo y color). La alerta roja es `limite`: así lo fija alertas_tipo_ck en la base.
// Rojo solo para lo crítico (neumático en desgaste límite); lo demás es amarillo y lleva ◆. Nunca ▲: ya significa «Poco
// desgaste» y «N bajos» (docs/14 §3).
export const SIMBOLO_REVISAR = '◆';
export const PRESENTACION_ALERTA = Object.freeze({
  limite: { etiqueta: ESTADOS.limite.texto, simbolo: ESTADOS.limite.simbolo, color: 'red', accion: 'Cambiar' },
  direccion_aviso: { etiqueta: 'Pasar atrás', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
  direccion_limite: { etiqueta: 'Pasar atrás ya', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
  irregular: { etiqueta: 'Desgaste irregular', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
  lateral: { etiqueta: 'Desgaste lateral', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
  swap: { etiqueta: 'Swap', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
  km_por_mm: { etiqueta: 'Km por mm', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' },
});

// Un tipo fuera de la tabla (p. ej. `critico`, que la base ya no admite) se muestra en amarillo como «Revisar». El mensaje no va en
// la etiqueta: la columna Mensaje ya lo muestra al lado (detalleAlerta), y como etiqueta se repetía.
// El swap nombra su umbral (`umbral_km`, de cada empresa): sin dato, «Swap» a secas, sin inventar una cifra.
export function presentacionAlerta(a) {
  if (a && Object.hasOwn(PRESENTACION_ALERTA, a.tipo)) {
    const p = PRESENTACION_ALERTA[a.tipo];
    const km = Number(a.umbral_km);
    if (a.tipo === 'swap' && Number.isFinite(km) && km > 0) return { ...p, etiqueta: `Swap a ${fmtNum(km)} km` };
    return p;
  }
  return { etiqueta: 'Revisar', simbolo: SIMBOLO_REVISAR, color: 'orange', accion: 'Revisar' };
}

// La columna Mensaje ya muestra el tipo en el chip: el prefijo que trae la base se quita para no repetirlo.
// El prefijo es la etiqueta del tipo, salvo en `lateral`: la base lo escribe «Revisar alineación:» (su nombre en la
// base, no la etiqueta «Desgaste lateral»), así que hay que quitar también ese.
// Sin prefijo, el texto queda igual; sin mensaje, da cadena vacía.
const PREFIJO_MENSAJE_BASE = Object.freeze({ lateral: 'Revisar alineación' });
export function detalleAlerta(a) {
  const mensaje = String((a && a.mensaje) ?? '');
  const prefijos = [`${presentacionAlerta(a).etiqueta}:`];
  if (a && PREFIJO_MENSAJE_BASE[a.tipo]) prefijos.push(`${PREFIJO_MENSAJE_BASE[a.tipo]}:`);
  const prefijo = prefijos.find(p => mensaje.startsWith(p));
  return prefijo ? mensaje.slice(prefijo.length).trim() : mensaje;
}

// Recuadro de Inicio y del detalle: «× N cambiar · ◆ N revisar». Sin silenciadas (tienen plazo y no piden nada hasta vencer).
// «Cambiar» es el neumático en desgaste límite (tipo `limite` o color rojo de la base); el resto, «revisar».
export function conteoRecuadro(alertas, ahora = Date.now()) {
  const c = { cambiar: 0, revisar: 0 };
  for (const a of alertas || []) {
    if (!a || estadoAlerta(a, ahora) === 'silenciada') continue;
    // «rojo» es el color de la base (v_alertas.color); la tabla usa «red» para las clases del chip: dos vocabularios, no unificar.
    if (a.tipo === 'limite' || a.color === 'rojo') c.cambiar++; else c.revisar++;
  }
  return c;
}

// Partes del recuadro «× N cambiar · ◆ N revisar», cada una con su color y su símbolo: el texto dice lo mismo que el color
// (RN-20). «Amarillo» es la clase orange, la de PRESENTACION_ALERTA. Una cifra en cero va en gris, así el rojo queda para
// lo que hay que cambiar. Vacío si no hay nada que contar, así el recuadro no aparece.
export function partesRecuadro(alertas, ahora = Date.now()) {
  const { cambiar, revisar } = conteoRecuadro(alertas, ahora);
  if (!cambiar && !revisar) return [];
  const { simbolo, accion, color } = presentacionAlerta({ tipo: 'limite' });
  return [
    { color: cambiar ? color : 'gray', simbolo, texto: `${cambiar} ${accion.toLowerCase()}` },
    { color: revisar ? 'orange' : 'gray', simbolo: SIMBOLO_REVISAR, texto: `${revisar} revisar` },
  ];
}

export function hastaSilencio(dias = DIAS_SILENCIO, ahora = Date.now()) {
  return new Date(ahora + dias * 86400000).toISOString();
}

export function validarNota(raw) {
  const nota = String(raw ?? '').trim();
  if (!nota) return { ok: false, error: 'Falta la nota de resolución' };
  if (nota.length > NOTA_MAX) return { ok: false, error: `La nota admite hasta ${NOTA_MAX} caracteres` };
  return { ok: true, nota };
}

export function traducirErrorAlerta(err) {
  const code = err && err.code;
  if (code === '42501') return 'Sin permiso para esta alerta';
  if (code === '55000') return 'La alerta ya estaba resuelta. Actualizar la lista.';
  if (code === '22023' || code === '23514' || code === '22004') return 'Datos inválidos. Revisar los valores.';
  return 'No se pudo completar la operación';
}
