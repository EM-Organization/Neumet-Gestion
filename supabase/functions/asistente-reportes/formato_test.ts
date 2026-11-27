import { assertEquals } from 'jsr:@std/assert@1';
import { aBloques } from './formato.ts';

const filasDe = (cantidad: number, prefijo = 'f') =>
  Array.from({ length: cantidad }, (_, i) => `| ${prefijo}${i} | x |`);

Deno.test('párrafo seguido de una tabla de 2 columnas y 3 filas son 2 bloques', () => {
  const texto = [
    'Hay tres cubiertas.',
    '',
    '| Vehículo | Patente |',
    '|---|:--:|',
    '| Camión 1 | AAA111 |',
    '| Camión 2 | BBB222 |',
    '| Camión 3 | CCC333 |',
  ].join('\n');
  assertEquals(aBloques(texto), [
    { tipo: 'parrafo', texto: 'Hay tres cubiertas.' },
    {
      tipo: 'tabla',
      columnas: ['Vehículo', 'Patente'],
      filas: [
        ['Camión 1', 'AAA111'],
        ['Camión 2', 'BBB222'],
        ['Camión 3', 'CCC333'],
      ],
    },
  ]);
});

Deno.test('una tabla de 13 columnas queda en 12', () => {
  const encabezado = '| ' + Array.from({ length: 13 }, (_, i) => `c${i + 1}`).join(' | ') + ' |';
  const separador = '|' + '---|'.repeat(13);
  const fila = '| ' + Array.from({ length: 13 }, (_, i) => `v${i + 1}`).join(' | ') + ' |';
  const [bloque] = aBloques([encabezado, separador, fila].join('\n'));
  assertEquals(bloque.tipo === 'tabla' && bloque.columnas.length, 12);
  assertEquals(bloque.tipo === 'tabla' && bloque.filas[0].length, 12);
});

Deno.test('una tabla de 250 filas queda en 200', () => {
  const [bloque] = aBloques(['| a | b |', '|---|---|', ...filasDe(250)].join('\n'));
  assertEquals(bloque.tipo === 'tabla' && bloque.filas.length, 200);
});

Deno.test('una celda de 300 caracteres queda en 200', () => {
  const [bloque] = aBloques(['| a |', '|---|', `| ${'z'.repeat(300)} |`].join('\n'));
  assertEquals(bloque.tipo === 'tabla' && bloque.filas[0][0].length, 200);
});

Deno.test('una fila con menos celdas se completa con vacío y una con más se corta', () => {
  const [bloque] = aBloques(['| a | b | c |', '|---|---|---|', '| 1 |', '| 1 | 2 | 3 | 4 |'].join('\n'));
  assertEquals(bloque.tipo === 'tabla' && bloque.filas, [
    ['1', '', ''],
    ['1', '2', '3'],
  ]);
});

Deno.test('25 párrafos quedan en 20 bloques', () => {
  const texto = Array.from({ length: 25 }, (_, i) => `Párrafo ${i + 1}`).join('\n\n');
  const bloques = aBloques(texto);
  assertEquals(bloques.length, 20);
  assertEquals(bloques[19], { tipo: 'parrafo', texto: 'Párrafo 20' });
});

Deno.test('una entrada de 9000 caracteres se corta y avisa al final', () => {
  const bloques = aBloques('a'.repeat(9000));
  assertEquals(bloques.length, 2);
  assertEquals(bloques[0], { tipo: 'parrafo', texto: 'a'.repeat(8000) });
  assertEquals(bloques[1], { tipo: 'parrafo', texto: 'Respuesta recortada.' });
});

Deno.test('quita los marcadores ** y de código', () => {
  assertEquals(aBloques('**Hola**'), [{ tipo: 'parrafo', texto: 'Hola' }]);
  assertEquals(aBloques('usar `estado_flota`'), [{ tipo: 'parrafo', texto: 'usar estado_flota' }]);
});

Deno.test('texto vacío da «Sin respuesta.»', () => {
  assertEquals(aBloques(''), [{ tipo: 'parrafo', texto: 'Sin respuesta.' }]);
  assertEquals(aBloques('   \n  '), [{ tipo: 'parrafo', texto: 'Sin respuesta.' }]);
});

Deno.test('una línea con | suelta sin separador queda como párrafo', () => {
  assertEquals(aBloques('a | b | c'), [{ tipo: 'parrafo', texto: 'a | b | c' }]);
  assertEquals(aBloques('| x |'), [{ tipo: 'parrafo', texto: '| x |' }]);
});

Deno.test('las líneas de un párrafo se unen por espacio', () => {
  assertEquals(aBloques('primera\nsegunda'), [{ tipo: 'parrafo', texto: 'primera segunda' }]);
});
