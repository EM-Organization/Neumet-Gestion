import type { Catalogo } from './contrato.ts';
import { aBloques } from './formato.ts';
import { armarPrompt, PROMPT_VERSION } from './prompt.ts';
import { ejecutarTool, toolsParaRol } from './tools.ts';

export const catalogo: Catalogo = {
  promptVersion: PROMPT_VERSION,
  toolsParaRol,
  ejecutarTool,
  armarPrompt,
  aBloques,
};
