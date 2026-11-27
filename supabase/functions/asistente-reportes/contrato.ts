// Contrato interno de `asistente-reportes` (oleada reportes-ia, docs/24). Lo fija el Technical Leader: el handler (T2) y
// el catálogo de tools, prompt y formato (T3) se escriben contra estos tipos sin depender uno del otro. Cambiarlo es
// decisión del TL, no de una tarea.

/** Contexto de la pregunta. Lo arma el handler con la respuesta de la RPC `asistente_reservar` (nunca con datos del
 * modelo ni del cuerpo de la petición, salvo `cliente_id` del admin, que la RPC valida). */
export interface Contexto {
  usoId: number;
  rol: 'admin' | 'global' | 'sucursal';
  clienteId: number;
  clienteNombre: string;
  sucursalId: number | null;
  sucursalNombre: string | null;
  /** precios_visibles() de la base: admin y perfil global. */
  costosVisibles: boolean;
  monedaDefault: string;
  /** Fecha de hoy en America/Montevideo, `YYYY-MM-DD`. */
  hoy: string;
}

/** Una consulta GET a PostgREST. `filtros` son pares `[columna, expresión PostgREST]`, por ejemplo
 * `['cliente_id', 'eq.5']`, `['created_at', 'gte.2026-10-01']`, `['or', '(nombre.ilike.*abc*,patente.ilike.*abc*)']`.
 * `columnas` es la lista exacta (con embebidos, p. ej. `id,nombre,vehiculos(nombre,patente)`), nunca `*`. */
export interface ConsultaSelect {
  recurso: string;
  columnas: string;
  filtros: Array<[string, string]>;
  /** Valor del parámetro `order` de PostgREST, p. ej. `severidad.desc,vehiculo_nombre.asc`. */
  orden?: string;
  limite: number;
}

export type ResultadoRest =
  | { ok: true; filas: unknown[] }
  | { ok: false; status: number; code: string };

/** Acceso de solo lectura a PostgREST con el JWT del usuario y la clave anon (RLS y privilegios por columna). */
export interface Rest {
  select(c: ConsultaSelect): Promise<ResultadoRest>;
  rpc(fn: string, args: Record<string, unknown>): Promise<ResultadoRest>;
}

/** Declaración de una tool en formato OpenAI de function calling (lo acepta OpenRouter). */
export interface DefTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** De dónde salió un dato: se muestra en el panel («Datos de cpk_por_grupo, 2026-07-01 a 2026-09-30, 42 filas»). */
export interface Fuente {
  tool: string;
  desde: string | null;
  hasta: string | null;
  filas: number;
  recortado: boolean;
}

export interface SalidaTool {
  /** JSON (texto) para el mensaje `role: 'tool'`, como máximo 30 KB. En error: `{"error": "<codigo>", ...}`. */
  contenido: string;
  /** null si la tool falló o no existe. */
  fuente: Fuente | null;
}

export type Bloque =
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'tabla'; columnas: string[]; filas: string[][] };

/** Firma de lo que exporta `catalogo.ts` (T3). El handler lo recibe por dependencias. */
export interface Catalogo {
  promptVersion: string;
  toolsParaRol(ctx: Contexto): DefTool[];
  ejecutarTool(nombre: string, argumentos: string, ctx: Contexto, rest: Rest): Promise<SalidaTool>;
  armarPrompt(ctx: Contexto, tools: DefTool[]): string;
  aBloques(texto: string): Bloque[];
}
