import { assertEquals } from 'jsr:@std/assert@1';
import { type ClienteLectura, type Consulta, accesoQuitadoDe } from './quitado.ts';

type Fila = Record<string, unknown>;

/** Cliente simulado que filtra de verdad: una consulta sin el filtro por cliente devuelve filas de otras empresas. */
function simulado(tablas: Record<string, Fila[]>): ClienteLectura {
  return {
    from(tabla) {
      let filas = [...(tablas[tabla] ?? [])];
      const q: Consulta = {
        select: () => q,
        eq: (c, v) => (filas = filas.filter((f) => f[c] === v), q),
        order: (c, o) => (filas.sort((a, b) => (Number(a[c]) - Number(b[c])) * (o.ascending ? 1 : -1)), q),
        limit: (n) => (filas = filas.slice(0, n), q),
        // deno-lint-ignore no-explicit-any
        then: (ok: any, ko: any) => Promise.resolve({ data: filas, error: null }).then(ok, ko),
      };
      return q;
    },
  };
}

const quitadoA = { id: 5, cliente_id: 7, user_id: 'u1', email: 'a@b.cl', repuesto_at: null };

Deno.test('quitado en la misma empresa, sin perfil: verdadero (el email se normaliza a minúsculas)', async () => {
  assertEquals(await accesoQuitadoDe(simulado({ accesos_quitados: [quitadoA], perfiles: [] }), 'A@B.cl', 7), true);
});
Deno.test('cableado: el filtro por cliente_id es obligatorio (un quitado de OTRA empresa no orienta a reponer)', async () => {
  const db = simulado({ accesos_quitados: [quitadoA], perfiles: [] });
  assertEquals(await accesoQuitadoDe(db, 'a@b.cl', 8), false);
});
Deno.test('solo cuenta la fila más reciente: una baja vieja con una posterior repuesta no orienta a reponer', async () => {
  const db = simulado({
    accesos_quitados: [quitadoA, { ...quitadoA, id: 9, repuesto_at: '2026-11-01' }],
    perfiles: [],
  });
  assertEquals(await accesoQuitadoDe(db, 'a@b.cl', 7), false);
});
Deno.test('con perfil hoy (reasignado por el equipo Neumet) no orienta a reponer', async () => {
  const db = simulado({ accesos_quitados: [quitadoA], perfiles: [{ user_id: 'u1' }] });
  assertEquals(await accesoQuitadoDe(db, 'a@b.cl', 7), false);
});
