import type { FilaBd } from './mapping.ts';

export interface PerfilApi {
  rol: string;
  cliente_id: number | null;
}

export interface ItemRpc {
  posicion: number;
  mm1: number | null;
  mm2: number | null;
  mm3: number | null;
  /** Si viene, la posición se informa guardado:false sin tocar la BD. */
  rechazar?: string;
}

export interface GuardarArgs {
  cliente_id: number;
  cuenta: string;
  patente: string;
  montajes: ItemRpc[];
  sesion_id: string;
  clave: string;
  hash: string;
}

export interface GuardarRpc {
  estado: 'ok' | 'no_encontrado' | 'conflicto';
  replay: boolean;
  vehiculo_id?: number;
  resultados: { posicion: number; guardado: boolean; motivo?: string | null }[];
}

export interface ObtenerRpc {
  encontrado: boolean;
  vehiculo_id?: number;
  matricula: string;
  numero: string;
  data: (Partial<FilaBd> & {
    idneumatico: string | null;
    codigo: string | null;
    posicion: number;
    auxilio: boolean;
  })[];
}

export interface LogEntrada {
  request_id: string;
  endpoint: string;
  device_id: string;
  cuenta: string;
  cliente_id: number | null;
  vehiculo_id: number | null;
  status: 'ok' | 'rechazado' | 'error';
  http_code: number;
  motivo: string | null;
  payload_resumen: Record<string, unknown>;
  n_guardados: number | null;
  n_fallidos: number | null;
  duracion_ms: number;
}

export interface Deps {
  auth: {
    /** null = credenciales inválidas; lanza ante fallos de infraestructura. */
    login(email: string, clave: string): Promise<{ access_token: string; user_id: string } | null>;
    getUser(token: string): Promise<{ id: string } | null>;
  };
  db: {
    getPerfil(userId: string): Promise<PerfilApi | null>;
    /** true = permitido. `cuenta` es un uuid (de usuario o derivado de la IP). */
    rateLimit(cuenta: string, max: number): Promise<boolean>;
    obtener(clienteId: number, matricula: string, numero: string): Promise<ObtenerRpc>;
    guardar(args: GuardarArgs): Promise<GuardarRpc>;
    log(entrada: LogEntrada): Promise<void>;
  };
}
