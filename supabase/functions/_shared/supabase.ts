// Cableado real (supabase-js) de las dependencias comunes de quitar/reponer acceso. Los handlers no lo importan.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { DepsBase, RpcResult } from './acceso.ts';

// ~100 años: el bloqueo de Auth impide renovar el refresh token; 'none' lo levanta (docs/17 §4.1).
const BAN = '876000h';

export function entorno() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'allowed_origins_unset',
      msg: 'ALLOWED_ORIGINS vacío: se deniegan todos los orígenes de navegador',
    }));
  }
  return { url, serviceKey, anonKey, allowedOrigins };
}

export function depsBase(): DepsBase & {
  rpcConJwt(token: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
} {
  const { url, serviceKey, anonKey, allowedOrigins } = entorno();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    allowedOrigins,
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async estado(accesoId, marca) {
      const { data, error } = await admin.rpc('accesos_quitados_marcar_auth', { p_id: accesoId, p_marca: marca });
      if (error) throw error;
      return {
        existe: data?.existe === true,
        tiene_perfil: typeof data?.tiene_perfil === 'boolean' ? data.tiene_perfil : null,
      };
    },
    async fijarBloqueo(userId, bloquear) {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: bloquear ? BAN : 'none' });
      return !error;
    },
    // La RPC autoriza con el JWT de quien llama: auth.uid() es el actor, no el servicio.
    async rpcConJwt(token, fn, args) {
      const c = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await c.rpc(fn, args);
      if (error) return { error: { code: String(error.code ?? ''), message: String(error.message ?? '') } };
      return { data: (data ?? {}) as Record<string, unknown> };
    },
  };
}
