import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { depsBase } from '../_shared/supabase.ts';
import { type Deps, handle } from './handler.ts';

const base = depsBase();
const deps: Deps = {
  ...base,
  reponer: (token, accesoId, sucursalId) =>
    base.rpcConJwt(token, 'usuario_empresa_reponer_acceso', { p_acceso_id: accesoId, p_sucursal_id: sucursalId }),
};

Deno.serve((req) => handle(req, deps));
