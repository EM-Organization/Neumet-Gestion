import type { FilaBd } from './mapping.ts';

export interface PerfilApi {
  rol: string;
  cliente_id: number | null;
  /**
   * true solo si el cliente existe y no está dado de baja (`clientes.deleted_at` nulo).
   * Cualquier otra cosa (false, ausente) cierra: la cuenta se trata como sin perfil.
   */
  cliente_activo?: boolean;
  /**
   * Flag del cliente (`clientes.odometro_obligatorio`). Solo `false` relaja la exigencia del odómetro: ausente o
   * cualquier otra cosa la exige (falla cerrado).
   */
  odometro_obligatorio?: boolean;
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
  /** Distribución informada por la app (código del catálogo) o null si no la informó. */
  distribucion: string | null;
  /** Odómetro del vehículo al momento del registro (km enteros >= 0) o null si no se informó. */
  odometro_km: number | null;
}

export interface GuardarRpc {
  estado: 'ok' | 'no_encontrado' | 'conflicto';
  replay: boolean;
  vehiculo_id?: number;
  /** true solo en la request que creó el vehículo (en un replay se repite el valor guardado). */
  creado?: boolean;
  neumaticos_creados?: number;
  resultados: { posicion: number; guardado: boolean; motivo?: string | null }[];
}

export interface ObtenerRpc {
  encontrado: boolean;
  vehiculo_id?: number;
  matricula: string;
  numero: string;
  /** Distribución del vehículo; '' si no está definida. Ausente si no se encontró el vehículo. */
  distribucion?: string;
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
