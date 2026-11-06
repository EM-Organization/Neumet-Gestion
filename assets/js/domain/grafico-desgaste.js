// Datos del gráfico de desgaste de un neumático (mm vs. tiempo) listos para dibujar en SVG (lógica pura).
const MS_SEMANA = 7 * 86400000;
export const MAX_SEMANAS_PROYECCION = 52;

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// Promedio de mm1..mm3 de una medición (usa `promedio` si viene; si no, el de las huellas presentes).
export function mmMedicion(m) {
  const p = num(m.promedio);
  if (p !== null) return p;
  const v = [m.mm1, m.mm2, m.mm3].map(num).filter(x => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Mediciones -> puntos { t (ms), fecha, mm } ordenados por fecha, sin las que no tienen dato o fecha válida.
export function serieDesgaste(mediciones) {
  return (mediciones || [])
    .map(m => ({ t: new Date(m.created_at).getTime(), fecha: m.created_at, mm: mmMedicion(m) }))
    .filter(p => Number.isFinite(p.t) && p.mm !== null)
    .sort((a, b) => a.t - b.t);
}

/**
 * Geometría del gráfico. u = { bajo, critico, retiro }; tasaMmSemana > 0 activa la proyección punteada desde el último
 * punto hasta el umbral de retiro (acotada a MAX_SEMANAS_PROYECCION). Devuelve null sin puntos.
 */
export function datosGrafico(puntos, u, tasaMmSemana, { ancho = 320, alto = 190 } = {}) {
  if (!puntos || !puntos.length) return null;
  const m = { l: 28, r: 62, t: 10, b: 22 };
  const ultimo = puntos[puntos.length - 1];
  const tasa = num(tasaMmSemana);
  let proy = null;
  if (tasa !== null && tasa > 0 && ultimo.mm > u.retiro) {
    const semanas = (ultimo.mm - u.retiro) / tasa;
    const s = Math.min(semanas, MAX_SEMANAS_PROYECCION);
    proy = { t2: ultimo.t + s * MS_SEMANA, mm2: ultimo.mm - tasa * s, semanas, truncada: semanas > MAX_SEMANAS_PROYECCION };
  }
  const t0 = puntos[0].t;
  const t1 = Math.max(ultimo.t, proy ? proy.t2 : ultimo.t, t0 + 86400000);
  const mmMin = Math.max(0, Math.min(u.retiro, ...puntos.map(p => p.mm), proy ? proy.mm2 : Infinity) - 1);
  const mmMax = Math.max(u.bajo, ...puntos.map(p => p.mm)) + 1;
  const X = t => m.l + ((t - t0) / (t1 - t0)) * (ancho - m.l - m.r);
  const Y = mm => m.t + (1 - (mm - mmMin) / (mmMax - mmMin)) * (alto - m.t - m.b);
  const pts = puntos.map(p => ({ ...p, x: X(p.t), y: Y(p.mm) }));
  const paso = mmMax - mmMin > 12 ? 4 : 2;
  const ejeY = [];
  for (let v = Math.ceil(mmMin / paso) * paso; v <= mmMax; v += paso) ejeY.push({ mm: v, y: Y(v) });
  const ejeX = [{ x: X(t0), t: t0 }];
  if (ultimo.t > t0) ejeX.push({ x: X(ultimo.t), t: ultimo.t });
  const ult = pts[pts.length - 1];
  return {
    ancho, alto, margen: m, puntos: pts,
    linea: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    umbrales: [
      { clave: 'bajo', mm: u.bajo, y: Y(u.bajo), etiqueta: 'Bajo' },
      { clave: 'critico', mm: u.critico, y: Y(u.critico), etiqueta: 'Crítico' },
      { clave: 'retiro', mm: u.retiro, y: Y(u.retiro), etiqueta: 'Retiro' },
    ],
    proyeccion: proy ? { x1: ult.x, y1: ult.y, x2: X(proy.t2), y2: Y(proy.mm2), semanas: proy.semanas, truncada: proy.truncada, t2: proy.t2 } : null,
    ejeY, ejeX,
  };
}
