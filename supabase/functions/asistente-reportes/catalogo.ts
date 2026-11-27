// Catálogo del asistente: tools, prompt y formato de respuesta. ESQUELETO del paso 0 de la oleada reportes-ia: la
// tarea T3 lo reemplaza por la implementación (tools.ts, prompt.ts, formato.ts). Mantiene la forma de `Catalogo`.
import type { Catalogo } from './contrato.ts';

export const catalogo: Catalogo = {
  promptVersion: 'v0',
  toolsParaRol: () => [],
  ejecutarTool: () => Promise.resolve({ contenido: JSON.stringify({ error: 'tool_desconocida' }), fuente: null }),
  armarPrompt: () => '',
  aBloques: (texto) => [{ tipo: 'parrafo', texto }],
};
