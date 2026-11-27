// Cableado real: lee el entorno y arma las dependencias del handler con el catálogo, PostgREST, Auth y OpenRouter.
import { catalogo } from './catalogo.ts';
import type { Deps } from './handler.ts';
import { crearClienteModelo, elegirModelos } from './openrouter.ts';
import { crearRest, getUser } from './rest.ts';

export interface Config {
  url: string;
  anonKey: string;
  allowedOrigins: string[];
  /** null = falta OPENROUTER_API_KEY: toda pregunta responde 503 sin reservar cupo. */
  apiKey: string | null;
  principal: string;
  respaldo: string;
}

export function configDesdeEntorno(): Config {
  const leer = (nombre: string) => Deno.env.get(nombre)?.trim() ?? '';
  const allowedOrigins = leer('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'allowed_origins_unset',
      msg: 'ALLOWED_ORIGINS vacío: se deniegan todos los orígenes de navegador',
    }));
  }
  const { principal, respaldo, avisos } = elegirModelos((nombre) => Deno.env.get(nombre));
  for (const aviso of avisos) console.warn(JSON.stringify({ level: 'warn', ...aviso }));
  return {
    url: leer('SUPABASE_URL'),
    anonKey: leer('SUPABASE_ANON_KEY'),
    allowedOrigins,
    apiKey: leer('OPENROUTER_API_KEY') || null,
    principal,
    respaldo,
  };
}

export function crearDeps(c: Config): Deps {
  const clave = c.apiKey;
  return {
    allowedOrigins: c.allowedOrigins,
    getUser: (token) => getUser(c.url, c.anonKey, token),
    rest: (token) => crearRest({ url: c.url, anonKey: c.anonKey, token }),
    modelo: clave === null
      ? null
      : () => crearClienteModelo({ apiKey: clave, principal: c.principal, respaldo: c.respaldo }),
    catalogo,
  };
}
