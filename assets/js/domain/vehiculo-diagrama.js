// Diagrama del vehículo visto desde arriba: disposición de ruedas, geometría y escala de color por desgaste.
// Funciones PURAS (sin DOM ni red). Tests: tests/unit/vehiculo-detalle.test.mjs
import { MED_CFG } from './camion.js';

export const POS_AUXILIO = 99;

// Código de lado de MED_CFG -> descripción. Visto desde arriba con el frente hacia ARRIBA:
//   L / R   = rueda simple izquierda / derecha
//   LL / LR = dual izquierdo: externa / interna (LR es la más cercana al chasis)
//   RL / RR = dual derecho:   interna / externa (RL es la más cercana al chasis)
const LADOS = {
  L: { lado: 'izq', interna: null },
  R: { lado: 'der', interna: null },
  LL: { lado: 'izq', interna: false },
  LR: { lado: 'izq', interna: true },
  RL: { lado: 'der', interna: true },
  RR: { lado: 'der', interna: false },
};

const normPos = posiciones => [...new Set((posiciones || []).map(Number).filter(p => Number.isInteger(p) && p >= 1 && p <= 99))].sort((a, b) => a - b);

// Eje (1 = delantero) al que pertenece una posición; 0 = auxilio. Mapeo estándar (tipo 16): 1-2 eje 1, 3-6 eje 2,
// 7-10 eje 3, 11-14 eje 4, 15-16 eje 5; posiciones 17..98 forman ejes duales extra de a 4.
export function ejeDePosicion(pos) {
  const p = Number(pos);
  if (!Number.isInteger(p) || p < 1) return null;
  if (p === POS_AUXILIO) return 0;
  if (p <= 2) return 1;
  if (p <= 14) return 2 + Math.floor((p - 3) / 4);
  if (p <= 16) return 5;
  return 5 + Math.ceil((p - 16) / 4);
}

function etiquetaRueda(eje, lado, interna) {
  if (eje === 0) return 'Auxilio';
  const l = lado === 'izq' ? 'izquierda' : 'derecha';
  return `Eje ${eje} · ${l}${interna === null ? '' : interna ? ' interna' : ' externa'}`;
}

function rueda(posicion, eje, codigo, presentes, dual) {
  const { lado, interna } = LADOS[codigo];
  return { posicion, eje, lado, interna, dual, auxilio: false, presente: presentes.has(posicion), etiqueta: etiquetaRueda(eje, lado, interna) };
}

/**
 * Mapeo posición -> (eje, lado, interna/externa) para un vehículo.
 *  - Base: MED_CFG según tipo_ruedas. Con tipo 10 y alguna posición 11..98 presente se usa la disposición de 16
 *    (igual que el RPC de ingesta, que crea el vehículo con 16 si alguna posición > 10). Cualquier otro tipo -> 10.
 *  - Siempre se dibuja el chasis completo del tipo (las ruedas sin dato salen en gris, `presente: false`).
 *  - Posiciones 17..98 que no están en la disposición se agregan como ejes extra: de a 4 (dual: LL, LR, RL, RR);
 *    un grupo final de 2 o menos queda como eje simple (L, R).
 *  - 99 = auxilio: sale del chasis (`auxilios`), con eje 0, lado 'aux'. Solo aparece si la posición 99 está presente.
 * Devuelve { tipo, ejes: [{ eje, dual, ruedas }], ruedas (todas, en orden de dibujo), auxilios }.
 */
export function layoutRuedas(posiciones, tipo) {
  const pos = normPos(posiciones);
  const presentes = new Set(pos);
  const tipoEf = (Number(tipo) === 16 || pos.some(p => p >= 11 && p <= 98)) ? 16 : 10;
  const ejes = MED_CFG[String(tipoEf)].map((cfg, i) => ({
    eje: i + 1,
    dual: !cfg.single,
    ruedas: cfg.positions.map(p => rueda(p.pos, i + 1, p.side, presentes, !cfg.single)),
  }));
  const conocidas = new Set(ejes.flatMap(e => e.ruedas.map(r => r.posicion)));
  const extra = pos.filter(p => p < POS_AUXILIO && !conocidas.has(p));
  for (let i = 0; i < extra.length; i += 4) {
    const grupo = extra.slice(i, i + 4);
    const eje = ejes.length + 1;
    const dual = grupo.length > 2;
    const codigos = dual ? ['LL', 'LR', 'RL', 'RR'] : ['L', 'R'];
    ejes.push({ eje, dual, ruedas: grupo.map((p, k) => rueda(p, eje, codigos[k], presentes, dual)) });
  }
  const auxilios = presentes.has(POS_AUXILIO)
    ? [{ posicion: POS_AUXILIO, eje: 0, lado: 'aux', interna: null, dual: false, auxilio: true, presente: true, etiqueta: etiquetaRueda(0) }]
    : [];
  return { tipo: tipoEf, ejes, ruedas: ejes.flatMap(e => e.ruedas), auxilios };
}

// ── Geometría (unidades del viewBox; frente hacia arriba) ──
export const GEO = { ancho: 300, rueda: { w: 30, h: 52 }, pasoEje: 88, chasisX: 105, chasisAncho: 90, margen: 14, cabina: 46, hueco: 4 };

/**
 * Coordenadas de cada rueda para dibujar el layout. Devuelve { ancho, alto, chasis, cabina, ejes: [{eje, y}],
 * ruedas: [{...rueda, x, y, ancho, alto}], auxilios: [...] } con (x, y) = esquina superior izquierda.
 */
export function geometriaDiagrama(layout) {
  const { ancho, rueda: R, pasoEje, chasisX, chasisAncho, margen, cabina, hueco } = GEO;
  const primeroY = margen + cabina + R.h / 2 + 10; // centro del primer eje
  const ejes = layout.ejes.map((e, i) => ({ eje: e.eje, y: primeroY + i * pasoEje }));
  const chasisY = margen;
  const chasisAlto = ejes.length ? ejes[ejes.length - 1].y + R.h / 2 + 12 - chasisY : cabina;
  const chasisFin = chasisX + chasisAncho;
  const ruedas = [];
  layout.ejes.forEach((e, i) => {
    const cy = ejes[i].y - R.h / 2;
    e.ruedas.forEach(r => {
      let x;
      if (r.lado === 'izq') x = r.interna === false ? chasisX - hueco - R.w - 3 - R.w : chasisX - hueco - R.w;
      else x = r.interna === false ? chasisFin + hueco + R.w + 3 : chasisFin + hueco;
      ruedas.push({ ...r, x, y: cy, ancho: R.w, alto: R.h });
    });
  });
  const auxY = chasisY + chasisAlto + 26;
  const auxilios = layout.auxilios.map((r, i) => ({ ...r, x: (ancho - R.w) / 2 + i * (R.w + 8), y: auxY, ancho: R.w, alto: R.h }));
  const alto = (auxilios.length ? auxY + R.h : chasisY + chasisAlto) + margen;
  return { ancho, alto, chasis: { x: chasisX, y: chasisY, ancho: chasisAncho, alto: chasisAlto }, cabina: { x: chasisX, y: chasisY, ancho: chasisAncho, alto: cabina }, ejes, ruedas, auxilios };
}

// ── Escala de color por desgaste ──
export const UMBRALES_DEFECTO = { bajo: 8, critico: 5, retiro: 3 };

// Umbrales válidos (retiro < crítico < bajo) tomados de una fila de v_estado_neumaticos; si faltan o son incoherentes, los de defecto.
export function umbralesDe(row) {
  const n = k => (row && row[k] !== null && row[k] !== undefined && row[k] !== '' ? Number(row[k]) : NaN);
  const u = { bajo: n('umbral_bajo_mm'), critico: n('umbral_critico_mm'), retiro: n('umbral_retiro_mm') };
  if (![u.bajo, u.critico, u.retiro].every(Number.isFinite) || !(u.retiro > 0 && u.retiro < u.critico && u.critico < u.bajo)) {
    return { ...UMBRALES_DEFECTO };
  }
  return u;
}

// Paleta apagada (salvia, ámbar suave, terracota, rojo, vino) en armonía con la marca; el estado nunca depende solo del color.
export const COLORES = {
  verde: [156, 190, 160], amarillo: [238, 208, 130], naranja: [230, 165, 120], rojo: [212, 118, 106], rojoIntenso: [140, 62, 70],
};
const mezcla = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
const aHex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');

// Nivel de la rueda según los mm medios: 'ok' (>= bajo) · 'bajo' · 'critico' (< crítico) · 'retiro' (<= retiro) · 'sin_datos'.
export function nivelDesgaste(mm, u) {
  if (mm === null || mm === undefined || mm === '' || !Number.isFinite(Number(mm))) return 'sin_datos';
  const v = Number(mm);
  if (v <= u.retiro) return 'retiro';
  if (v < u.critico) return 'critico';
  if (v < u.bajo) return 'bajo';
  return 'ok';
}

/**
 * Color continuo para los mm medios y los umbrales del cliente (u = { bajo, critico, retiro }):
 *   >= bajo            verde pleno
 *   [critico, bajo)    amarillo (justo bajo `bajo`) -> naranja (en `critico`)
 *   (retiro, critico)  naranja -> rojo
 *   <= retiro          rojo intenso
 * Devuelve { hex, nivel, rgb }. Sin dato: hex null (la vista dibuja gris con patrón).
 */
export function colorDesgaste(mm, u) {
  const nivel = nivelDesgaste(mm, u);
  if (nivel === 'sin_datos') return { hex: null, nivel, rgb: null };
  const v = Number(mm);
  let rgb;
  if (nivel === 'ok') rgb = COLORES.verde;
  else if (nivel === 'retiro') rgb = COLORES.rojoIntenso;
  else if (v >= u.critico) rgb = mezcla(COLORES.amarillo, COLORES.naranja, (u.bajo - v) / (u.bajo - u.critico));
  else rgb = mezcla(COLORES.naranja, COLORES.rojo, (u.critico - v) / (u.critico - u.retiro));
  return { hex: aHex(rgb), nivel, rgb };
}

// Símbolo y texto de estado (nunca solo color).
export const NIVEL_INFO = {
  ok: { simbolo: '✓', texto: 'OK' },
  bajo: { simbolo: '▲', texto: 'Desgaste bajo' },
  critico: { simbolo: '✕', texto: 'Crítico' },
  retiro: { simbolo: '■', texto: 'Retirar' },
  sin_datos: { simbolo: '–', texto: 'Sin datos' },
};

const lum = rgb => {
  const [r, g, b] = rgb.map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contraste(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const TEXTO_CLARO = [255, 255, 255];
export const TEXTO_OSCURO = [0, 0, 0];
// Color de texto (blanco o negro) con mejor contraste sobre un fondo rgb. Siempre >= 4,5:1.
export function colorTexto(rgb) {
  if (!rgb) return '#383424';
  return contraste(rgb, TEXTO_CLARO) >= contraste(rgb, TEXTO_OSCURO) ? '#ffffff' : '#000000';
}

// Muestras para la leyenda: mm representativos de cada tramo.
export function muestrasLeyenda(u) {
  return [
    { clave: 'ok', mm: u.bajo, rango: `≥ ${u.bajo} mm` },
    { clave: 'bajo', mm: (u.bajo + u.critico) / 2, rango: `${u.critico} – ${u.bajo} mm` },
    { clave: 'critico', mm: (u.critico + u.retiro) / 2, rango: `${u.retiro} – ${u.critico} mm` },
    { clave: 'retiro', mm: u.retiro, rango: `≤ ${u.retiro} mm` },
  ].map(m => ({ ...m, ...colorDesgaste(m.mm, u), ...NIVEL_INFO[m.clave] }));
}
