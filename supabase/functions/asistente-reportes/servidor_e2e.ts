// Arnés de las pruebas e2e (contrato C4, docs/24 §8.4): el handler real, PostgREST real y el catálogo real, con un modelo
// guionado en lugar de OpenRouter. Nunca lee la clave de OpenRouter. Se levanta con `deno run` y se exporta para probarlo.
import { createHandler } from './handler.ts';
import { crearDeps } from './deps.ts';
import type { ClienteModelo, PeticionModelo, RespuestaModelo } from './openrouter.ts';

type Mensaje = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string } }>;
};

const MARCA = /\[\[tool:([a-z_]+) (\{.*?\})\]\]/g;

/**
 * Pide una tool por cada marca `[[tool:NOMBRE {json}]]` del último mensaje del usuario; cuando ya hay resultados de tools,
 * responde con esos resultados. Así las pruebas e2e fijan qué consulta se hace sin depender de un modelo real.
 */
export const modeloGuionado: ClienteModelo = {
  llamar(p: PeticionModelo): Promise<RespuestaModelo> {
    const mensajes = p.mensajes as Mensaje[];
    const ultimoUsuario = mensajes.map((m) => m.role).lastIndexOf('user');
    const desdeUsuario = mensajes.slice(ultimoUsuario + 1);
    const resultados = desdeUsuario.filter((m) => m.role === 'tool');

    if (resultados.length === 0) {
      const texto = String(mensajes[ultimoUsuario]?.content ?? '');
      const llamadas = [...texto.matchAll(MARCA)].map((m, i) => ({
        id: `c${i + 1}`,
        nombre: m[1],
        argumentos: m[2],
      }));
      return Promise.resolve(respuesta(llamadas.length > 0 ? null : 'Sin consulta.', llamadas));
    }

    const nombrePorId = new Map<string, string>();
    for (const m of mensajes) {
      for (const llamada of m.tool_calls ?? []) nombrePorId.set(llamada.id, llamada.function.name);
    }
    const lineas = resultados.map((m) => `${nombrePorId.get(m.tool_call_id ?? '') ?? '?'}: ${m.content ?? ''}`);
    return Promise.resolve(respuesta(`Resultado:\n${lineas.join('\n')}`, []));
  },
};

function respuesta(
  contenido: string | null,
  llamadas: Array<{ id: string; nombre: string; argumentos: string }>,
): RespuestaModelo {
  return {
    ok: true,
    contenido,
    llamadas,
    modelo: 'guion/e2e',
    tokensEntrada: 10,
    tokensSalida: 5,
    costo: 0,
    aviso: null,
  };
}

if (import.meta.main) {
  const deps = {
    ...crearDeps({
      url: Deno.env.get('SUPABASE_URL') ?? '',
      anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      apiKey: null,
      principal: '',
      respaldo: '',
    }),
    modelo: () => modeloGuionado,
  };
  Deno.serve(
    { port: Number(Deno.env.get('PORT') ?? '0'), onListen: ({ port }) => console.log(`LISTO ${port}`) },
    createHandler(deps),
  );
}
