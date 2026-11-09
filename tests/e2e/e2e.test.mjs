// Pruebas E2E: el panel real en Chrome headless contra Postgres + migraciones + RLS + seed demo + PostgREST reales.
// Solo la autenticación está sustituida (ver browser/auth-shim.js). Ejecutar: npm run e2e  (README en tests/e2e/).
import { after } from 'node:test';
import { iniciarEntorno } from './lib/env.mjs';
import { registrar as inicio } from './specs/inicio.mjs';
import { registrar as buscador } from './specs/buscador.mjs';
import { registrar as detalle } from './specs/detalle.mjs';
import { registrar as aislamiento } from './specs/aislamiento.mjs';
import { registrar as alertasDispositivos } from './specs/alertas-dispositivos.mjs';
import { registrar as recorrido } from './specs/recorrido.mjs';
import { registrar as contrato } from './specs/contrato.mjs';
import { registrar as taller } from './specs/taller.mjs';
import { registrar as medicionesNeumatico } from './specs/mediciones-neumatico.mjs';
import { registrar as sucursales } from './specs/sucursales.mjs';
import { registrar as stockCubiertas } from './specs/stock-cubiertas.mjs';
import { registrar as montarNeumaticos } from './specs/montar-neumaticos.mjs';
import { registrar as tasa } from './specs/tasa.mjs';
import { registrar as sinAcceso } from './specs/sin-acceso.mjs';
import { registrar as apiSinNeumaticos } from './specs/api-sin-neumaticos.mjs';
import { registrar as kmCubierta } from './specs/km-cubierta.mjs';
import { registrar as calidadDatos } from './specs/calidad-datos.mjs';
import { registrar as preciosSoloGlobal } from './specs/precios-solo-global.mjs';

const env = await iniciarEntorno();
after(async () => { await env.cerrar(); });

inicio(env);
buscador(env);
detalle(env);
aislamiento(env);
alertasDispositivos(env);
recorrido(env);
taller(env);
medicionesNeumatico(env);
sucursales(env);
stockCubiertas(env);
montarNeumaticos(env);
tasa(env);
sinAcceso(env);
apiSinNeumaticos(env);
kmCubierta(env);
calidadDatos(env);
preciosSoloGlobal(env);
contrato(env);
