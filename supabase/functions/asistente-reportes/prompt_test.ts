import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type { Contexto } from './contrato.ts';
import { armarPrompt, PROMPT_VERSION, ultimoMesCerrado } from './prompt.ts';
import { toolsParaRol } from './tools.ts';

const base = {
  usoId: 1,
  clienteId: 7,
  clienteNombre: 'Cliente demo',
  sucursalId: null,
  sucursalNombre: null,
  monedaDefault: 'USD',
  hoy: '2026-11-27',
};
const GLOBAL: Contexto = { ...base, rol: 'global', costosVisibles: true };
const SUCURSAL: Contexto = { ...base, rol: 'sucursal', sucursalId: 3, sucursalNombre: 'Norte', costosVisibles: false };

const EMOJI = /\p{Extended_Pictographic}/u;

Deno.test('PROMPT_VERSION es v2', () => {
  assertEquals(PROMPT_VERSION, 'v2');
});

Deno.test('el prompt no fija los km de la primera rotación ni un máximo de renovaciones', () => {
  const prompt = armarPrompt(GLOBAL, toolsParaRol(GLOBAL));
  for (const prohibido of ['20.000', 'RN-25', 'hasta 3', 'de 0 a 3', 'vida máxima']) {
    assert(!prompt.includes(prohibido), `el prompt no debe decir «${prohibido}»`);
  }
});

Deno.test('el prompt global trae cliente, fecha, reglas clave y solo las tools recibidas', () => {
  const tools = toolsParaRol(GLOBAL);
  const prompt = armarPrompt(GLOBAL, tools);
  for (
    const fragmento of [
      'Cliente demo',
      '2026-11-27',
      '3 mm',
      '8 mm',
      '6 mm',
      '5',
      'no sumar',
      'perfil global',
    ]
  ) {
    assertStringIncludes(prompt, fragmento);
  }
  for (const tool of tools) assertStringIncludes(prompt, tool.function.name);
});

Deno.test('con una sola tool, el prompt no nombra las demás', () => {
  const soloEstado = toolsParaRol(GLOBAL).filter((tool) => tool.function.name === 'estado_flota');
  const prompt = armarPrompt(GLOBAL, soloEstado);
  assertStringIncludes(prompt, 'estado_flota');
  assert(!prompt.includes('alertas_activas'));
  assert(!prompt.includes('cpk_por_grupo'));
});

Deno.test('el prompt de sucursal nombra la sucursal y avisa que no ve precios', () => {
  const prompt = armarPrompt(SUCURSAL, toolsParaRol(SUCURSAL));
  assertStringIncludes(prompt, 'perfil de la sucursal Norte');
  assertStringIncludes(prompt, 'no ve precios');
  assert(!prompt.includes('cpk_por_grupo'));
});

Deno.test('el prompt de admin dice que consulta el equipo NEUMET', () => {
  const admin: Contexto = { ...base, rol: 'admin', costosVisibles: true };
  assertStringIncludes(armarPrompt(admin, []), 'equipo NEUMET, consultando el cliente Cliente demo');
});

Deno.test('el último mes cerrado sale de hoy; enero cierra diciembre anterior', () => {
  assertEquals(ultimoMesCerrado('2026-01-15'), '2025-12');
  assertEquals(ultimoMesCerrado('2026-11-27'), '2026-10');
  const enero: Contexto = { ...GLOBAL, hoy: '2026-01-15' };
  assertStringIncludes(armarPrompt(enero, []), 'Último mes cerrado: 2025-12');
});

Deno.test('el prompt no tiene signos de exclamación ni emojis', () => {
  const prompt = armarPrompt(GLOBAL, toolsParaRol(GLOBAL));
  assert(!prompt.includes('!'));
  assert(!EMOJI.test(prompt));
});
