import { createHandler } from './handler.ts';
import { configDesdeEntorno, crearDeps } from './supabase_deps.ts';

// verify_jwt = false (supabase/config.toml): el login no lleva token y la
// verificación del Bearer se hace dentro del handler. Ver docs/07 apéndice.
Deno.serve(createHandler(crearDeps(configDesdeEntorno())));
