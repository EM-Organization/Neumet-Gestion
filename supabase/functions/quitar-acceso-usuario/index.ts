import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { depsBase } from '../_shared/supabase.ts';
import { type Deps, handle } from './handler.ts';

const base = depsBase();
const deps: Deps = {
  ...base,
  quitar: (token, userId, accesoId) =>
    base.rpcConJwt(token, 'usuario_empresa_quitar_acceso', { p_user_id: userId, p_acceso_id: accesoId }),
};

Deno.serve((req) => handle(req, deps));
