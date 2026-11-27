// Acceso a PostgREST y Auth con el JWT del usuario y la clave anon: la RLS y los privilegios por columna se aplican en la
// base, no aquí (docs/24 §4). Sin I/O propio más allá de `fetch`, que entra por parámetro para probarlo.
import type { ConsultaSelect, Rest, ResultadoRest } from './contrato.ts';

export interface OpcionesRest {
  url: string;
  anonKey: string;
  token: string;
  fetch?: typeof fetch;
}

export function crearRest(o: OpcionesRest): Rest {
  const pedir = o.fetch ?? fetch;
  const cabeceras = { apikey: o.anonKey, Authorization: `Bearer ${o.token}`, Accept: 'application/json' };
  return {
    select(c: ConsultaSelect): Promise<ResultadoRest> {
      const params = new URLSearchParams();
      params.append('select', c.columnas);
      for (const [columna, expresion] of c.filtros) params.append(columna, expresion);
      if (c.orden) params.append('order', c.orden);
      params.append('limit', String(c.limite));
      return ejecutar(pedir, `${o.url}/rest/v1/${c.recurso}?${params}`, { headers: cabeceras });
    },
    rpc(fn: string, args: Record<string, unknown>): Promise<ResultadoRest> {
      return ejecutar(pedir, `${o.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { ...cabeceras, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    },
  };
}

// Un fallo de red se devuelve como `status: 0` para que la tool lo informe al modelo y no tumbe la pregunta.
async function ejecutar(pedir: typeof fetch, url: string, init: RequestInit): Promise<ResultadoRest> {
  let res: Response;
  try {
    res = await pedir(url, init);
  } catch {
    return { ok: false, status: 0, code: '' };
  }
  const texto = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, status: res.status, code: codigoDe(texto) };
  if (texto === '') return { ok: true, filas: [] };
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { ok: false, status: res.status, code: '' };
  }
  return { ok: true, filas: Array.isArray(cuerpo) ? cuerpo : [cuerpo] };
}

// PostgREST informa el código de Postgres (p. ej. 42501) en el campo `code` del cuerpo del error.
function codigoDe(texto: string): string {
  try {
    const cuerpo = JSON.parse(texto) as { code?: unknown };
    return typeof cuerpo?.code === 'string' ? cuerpo.code : '';
  } catch {
    return '';
  }
}

/** Valida el JWT con Auth (`GET /auth/v1/user`). null si Auth no responde 200 con un `id`. */
export async function getUser(
  url: string,
  anonKey: string,
  token: string,
  pedir: typeof fetch = fetch,
): Promise<{ id: string } | null> {
  try {
    const res = await pedir(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (res.status !== 200) {
      await res.text().catch(() => '');
      return null;
    }
    const cuerpo = (await res.json()) as { id?: unknown };
    return typeof cuerpo?.id === 'string' ? { id: cuerpo.id } : null;
  } catch {
    return null;
  }
}
