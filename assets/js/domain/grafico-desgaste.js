// Datos del gráfico de desgaste de un neumático (mm vs. tiempo) listos para dibujar en SVG (lógica pura).
// Las bandas y el estado de cada punto salen de estado-desgaste.js: gráfico, chips y esquema no pueden discrepar.
import { TOKENS } from './tokens-detalle.js';
import { fmtFecha } from './formato.js';
import { wearStatus, ESTADOS, ejeY, bandasGrafico, fmtMedida } from './estado-desgaste.js';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// Promedio de mm1..mm3 de una medición (usa `promedio` si viene; si no, el de las huellas presentes).
export function mmMedicion(m) {
  const p = num(m.promedio);
  if (p !== null) return p;
  const v = [m.mm1, m.mm2, m.mm3].map(num).filter(x => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Mediciones -> puntos { t (ms), fecha, mm (promedio), mm1, mm2, mm3 } ordenados por fecha, sin las que no tienen dato o fecha válida.
// Se conservan las tres huellas para la tabla «Ver datos» y el tooltip; el gráfico dibuja el promedio.
export function serieDesgaste(mediciones) {
  return (mediciones || [])
    .map(m => ({ t: new Date(m.created_at).getTime(), fecha: m.created_at, mm: mmMedicion(m), mm1: num(m.mm1), mm2: num(m.mm2), mm3: num(m.mm3) }))
    .filter(p => Number.isFinite(p.t) && p.mm !== null)
    .sort((a, b) => a.t - b.t);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Fecha corta del eje: «20 nov»; con el año de dos cifras si el rango cruza un año.
export function fechaEje(t, conAnio = false) {
  const f = new Date(t);
  return `${f.getDate()} ${MESES[f.getMonth()]}${conAnio ? ` ${String(f.getFullYear()).slice(2)}` : ''}`;
}

// Ancho aproximado por carácter de un rótulo de 12 px en seminegrita. Si el rótulo no cabe se oculta en vez de
// recortarse: el chip del mismo estado ya lo nombra.
const ANCHO_CHAR = 6.8;

/**
 * Geometría del gráfico en un SVG de `ancho` x `alto`. th = { buen, poco, mayor }. Las bandas ocupan todo el ancho del
 * área de trazado; con una sola lectura el punto queda centrado y sin línea. Devuelve null sin puntos.
 */
export function datosGrafico(puntos, th, { ancho = 320, alto = TOKENS.chart.heightPx } = {}) {
  if (!puntos || !puntos.length) return null;
  const c = TOKENS.chart;
  const m = { l: 30, r: 8, t: 10, b: 28 };
  const x0 = m.l, x1 = ancho - m.r, y0 = m.t, y1 = alto - m.b;
  const eje = ejeY(Math.max(...puntos.map(p => p.mm)), th);
  const Y = mm => y0 + (1 - (mm - eje.min) / (eje.max - eje.min)) * (y1 - y0);
  const t0 = puntos[0].t, tn = puntos[puntos.length - 1].t;
  const unico = puntos.length === 1 || tn === t0;
  const X = t => (unico ? (x0 + x1) / 2 : (x0 + c.plotInsetXPx) + ((t - t0) / (tn - t0)) * ((x1 - x0) - 2 * c.plotInsetXPx));
  const pts = puntos.map((p, i) => {
    const valor = p.mm; // crudo: decide el estado y la altura; se muestra con fmtMedida (truncado)
    const estado = wearStatus(p.mm, th);
    return { ...p, valor, estado, estilo: ESTADOS[estado].estilo, x: X(p.t), y: Y(valor), ultimo: i === puntos.length - 1 };
  });
  const bandas = bandasGrafico(th, eje.max).map(b => {
    const yTop = Y(b.hasta), alto_ = Y(b.desde) - yTop;
    const cabe = !!b.rotulo && alto_ >= c.bandLabelMinHeightPx && b.rotulo.length * ANCHO_CHAR <= (x1 - x0) - 2 * c.bandLabelInsetPx;
    return { ...b, y: yTop, alto: alto_, rotuloVisible: cabe, rotuloX: x1 - c.bandLabelInsetPx, rotuloY: yTop + alto_ / 2 };
  });
  const conAnio = new Date(t0).getFullYear() !== new Date(tn).getFullYear();
  const fechas = unico ? [{ x: X(t0), t: t0 }] : [{ x: X(t0), t: t0 }, { x: X(tn), t: tn }];
  return {
    ancho, alto, margen: m, area: { x0, x1, y0, y1 },
    eje: { ...eje, marcas: eje.marcas.map(v => ({ mm: v, y: Y(v) })) },
    bandas, puntos: pts, unico,
    linea: unico ? null : pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    ejeX: fechas.map(f => ({ ...f, texto: fechaEje(f.t, conAnio) })),
  };
}

// Tooltip de un punto del gráfico (docs/21 §5.4): fecha, las tres huellas, promedio y estado; todo con el mismo formato
// de mm (truncado a 1 decimal). Una huella sin dato se muestra «—».
export function tooltipPunto(p) {
  return `${fmtFecha(p.fecha)} · Interna ${fmtMedida(p.mm1)} · Centro ${fmtMedida(p.mm2)} · Externa ${fmtMedida(p.mm3)} · Promedio ${fmtMedida(p.valor)} mm · ${ESTADOS[p.estado].texto}`;
}
