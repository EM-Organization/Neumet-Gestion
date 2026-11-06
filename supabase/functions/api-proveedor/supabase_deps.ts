// Implementación de producción de `Deps` con fetch directo a Auth y PostgREST
// (sin dependencias externas). Las RPC y tablas se usan con service_role; el
// login usa la anon/publishable key.
import type { Deps, GuardarArgs, GuardarRpc, LogEntrada, ObtenerRpc, PerfilApi } from './types.ts';

export interface Config {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export function configDesdeEntorno(): Config {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) throw new Error('Falta configuración de Supabase');
  return { url: url.replace(/\/+$/, ''), anonKey, serviceKey };
}

export function crearDeps(cfg: Config, f: typeof fetch = fetch): Deps {
  const svc = {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await f(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: svc,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(`rpc ${fn} ${r.status}`);
    }
    return await r.json() as T;
  }

  return {
    auth: {
      async login(email, clave) {
        const r = await f(`${cfg.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: clave }),
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 400 || r.status === 401 || r.status === 422) {
          await r.body?.cancel();
          return null;
        }
        if (!r.ok) {
          await r.body?.cancel();
          throw new Error(`auth ${r.status}`);
        }
        const j = await r.json();
        if (typeof j?.access_token !== 'string' || typeof j?.user?.id !== 'string') throw new Error('auth_respuesta');
        return { access_token: j.access_token, user_id: j.user.id };
      },
      async getUser(token) {
        const r = await f(`${cfg.url}/auth/v1/user`, {
          headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 401 || r.status === 403) {
          await r.body?.cancel();
          return null;
        }
        if (!r.ok) {
          await r.body?.cancel();
          throw new Error(`getUser ${r.status}`);
        }
        const j = await r.json();
        return typeof j?.id === 'string' ? { id: j.id } : null;
      },
    },
    db: {
      async getPerfil(userId): Promise<PerfilApi | null> {
        const q = `${cfg.url}/rest/v1/perfiles?user_id=eq.${encodeURIComponent(userId)}&select=rol,cliente_id&limit=1`;
        const r = await f(q, { headers: svc, signal: AbortSignal.timeout(8000) });
        if (!r.ok) {
          await r.body?.cancel();
          throw new Error(`perfil ${r.status}`);
        }
        const rows = await r.json();
        return Array.isArray(rows) && rows[0] ? rows[0] as PerfilApi : null;
      },
      rateLimit: (cuenta, max) => rpc<boolean>('api_rate_limit_hit', { p_cuenta: cuenta, p_max: max }),
      obtener: (clienteId, matricula, numero) =>
        rpc<ObtenerRpc>('api_obtener_montaje', {
          p_cliente_id: clienteId,
          p_matricula: matricula,
          p_numero: numero,
        }),
      guardar: (a: GuardarArgs) =>
        rpc<GuardarRpc>('api_guardar_montaje', {
          p_cliente_id: a.cliente_id,
          p_cuenta: a.cuenta,
          p_patente: a.patente,
          p_montajes: a.montajes,
          p_sesion: a.sesion_id,
          p_clave: a.clave,
          p_hash: a.hash,
        }),
      async log(e: LogEntrada) {
        const r = await f(`${cfg.url}/rest/v1/ingesta_log`, {
          method: 'POST',
          headers: { ...svc, Prefer: 'return=minimal' },
          body: JSON.stringify(e),
          signal: AbortSignal.timeout(5000),
        });
        await r.body?.cancel();
        if (!r.ok) throw new Error(`log ${r.status}`);
      },
    },
  };
}
