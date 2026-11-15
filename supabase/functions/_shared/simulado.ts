// Mundo simulado para probar quitar/reponer acceso: una base con un usuario (perfil sí/no, filas de `accesos_quitados`)
// y un Auth con bloqueo, que reproducen los contratos de las RPC de la migración A (20261119000000_admin_empresa.sql).
// Cada llamada a Auth puede retenerse (`retener`) para controlar el orden de llegada y reproducir las carreras de
// docs/17 §4.1 sin tiempos reales.
import type { EstadoVigente, Marca, RpcResult } from './acceso.ts';

export const USUARIO = '11111111-1111-4111-8111-111111111111';
export const ADMIN_JWT = 'admin-jwt';

interface Fila {
  id: number;
  repuesta: boolean;
  aplicado: boolean;
  levantado: boolean;
}

export class Mundo {
  tienePerfil = true;
  baneado = false;
  filas: Fila[] = [];
  /** Registro ordenado de lo que llegó a Auth y a la base: `ban`, `unban`, `marca:aplicado:<id>`… */
  log: string[] = [];
  /** Hace fallar la próxima llamada a Auth (una vez por cada true encolado). */
  fallosAuth: boolean[] = [];
  /** Compuertas por operación de Auth, en orden de llamada: la llamada espera hasta que la compuerta se libere. */
  retener: Array<{ cuando: 'ban' | 'unban'; compuerta: Promise<void> }> = [];
  /** Si está, cada relectura de estado alterna el perfil (simula otra operación que cambia el estado sin parar). */
  alternarEnCadaLectura = false;
  ultimoAcceso = 0;

  get ultima(): Fila | undefined {
    return this.filas[this.filas.length - 1];
  }

  // --- RPC con el JWT del llamante (autoriza: solo ADMIN_JWT) ---
  quitar = (token: string, userId: string, accesoId: number | null): Promise<RpcResult> => {
    this.log.push(`rpc:quitar:${accesoId ?? 'nuevo'}`);
    const den: RpcResult = { error: { code: '42501', message: 'permiso denegado' } };
    if (token !== ADMIN_JWT || userId !== USUARIO) return Promise.resolve(den);
    if (accesoId === null) {
      if (!this.tienePerfil) return Promise.resolve(den);
      this.tienePerfil = false;
      const f = { id: ++this.ultimoAcceso, repuesta: false, aplicado: false, levantado: false };
      this.filas.push(f);
      return Promise.resolve({ data: { estado: 'quitado', acceso_id: f.id, user_id: userId } });
    }
    const u = this.ultima;
    if (this.tienePerfil || !u || u.id !== accesoId || u.repuesta) return Promise.resolve(den);
    return Promise.resolve({ data: { estado: 'ya_quitado', acceso_id: u.id, user_id: userId } });
  };

  reponer = (token: string, accesoId: number, _sucursalId: number | null): Promise<RpcResult> => {
    this.log.push(`rpc:reponer:${accesoId}`);
    const den: RpcResult = { error: { code: '42501', message: 'permiso denegado' } };
    const u = this.ultima;
    if (token !== ADMIN_JWT || !u) return Promise.resolve(den);
    if (this.tienePerfil) {
      return Promise.resolve({ data: { estado: 'ya_repuesto', acceso_id: u.id, user_id: USUARIO } });
    }
    if (u.id !== accesoId || u.repuesta) return Promise.resolve(den);
    this.tienePerfil = true;
    u.repuesta = true;
    return Promise.resolve({ data: { estado: 'repuesto', acceso_id: u.id, user_id: USUARIO } });
  };

  // --- Dependencias con la clave de servicio ---
  estado = (accesoId: number, marca: Marca): Promise<EstadoVigente> => {
    if (this.alternarEnCadaLectura) this.tienePerfil = !this.tienePerfil;
    const f = this.filas.find((x) => x.id === accesoId);
    if (!f) return Promise.resolve({ existe: false, tiene_perfil: null });
    // Igual que la RPC: la marca solo se escribe si es cierta (más reciente y estado coherente).
    if (marca === 'aplicado' && f === this.ultima && !f.repuesta && !this.tienePerfil) {
      f.aplicado = true;
      this.log.push(`marca:aplicado:${f.id}`);
    }
    if (marca === 'levantado' && f === this.ultima && f.repuesta && this.tienePerfil) {
      f.levantado = true;
      this.log.push(`marca:levantado:${f.id}`);
    }
    return Promise.resolve({ existe: true, tiene_perfil: this.tienePerfil });
  };

  fijarBloqueo = async (_userId: string, bloquear: boolean): Promise<boolean> => {
    const op = bloquear ? 'ban' : 'unban';
    const i = this.retener.findIndex((r) => r.cuando === op);
    if (i >= 0) await this.retener.splice(i, 1)[0].compuerta;
    if (this.fallosAuth.shift()) {
      this.log.push(`${op}:fallo`);
      return false;
    }
    this.baneado = bloquear;
    this.log.push(op);
    return true;
  };

  /** Lo que debe ser cierto al terminar todo: Auth bloqueado si y solo si el usuario no tiene perfil. */
  coherente(): boolean {
    return this.baneado === !this.tienePerfil;
  }
}

/** Compuerta controlable: `esperar` se resuelve cuando se llama a `liberar`. */
export function compuerta(): { esperar: Promise<void>; liberar: () => void } {
  let liberar!: () => void;
  const esperar = new Promise<void>((r) => (liberar = r));
  return { esperar, liberar };
}

export const llamadasAuth = (log: string[]) => log.filter((l) => l === 'ban' || l === 'unban' || l.endsWith(':fallo'));
