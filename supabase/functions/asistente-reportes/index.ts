import { createHandler } from './handler.ts';
import { configDesdeEntorno, crearDeps } from './deps.ts';

Deno.serve(createHandler(crearDeps(configDesdeEntorno())));
