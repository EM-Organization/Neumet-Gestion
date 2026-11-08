// Nombre legible de la posición de una rueda y modelo del mini vehículo (vista de pájaro, frente hacia arriba).
// Reemplaza las etiquetas «P1, P2…» de las listas. Funciones PURAS (sin DOM ni red). Tests: tests/unit/posicion.test.mjs
//
// Convención del nombre (la disposición sale de layoutRuedas, igual que el diagrama del detalle):
//   eje 1                «Delantera izquierda» / «Delantera derecha»
//   resto, rueda simple  «Eje 2 izquierda» / «Eje 2 derecha»
//   resto, rueda dual    «Eje 2 derecha exterior» / «Eje 2 derecha interior» (interior = la más cercana al chasis)
//   posición 99          «Auxilio»
import { layoutRuedas, geometriaDiagrama, colorDesgaste, umbralesDe, nivelDesgaste, POS_AUXILIO } from './vehiculo-diagrama.js';

const posValida = p => p !== null && p !== undefined && p !== '' && Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= POS_AUXILIO;

function ruedaDe(layout, posicion) {
  return [...layout.ruedas, ...layout.auxilios].find(r => r.posicion === Number(posicion)) || null;
}

function textoRueda(r) {
  if (r.auxilio) return 'Auxilio';
  const lado = r.lado === 'izq' ? 'izquierda' : 'derecha';
  const sufijo = r.interna === null ? '' : r.interna ? ' interior' : ' exterior';
  return `${r.eje === 1 ? 'Delantera' : `Eje ${r.eje}`} ${lado}${sufijo}`;
}

// Los ejes extra (posiciones 17..98) son duales de a 4: se completa el grupo para que el nombre no dependa de qué
// posiciones del vehículo tienen datos.
function conGrupo(posiciones) {
  const out = new Set(posiciones);
  for (const p of posiciones) {
    if (p > 16 && p < POS_AUXILIO) {
      const ini = 17 + Math.floor((p - 17) / 4) * 4;
      for (let q = ini; q < ini + 4 && q < POS_AUXILIO; q++) out.add(q);
    }
  }
  return [...out];
}

// `tipo` = tipo_ruedas del vehículo (10 o 16); si se desconoce, se deduce de la posición (igual que layoutRuedas).
export function nombrePosicion(posicion, tipo) {
  if (!posValida(posicion)) return '';
  const r = ruedaDe(layoutRuedas(conGrupo([Number(posicion)]), tipo), posicion);
  return r ? textoRueda(r) : `Posición ${Number(posicion)}`;
}

// «A», «A y B», «A, B y C». Sin duplicados, en orden de posición.
export function nombresPosiciones(posiciones, tipo) {
  const pos = [...new Set((posiciones || []).filter(posValida).map(Number))].sort((a, b) => a - b);
  const layout = layoutRuedas(conGrupo(pos), tipo);
  const nombres = pos.map(p => { const r = ruedaDe(layout, p); return r ? textoRueda(r) : `Posición ${p}`; });
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// Para listas compactas: los nombres si son pocos; si no, solo la cantidad («8 posiciones»).
export const MAX_NOMBRES = 3;
export function resumenPosiciones(posiciones, tipo) {
  const n = new Set((posiciones || []).filter(posValida).map(Number)).size;
  if (!n) return '';
  return n <= MAX_NOMBRES ? nombresPosiciones(posiciones, tipo) : `${n} posiciones`;
}

/**
 * Modelo del mini vehículo de un vehículo.
 *  - filas: filas de v_estado_neumaticos (o { posicion, promedio, umbral_* }) de ESE vehículo.
 *  - destacadas: posiciones a resaltar.
 * Devuelve { ancho, alto, x0, chasis, ruedas: [{ posicion, x, y, ancho, alto, fill, nivel, destacada, ausente }], aria }.
 *  - ausente: la posición no figura en `filas` (el vehículo no tiene esa rueda registrada).
 *  - sin datos (nivel 'sin_datos', no ausente): hay fila de la posición pero sin medición.
 * `fill` es el color de la escala sobria del detalle (null = sin datos). Se dibuja el chasis completo del tipo.
 */
export function modeloMini(filas, { destacadas = [], tipo } = {}) {
  const lista = (filas || []).filter(f => f && posValida(f.posicion));
  const dest = new Set((destacadas || []).filter(posValida).map(Number));
  const posiciones = [...new Set([...lista.map(f => Number(f.posicion)), ...dest])];
  const layout = layoutRuedas(posiciones, tipo);
  const g = geometriaDiagrama(layout);
  const u = umbralesDe(lista[0]);
  const porPos = new Map(lista.map(f => [Number(f.posicion), f]));
  const ruedas = [...g.ruedas, ...g.auxilios].map(r => {
    const f = porPos.get(r.posicion);
    const mm = f ? f.promedio : null;
    return {
      posicion: r.posicion, x: r.x, y: r.y, ancho: r.ancho, alto: r.alto,
      // ausente = el vehículo no tiene esa rueda con datos ni señalada (se dibuja el hueco del chasis); distinto de «sin datos».
      ausente: !r.presente && !dest.has(r.posicion), fill: colorDesgaste(mm, u).hex, nivel: nivelDesgaste(mm, u), destacada: dest.has(r.posicion),
    };
  });
  // Recorte horizontal al contenido: así las ruedas se leen más grandes.
  const x0 = Math.min(...ruedas.map(r => r.x), g.chasis.x) - 4;
  const x1 = Math.max(...ruedas.map(r => r.x + r.ancho), g.chasis.x + g.chasis.ancho) + 4;
  const nombres = nombresPosiciones([...dest], tipo);
  const aria = `Vehículo visto desde arriba, frente hacia arriba.${nombres ? ` Resaltada: ${nombres}.` : ''}`;
  return { ancho: x1 - x0, alto: g.alto, x0, chasis: g.chasis, ruedas, aria };
}

// Agrupa filas por vehiculo_id conservando el orden. Map(vehiculo_id -> filas).
export function agruparPorVehiculo(filas) {
  const m = new Map();
  for (const f of filas || []) {
    if (!f || f.vehiculo_id === null || f.vehiculo_id === undefined) continue;
    if (!m.has(f.vehiculo_id)) m.set(f.vehiculo_id, []);
    m.get(f.vehiculo_id).push(f);
  }
  return m;
}
