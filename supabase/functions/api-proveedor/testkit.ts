// Dobles de prueba (sin red). Emulan el CONTRATO de las RPC; el comportamiento
// real de SQL se prueba aparte contra un Postgres local (sql_test.ts).
import { createHandler } from './handler.ts';
import type { Deps, GuardarArgs, GuardarRpc, LogEntrada, ObtenerRpc, PerfilApi } from './types.ts';

export const U_DAC = '11111111-1111-4111-8111-111111111111';
export const U_OTRO = '22222222-2222-4222-8222-222222222222';
export const U_ADMIN = '33333333-3333-4333-8333-333333333333';
export const U_CLI = '44444444-4444-4444-8444-444444444444';

interface Veh {
  id: number;
  cliente_id: number;
  patente_norm: string | null;
  numero: string | null;
  distribucion?: string | null;
}
interface Neu {
  vehiculo_id: number;
  posicion: number;
  idneumatico: string | null;
  codigo: string;
  auxilio: boolean;
}
interface Med {
  vehiculo_id: number;
  cliente_id: number;
  posicion: number;
  mm1: number;
  mm2: number;
  mm3: number;
  sesion_id: string;
  device_id: string;
}

export function crearEntorno() {
  const usuarios = new Map<string, { email: string; clave: string }>([
    [U_DAC, { email: 'dac@x.cl', clave: 'clave-dac' }],
    [U_OTRO, { email: 'otro@x.cl', clave: 'clave-otro' }],
    [U_ADMIN, { email: 'admin@x.cl', clave: 'clave-admin' }],
    [U_CLI, { email: 'cli@x.cl', clave: 'clave-cli' }],
  ]);
  const perfiles = new Map<string, PerfilApi>([
    [U_DAC, { rol: 'api', cliente_id: 1, cliente_activo: true }],
    [U_OTRO, { rol: 'api', cliente_id: 2, cliente_activo: true }],
    [U_ADMIN, { rol: 'admin', cliente_id: null, cliente_activo: true }],
    [U_CLI, { rol: 'cliente', cliente_id: 1, cliente_activo: true }],
  ]);
  const vehiculos: Veh[] = [
    { id: 10, cliente_id: 1, patente_norm: 'ABCD12', numero: '123' },
    { id: 11, cliente_id: 1, patente_norm: null, numero: '777' },
    { id: 20, cliente_id: 2, patente_norm: 'ZZZZ99', numero: '555' },
    { id: 12, cliente_id: 1, patente_norm: 'SINN01', numero: '888' }, // existe, sin neumáticos
    { id: 13, cliente_id: 1, patente_norm: 'DIST01', numero: '999', distribucion: '6x2' }, // con distribución definida
  ];
  const neumaticos: Neu[] = [
    { vehiculo_id: 10, posicion: 1, idneumatico: 'N1', codigo: 'C1', auxilio: false },
    { vehiculo_id: 10, posicion: 2, idneumatico: 'N2', codigo: 'C2', auxilio: false },
    { vehiculo_id: 10, posicion: 99, idneumatico: 'N99', codigo: 'C99', auxilio: true },
    { vehiculo_id: 10, posicion: 3, idneumatico: null, codigo: 'SIN', auxilio: false },
    { vehiculo_id: 11, posicion: 1, idneumatico: 'M1', codigo: 'D1', auxilio: false },
    { vehiculo_id: 20, posicion: 1, idneumatico: 'X1', codigo: 'E1', auxilio: false },
    { vehiculo_id: 20, posicion: 2, idneumatico: 'X2', codigo: 'E2', auxilio: false },
    { vehiculo_id: 13, posicion: 1, idneumatico: 'D1', codigo: 'F1', auxilio: false },
  ];
  const mediciones: Med[] = [
    { vehiculo_id: 10, cliente_id: 1, posicion: 1, mm1: 9, mm2: 8, mm3: 7, sesion_id: 's0', device_id: 'x' },
  ];
  const logs: LogEntrada[] = [];
  const idem = new Map<string, { hash: string; resp: GuardarRpc }>();
  const llamadas = { guardar: 0, obtener: 0, login: 0 };
  /** Argumentos que recibió cada llamada a `guardar` (para comprobar lo que el handler le pasa a la RPC). */
  const argsGuardar: GuardarArgs[] = [];
  const estado = { limite: 1_000_000, fallaLog: false, fallaGuardar: false, contadores: new Map<string, number>() };

  const deps: Deps = {
    auth: {
      login: (email, clave) => {
        llamadas.login++;
        for (const [id, u] of usuarios) {
          if (u.email === email && u.clave === clave) {
            return Promise.resolve({ access_token: 'tok-' + id, user_id: id });
          }
        }
        return Promise.resolve(null);
      },
      getUser: (t) => {
        const id = t.startsWith('tok-') ? t.slice(4) : '';
        return Promise.resolve(usuarios.has(id) ? { id } : null);
      },
    },
    db: {
      getPerfil: (id) => Promise.resolve(perfiles.get(id) ?? null),
      rateLimit: (cuenta, max) => {
        const n = (estado.contadores.get(cuenta) ?? 0) + 1;
        estado.contadores.set(cuenta, n);
        return Promise.resolve(n <= Math.min(max, estado.limite));
      },
      obtener: (clienteId, matricula, numero): Promise<ObtenerRpc> => {
        llamadas.obtener++;
        const mat = matricula.replace(/\s+/g, '').toUpperCase();
        const v = vehiculos.find((x) =>
          x.cliente_id === clienteId && ((mat !== '' && x.patente_norm === mat) || (mat === '' && x.numero === numero))
        );
        if (!v) return Promise.resolve({ encontrado: false, matricula: '', numero: '', data: [] });
        const data = neumaticos.filter((n) => n.vehiculo_id === v.id && n.idneumatico !== null)
          .sort((a, b) => a.posicion - b.posicion).map((n) => {
            const m = mediciones.filter((x) => x.vehiculo_id === v.id && x.posicion === n.posicion).at(-1);
            return { ...n, mm1: m?.mm1 ?? null, mm2: m?.mm2 ?? null, mm3: m?.mm3 ?? null };
          });
        return Promise.resolve({
          encontrado: true,
          vehiculo_id: v.id,
          matricula: v.patente_norm ?? '',
          numero: v.numero ?? '',
          distribucion: v.distribucion ?? '',
          data,
        });
      },
      guardar: (a: GuardarArgs): Promise<GuardarRpc> => {
        llamadas.guardar++;
        argsGuardar.push(a);
        if (estado.fallaGuardar) return Promise.reject(new Error('boom'));
        const prev = idem.get(a.cuenta + '|' + a.clave);
        if (prev) {
          return Promise.resolve(
            prev.hash !== a.hash
              ? { estado: 'conflicto', replay: false, resultados: [] }
              : { ...prev.resp, replay: true },
          );
        }
        let v = vehiculos.find((x) => x.cliente_id === a.cliente_id && x.patente_norm === a.patente);
        // Alta (20261121000000): patente inexistente del cliente + al menos una posición válida
        // (1..16 o 99, sin rechazo y con las tres lecturas) crea el vehículo y los neumáticos.
        const valida = (m: GuardarArgs['montajes'][number]) =>
          !m.rechazar && ((m.posicion >= 1 && m.posicion <= 16) || m.posicion === 99) &&
          m.mm1 !== null && m.mm2 !== null && m.mm3 !== null;
        let alta = false;
        if (!v && a.montajes.some(valida)) {
          v = {
            id: 1000 + vehiculos.length,
            cliente_id: a.cliente_id,
            patente_norm: a.patente,
            numero: null,
            distribucion: a.distribucion,
          };
          vehiculos.push(v);
          alta = true;
        } else if (v && a.distribucion !== null) {
          // Vehículo existente (20261122000000): si ya tiene otra distribución, nada se guarda (motivo 'distribucion');
          // si no tiene, la adopta. (La compatibilidad con tipo_ruedas se prueba en SQL.)
          if (v.distribucion && v.distribucion !== a.distribucion) {
            return Promise.resolve({
              estado: 'ok',
              replay: false,
              vehiculo_id: v.id,
              resultados: a.montajes.map((m) => ({ posicion: m.posicion, guardado: false, motivo: 'distribucion' })),
            });
          }
          v.distribucion ??= a.distribucion;
        }
        if (!v) {
          return Promise.resolve({
            estado: 'no_encontrado',
            replay: false,
            resultados: a.montajes.map((m) => ({ posicion: m.posicion, guardado: false, motivo: 'vehiculo' })),
          });
        }
        if (alta) {
          let creados = 0;
          const resultados = a.montajes.map((m) => {
            if (m.rechazar) return { posicion: m.posicion, guardado: false, motivo: m.rechazar };
            if (m.mm1 === null && m.mm2 === null && m.mm3 === null) {
              return m.posicion === 99
                ? { posicion: m.posicion, guardado: true, motivo: null }
                : { posicion: m.posicion, guardado: false, motivo: 'sin_medicion' };
            }
            if (m.mm1 === null || m.mm2 === null || m.mm3 === null) {
              return { posicion: m.posicion, guardado: false, motivo: 'incompleta' };
            }
            if (!valida(m)) return { posicion: m.posicion, guardado: false, motivo: 'posicion' };
            neumaticos.push({
              vehiculo_id: v!.id,
              posicion: m.posicion,
              idneumatico: `API-${v!.id}-P${m.posicion}`,
              codigo: '',
              auxilio: m.posicion === 99,
            });
            mediciones.push({
              vehiculo_id: v!.id,
              cliente_id: a.cliente_id,
              posicion: m.posicion,
              mm1: m.mm1,
              mm2: m.mm2,
              mm3: m.mm3,
              sesion_id: a.sesion_id,
              device_id: 'api:' + a.cuenta,
            });
            creados++;
            return { posicion: m.posicion, guardado: true, motivo: null };
          });
          const out: GuardarRpc = {
            estado: 'ok',
            replay: false,
            vehiculo_id: v.id,
            creado: true,
            neumaticos_creados: creados,
            resultados,
          };
          idem.set(a.cuenta + '|' + a.clave, { hash: a.hash, resp: out });
          return Promise.resolve(out);
        }
        const tiene = neumaticos.some((x) => x.vehiculo_id === v.id && x.idneumatico !== null);
        const resultados = a.montajes.map((m) => {
          const n = neumaticos.find((x) =>
            x.vehiculo_id === v.id && x.posicion === m.posicion && x.idneumatico !== null
          );
          // Mismo orden de decisión que api_guardar_montaje (20261112000000).
          if (!tiene) return { posicion: m.posicion, guardado: false, motivo: 'sin_neumaticos' };
          if (m.rechazar) return { posicion: m.posicion, guardado: false, motivo: m.rechazar };
          if (!n) return { posicion: m.posicion, guardado: false, motivo: 'posicion' };
          if (m.mm1 === null && m.mm2 === null && m.mm3 === null) {
            return n.auxilio
              ? { posicion: m.posicion, guardado: true, motivo: null }
              : { posicion: m.posicion, guardado: false, motivo: 'sin_medicion' };
          }
          mediciones.push({
            vehiculo_id: v.id,
            cliente_id: a.cliente_id,
            posicion: m.posicion,
            mm1: m.mm1!,
            mm2: m.mm2!,
            mm3: m.mm3!,
            sesion_id: a.sesion_id,
            device_id: 'api:' + a.cuenta,
          });
          return { posicion: m.posicion, guardado: true, motivo: null };
        });
        const out: GuardarRpc = { estado: 'ok', replay: false, vehiculo_id: v.id, resultados };
        idem.set(a.cuenta + '|' + a.clave, { hash: a.hash, resp: out });
        return Promise.resolve(out);
      },
      log: (e) => {
        if (estado.fallaLog) return Promise.reject(new Error('log'));
        logs.push(e);
        return Promise.resolve();
      },
    },
  };
  const handler = createHandler(deps);
  return { deps, handler, perfilDe: perfiles, vehiculos, neumaticos, mediciones, logs, llamadas, argsGuardar, estado };
}

const BASE = 'https://x.supabase.co/functions/v1/api-proveedor';
export function post(
  ruta: string,
  body: unknown,
  opts: { token?: string; headers?: Record<string, string>; raw?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  return new Request(BASE + ruta, {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}
export const R_LOGIN = '/auth/login';
export const R_OBT = '/emenube/neumaticos/obtener_montaje';
export const R_GUA = '/emenube/neumaticos/guardar_montaje_mm';
