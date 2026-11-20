// Escribe un .xlsx mínimo (zip sin comprimir) con una hoja de texto, para probar el lector y la carga con datos sintéticos.
import { crc32 } from 'node:zlib';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => String.fromCharCode(65 + i);

// Una celda es texto, o { serial: n, estilo } = número: estilo 1 = fecha predefinida (14), 2 = fecha personalizada
// dd/mm/yyyy, 3 = número con formato «0.00» (no es fecha); sin estilo = número sin formato.
const STYLES = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2">'
  + '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>'
  + '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
const celda = (v, r, c) => {
  const ref = `${col(c)}${r + 1}`;
  if (v !== null && typeof v === 'object') return `<c r="${ref}"${v.estilo ? ` s="${v.estilo}"` : ''}><v>${v.serial}</v></c>`;
  return v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
};

export function escribirXlsx(filas) {
  const celdas = filas.map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => celda(v, r, c)).join('')}</row>`).join('');
  const hoja = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${celdas}</sheetData></worksheet>`;
  const archivos = [['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'], ['xl/styles.xml', STYLES], ['xl/worksheets/sheet1.xml', hoja]];
  const partes = []; const central = []; let off = 0;
  for (const [nombre, contenido] of archivos) {
    const nb = Buffer.from(nombre); const d = Buffer.from(contenido); const crc = crc32(d);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(d.length, 18); loc.writeUInt32LE(d.length, 22); loc.writeUInt16LE(nb.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(d.length, 20); cen.writeUInt32LE(d.length, 24); cen.writeUInt16LE(nb.length, 28); cen.writeUInt32LE(off, 42);
    partes.push(loc, nb, d); central.push(cen, nb); off += 30 + nb.length + d.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fin]);
}

export const CABECERA = ['CODIGO', 'IDENTIFICADOR INTERNO', 'MARCA', 'MODELO', 'DIMENSIONES', 'TIPO BANDA', 'ESTADO NEUMATICO',
  'CANTIDAD RECAPADOS CARGA', 'CANTIDAD RECAPADOS EXTRA', 'ULTIMA PRESION', 'ULTIMA TEMPERATURA', 'ULTIMOS MM', 'ESTADO ACTUAL',
  'INTERNO', 'DEPOSITO', 'POSICION', 'FECHA MONTAJE', 'MES FABRICACION', 'AÑO FABRICACION', 'FECHA COMPRA', 'PROVEEDOR',
  'KM ACTUAL', 'KM TOTAL ACUMULADO', 'HS ACTUAL', 'HS TOTAL ACUMULADO'];

/** Fila sintética por nombre de columna; lo no indicado queda vacío (o «0» donde el listado real trae ceros). */
export function fila(o) {
  const base = { 'MES FABRICACION': '0', 'AÑO FABRICACION': '0', 'KM ACTUAL': '0', 'KM TOTAL ACUMULADO': '0', 'HS ACTUAL': '0', 'HS TOTAL ACUMULADO': '0',
    'CANTIDAD RECAPADOS CARGA': '0', 'CANTIDAD RECAPADOS EXTRA': '0', MARCA: 'MARCAX', MODELO: 'MODELOY', DIMENSIONES: '295/80R22.5' };
  const v = { ...base, ...o };
  return CABECERA.map((c) => v[c] ?? '');
}

/**
 * Listado sintético para las pruebas: tres vehículos (9 posiciones con auxilio, 8 sin auxilio, uno con huecos y número igual a la
 * patente), stock con depósitos, descartes y un código repetido. Sin datos de ningún cliente real.
 */
export function listadoSintetico() {
  const filas = [CABECERA];
  let cod = 1000;
  const montado = (interno, pos, extra = {}) => filas.push(fila({
    CODIGO: String(cod++), 'ESTADO ACTUAL': 'montado', INTERNO: interno, POSICION: String(pos), 'FECHA MONTAJE': '15/03/2026',
    'ESTADO NEUMATICO': 'Usada original', 'KM TOTAL ACUMULADO': '1000', 'KM ACTUAL': '400', ...extra }));
  for (let p = 1; p <= 9; p++) montado(' ZZA0001 | 11 ', p, p === 1 ? { 'ULTIMOS MM': '15.0|14.0|15.0|13.5', 'ESTADO NEUMATICO': 'Usada recapada', 'CANTIDAD RECAPADOS CARGA': '1', 'CANTIDAD RECAPADOS EXTRA': '1' } : {});
  for (let p = 1; p <= 8; p++) montado('ZZB0002 | 22', p, { DIMENSIONES: '385/65r22,5' });
  for (const p of [1, 2, 4, 9]) montado('ZZC0003 | ZZC0003', p);
  const stock = (dep, extra = {}) => filas.push(fila({ CODIGO: String(cod++), 'ESTADO ACTUAL': 'en deposito', DEPOSITO: dep, ...extra }));
  stock('DEPOSITO GOMERIA', { 'ESTADO NEUMATICO': 'Nueva original', DIMENSIONES: '' });
  stock('DEPOSITO GOMERIA', { 'ESTADO NEUMATICO': 'Usada recapada', 'CANTIDAD RECAPADOS CARGA': '2', 'KM TOTAL ACUMULADO': '50000' });
  stock('DEPOSITO RIVERA');
  stock('DESCARTE', { 'ESTADO NEUMATICO': 'Usada original' });
  stock('DESCARTE');
  filas.push(fila({ CODIGO: '1000', 'ESTADO ACTUAL': 'en deposito', DEPOSITO: 'DEPOSITO GOMERIA' })); // repite el código de un montado
  return filas;
}
