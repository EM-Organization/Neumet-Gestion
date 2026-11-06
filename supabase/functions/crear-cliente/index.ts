import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type AuthResult, type ClienteRow, type Deps, handle } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const inviteRedirect = Deno.env.get('INVITE_REDIRECT_TO') || undefined;

if (allowedOrigins.length === 0) {
  console.warn(JSON.stringify({
    level: 'warn',
    event: 'allowed_origins_unset',
    msg: 'ALLOWED_ORIGINS vacío: se deniegan todos los orígenes de navegador',
  }));
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
const mapErr = (e: any): AuthResult => {
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'email_exists' || e?.status === 422 || msg.includes('already') || msg.includes('registered')
    ? { error: 'exists' }
    : { error: 'other' };
};

const deps: Deps = {
  allowedOrigins,
  async getUser(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  },
  async isAdmin(userId) {
    const { data, error } = await admin.from('perfiles').select('rol').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.rol === 'admin';
  },
  async createUser(email, password) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    return error || !data.user ? mapErr(error) : { id: data.user.id };
  },
  async inviteUser(email) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: inviteRedirect });
    return error || !data.user ? mapErr(error) : { id: data.user.id };
  },
  async deleteUser(id) {
    const { error } = await admin.auth.admin.deleteUser(id);
    return !error;
  },
  async insertCliente(nombre, authUserId) {
    const { data, error } = await admin.from('clientes').insert({ nombre, auth_user_id: authUserId })
      .select('id,nombre,created_at,auth_user_id').single();
    return error ? null : (data as ClienteRow);
  },
};

Deno.serve((req) => handle(req, deps));
