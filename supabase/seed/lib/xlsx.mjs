// Lector mínimo de .xlsx (una hoja) sin dependencias: un .xlsx es un zip de XML. Se lee el directorio central del zip,
// se descomprime con node:zlib y se interpretan sharedStrings + la primera hoja. No evalúa fórmulas ni estilos:
// devuelve el valor tal cual está guardado (texto o número como cadena), que es lo que necesita la carga.
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

/** Devuelve las filas de la primera hoja como arreglos de cadenas ('' = celda vacía). */
export function leerXlsx(buf) {
  const leer = leerZip(buf);
  const ss = leer('xl/sharedStrings.xml');
  const compartidas = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1])) : [];
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
      }
      fila[ref ? colAIndice(ref[1]) : fila.length] = val;
    }
    for (let i = 0; i < fila.length; i++) if (fila[i] === undefined) fila[i] = '';
    filas.push(fila);
  }
  return filas;
}
