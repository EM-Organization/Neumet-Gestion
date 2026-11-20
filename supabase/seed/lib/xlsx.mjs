// Lector mínimo de .xlsx (una hoja) sin dependencias: un .xlsx es un zip de XML. Se lee el directorio central del zip,
// se descomprime con node:zlib y se interpretan sharedStrings + la primera hoja. No evalúa fórmulas: devuelve el valor tal
// cual está guardado (texto o número como cadena), salvo las celdas con formato de fecha: Excel las guarda como número de
// serie (días desde 1899-12-30) y aquí salen como dd/mm/aaaa, igual que las fechas escritas como texto.
import { inflateRawSync } from 'node:zlib';

function leerZip(buf) {
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido (zip sin directorio central)');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip corrupto');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const nombreLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nombreLen);
    entradas.set(nombre, { metodo, tamComp, offLocal });
    p += 46 + nombreLen + extraLen + comLen;
  }
  return (nombre) => {
    const e = entradas.get(nombre);
    if (!e) return null;
    const dataOff = e.offLocal + 30 + buf.readUInt16LE(e.offLocal + 26) + buf.readUInt16LE(e.offLocal + 28);
    const datos = buf.subarray(dataOff, dataOff + e.tamComp);
    if (e.metodo === 0) return datos.toString('utf8');
    if (e.metodo === 8) return inflateRawSync(datos).toString('utf8');
    throw new Error(`Método de compresión no soportado: ${e.metodo}`);
  };
}

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function desescapar(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (m, nom, dec, hex) =>
    nom ? ENTIDADES[m] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)));
}

// Une los <t> de un <si> o <is> (texto con formato viene en varios <r>).
function textoDe(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return desescapar(out);
}

function colAIndice(ref) {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Formatos de fecha predefinidos de Excel (los personalizados, desde 164, se declaran en styles.xml).
const FORMATOS_FECHA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Índices de estilo (atributo s de las celdas) con formato de fecha. Sin styles.xml, ninguno. */
function estilosDeFecha(xml) {
  const fechas = new Set();
  if (!xml) return fechas;
  const custom = new Map();
  for (const m of xml.matchAll(/<numFmt\b[^>]*?numFmtId="(\d+)"[^>]*?formatCode="([^"]*)"/g)) custom.set(Number(m[1]), desescapar(m[2]));
  const bloque = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  let i = 0;
  for (const m of bloque.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0);
    // Código personalizado de fecha: d/m/y fuera de comillas y corchetes y sin marcadores de dígito (descarta «0.00»).
    const cod = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (FORMATOS_FECHA.has(id) || (custom.has(id) && /[dmy]/i.test(cod) && !/[0#?]/.test(cod))) fechas.add(i);
    i++;
  }
  return fechas;
}

/** Número de serie de Excel -> dd/mm/aaaa (la hora se descarta); null si no es una fecha razonable. */
export function serialAFecha(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const f = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  const dos = (x) => String(x).padStart(2, '0');
  return `${dos(f.getUTCDate())}/${dos(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`;
}

/** Devuelve las filas de la primera hoja como arreglos de cadenas ('' = celda vacía). */
export function leerXlsx(buf) {
  const leer = leerZip(buf);
  const ss = leer('xl/sharedStrings.xml');
  const compartidas = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1])) : [];
  const fechas = estilosDeFecha(leer('xl/styles.xml'));
  const hoja = leer('xl/worksheets/sheet1.xml');
  if (!hoja) throw new Error('No se encontró la hoja 1 del libro');
  const filas = [];
  for (const fm of hoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    for (const cm of fm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[1]);
      const tipo = /\bt="(\w+)"/.exec(cm[1])?.[1];
      const cuerpo = cm[2] ?? '';
      let val = '';
      if (tipo === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
        val = v ? (compartidas[Number(v[1])] ?? '') : '';
      } else if (tipo === 'inlineStr') {
        val = textoDe(cuerpo);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
        val = v ? desescapar(v[1]) : '';
        const estilo = /\bs="(\d+)"/.exec(cm[1]);
        if (val !== '' && estilo && fechas.has(Number(estilo[1]))) val = serialAFecha(val) ?? val;
      }
      fila[ref ? colAIndice(ref[1]) : fila.length] = val;
    }
    for (let i = 0; i < fila.length; i++) if (fila[i] === undefined) fila[i] = '';
    filas.push(fila);
  }
  return filas;
}
