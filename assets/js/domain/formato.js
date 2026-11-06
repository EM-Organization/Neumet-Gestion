// Formato es-AR para números y fechas (funciones puras, sin DOM). Tests: tests/unit/formato.test.mjs
const LOCALE = 'es-AR';
const vacio = v => v === null || v === undefined || v === '';
const noNum = v => vacio(v) || !Number.isFinite(Number(v));

// 1234.5 -> "1.234,5". Sin dato (null, '', NaN) -> '—'.
export function fmtNum(v, decimales = 0) {
  if (noNum(v)) return '—';
  return Number(v).toLocaleString(LOCALE, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

// Milímetros con un decimal: 6.25 -> "6,3 mm".
export const fmtMm = v => (noNum(v) ? '—' : `${fmtNum(v, 1)} mm`);

// Pesos argentinos sin decimales: 50000 -> "$ 50.000".
export const fmtPesos = v => (noNum(v) ? '—' : `$ ${fmtNum(v, 0)}`);

const fechaOk = d => { if (vacio(d)) return null; const t = new Date(d); return Number.isNaN(t.getTime()) ? null : t; };

// "15/6/2026"
export function fmtFecha(d) {
  const t = fechaOk(d);
  return t ? t.toLocaleDateString(LOCALE) : '—';
}

// "15/06/26 09:30"
export function fmtFechaHora(d) {
  const t = fechaOk(d);
  return t ? t.toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
}

// "15 de junio de 2026"
export function fmtFechaLarga(d) {
  const t = fechaOk(d);
  return t ? t.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}

// Plural simple: plural(1,'alerta') -> "1 alerta"; plural(3,'alerta') -> "3 alertas"; plural(2,'vez','veces') -> "2 veces".
export const plural = (n, uno, varios = `${uno}s`) => `${fmtNum(n)} ${Number(n) === 1 ? uno : varios}`;
