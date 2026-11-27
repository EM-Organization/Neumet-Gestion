// Paso de la respuesta del modelo a bloques (docs/24 §6). El panel muestra texto plano escapado por `core/html.js`, así
// que no hay Markdown: se quitan los marcadores y las tablas se reconstruyen desde las líneas `| a | b |`.
import type { Bloque } from './contrato.ts';

const MAX_BLOQUES = 20;
const MAX_CARACTERES_ENTRADA = 8000;
const MAX_FILAS = 200;
const MAX_COLUMNAS = 12;
const MAX_CELDA = 200;
const SIN_RESPUESTA = 'Sin respuesta.';
const RECORTADA = 'Respuesta recortada.';
const CELDA_SEPARADORA = /^:?-+:?$/;

/** Cuenta y corta por caracteres (code points), no por unidades UTF-16, para que los acentos y emojis cuenten uno. */
function recortar(texto: string, maximo: number): string {
  return Array.from(texto).slice(0, maximo).join('');
}

function esLineaTabla(linea: string): boolean {
  const limpia = linea.trim();
  return limpia.length >= 2 && limpia.startsWith('|') && limpia.endsWith('|');
}

function celdas(linea: string): string[] {
  return linea
    .trim()
    .slice(1, -1)
    .split('|')
    .map((celda) => celda.trim());
}

function esSeparador(linea: string): boolean {
  return esLineaTabla(linea) && celdas(linea).every((celda) => CELDA_SEPARADORA.test(celda));
}

function tabla(encabezado: string, cuerpo: string[]): Bloque {
  const columnas = celdas(encabezado)
    .slice(0, MAX_COLUMNAS)
    .map((celda) => recortar(celda, MAX_CELDA));
  const filas = cuerpo.slice(0, MAX_FILAS).map((linea) => {
    const valores = celdas(linea)
      .slice(0, columnas.length)
      .map((celda) => recortar(celda, MAX_CELDA));
    while (valores.length < columnas.length) valores.push('');
    return valores;
  });
  return { tipo: 'tabla', columnas, filas };
}

/** Agrupa las líneas en párrafos (unidos por espacio) y tablas. Una tabla es una línea de encabezado seguida de un
 * separador `|---|`, y sigue mientras las líneas empiecen y terminen con `|`. */
function construir(lineas: string[]): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', texto: parrafo.join(' ') });
    parrafo = [];
  };

  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (linea.trim() === '') {
      cerrarParrafo();
      i++;
    } else if (esLineaTabla(linea) && i + 1 < lineas.length && esSeparador(lineas[i + 1])) {
      cerrarParrafo();
      let fin = i + 2;
      while (fin < lineas.length && esLineaTabla(lineas[fin])) fin++;
      bloques.push(tabla(linea, lineas.slice(i + 2, fin)));
      i = fin;
    } else {
      parrafo.push(linea.trim());
      i++;
    }
  }
  cerrarParrafo();
  return bloques;
}

/** Texto del modelo a bloques para el panel. Si la entrada pasa de 8000 caracteres, se corta y el último bloque avisa;
 * ese aviso reserva un lugar dentro de los 20 bloques. */
export function aBloques(texto: string): Bloque[] {
  const caracteres = Array.from(texto);
  const recortada = caracteres.length > MAX_CARACTERES_ENTRADA;
  const limpio = caracteres
    .slice(0, MAX_CARACTERES_ENTRADA)
    .join('')
    .replace(/\*\*|`/g, '');
  if (limpio.trim() === '') return [{ tipo: 'parrafo', texto: SIN_RESPUESTA }];

  const bloques = construir(limpio.split(/\r?\n/));
  if (!recortada) return bloques.slice(0, MAX_BLOQUES);
  return [...bloques.slice(0, MAX_BLOQUES - 1), { tipo: 'parrafo', texto: RECORTADA }];
}
