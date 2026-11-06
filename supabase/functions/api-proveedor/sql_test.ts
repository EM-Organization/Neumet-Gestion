// Pruebas de las RPC y políticas contra un Postgres LOCAL desechable (initdb en
// un directorio temporal, socket unix, sin red). Aplica la migración inicial y
// la de la API. Se omiten si no hay binarios de Postgres. NO toca ninguna base remota.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { normalizarPatente } from './handler.ts';

function buscarBin(): string | null {
  const cands = [
    ...(Deno.env.get('PATH') ?? '').split(':'),
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    ...[...Array(10).keys()].map((i) => `/usr/lib/postgresql/${18 - i}/bin`),
  ];
  for (const d of cands) {
    try {
      Deno.statSync(`${d}/initdb`);
      Deno.statSync(`${d}/postgres`);
      Deno.statSync(`${d}/psql`);
      return d;
    } catch { /* siguiente */ }
  }
  return null;
}

const BIN = buscarBin();
const MIGS = new URL('../../migrations/', import.meta.url).pathname;
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'; // api, cliente 1
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'; // api, cliente 2
const UCLI = 'aaaaaaaa-0000-4000-8000-000000000003'; // cliente
const SES = 'bbbbbbbb-0000-4000-8000-000000000001';

Deno.test({
  name: 'Postgres local: api_guardar_montaje, api_obtener_montaje, idempotencia, rate limit y privilegios',
  ignore: BIN === null,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const dir = await Deno.makeTempDir({ prefix: 'neumet-pg-' });
    const sock = await Deno.makeTempDir({ prefix: 'neumet-sock-' });
    const port = '54' + String(Math.floor(Math.random() * 900) + 100);
    const env = { LC_ALL: 'C', LANG: 'C' };
    const run = async (cmd: string, args: string[]) => {
      const o = await new Deno.Command(`${BIN}/${cmd}`, { args, env, stdout: 'piped', stderr: 'piped' }).output();
      const out = new TextDecoder().decode(o.stdout);
      const err = new TextDecoder().decode(o.stderr);
      if (!o.success) throw new Error(`${cmd} falló: ${err}`);
      return out.trim();
    };
    await run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
    const pg = new Deno.Command(`${BIN}/postgres`, {
      args: ['-D', dir, '-k', sock, '-p', port, '-c', 'listen_addresses='],
      env,
      stdout: 'null',
      stderr: 'null',
    }).spawn();
    const psql = (args: string[]) =>
      run('psql', [
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-h',
        sock,
        '-p',
        port,
        '-U',
        'postgres',
        '-d',
        'postgres',
        ...args,
      ]);
    const q = (sql: string) => psql(['-c', sql]);
    const qj = async (sql: string) => JSON.parse(await q(sql));
    /** Ejecuta como rol de Supabase. */
    const como = (rol: string, sql: string) => q(`set role ${rol}; ${sql}`);

    try {
      for (let i = 0; i < 100; i++) {
        try {
          await q('select 1');
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      // Entorno mínimo tipo Supabase (roles, esquema auth).
      await q(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth;
        create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql stable
          as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema public, auth to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
        grant execute on function auth.uid() to anon, authenticated, service_role;`);
      for (const f of ['20261106000000_init_schema.sql', '20261106010000_api_proveedor.sql']) {
        await psql(['-f', MIGS + f]);
      }
      await q(`
        insert into auth.users values ('${U1}'),('${U2}'),('${UCLI}');
        insert into public.clientes (id, nombre) values (1,'DAC'),(2,'OTRO');
        insert into public.perfiles values ('${U1}','api',1),('${U2}','api',2),('${UCLI}','cliente',1);
        insert into public.vehiculos (id, cliente_id, nombre, patente, numero) values
          (10,1,'v10','abcd 12','123'),(11,1,'v11',null,'777'),(20,2,'v20','ZZZZ99','555');
        insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, codigo, auxilio) values
          (10,1,1,'N1','C1',false),(10,1,2,'N2','C2',false),(10,1,99,'N99','C99',true),
          (10,1,3,null,'SIN',false),(11,1,1,'M1','D1',false),(20,2,1,'X1','E1',false);`);

      const guardar = (
        cli: number,
        cuenta: string,
        pat: string,
        items: unknown,
        clave: string,
        hash = 'h1',
        ses = SES,
      ) =>
        qj(
          `set role service_role; select public.api_guardar_montaje(${cli}, '${cuenta}', '${pat}', '${
            JSON.stringify(items)
          }'::jsonb, '${ses}', '${clave}', '${hash}')`,
        );
      const nMed = async () => Number(await q('select count(*) from public.mediciones'));

      await t.step('normalizar_patente (SQL) == normalizarPatente (TS)', async () => {
        for (const s of ['abcd 12', ' ab-cd\t12 ', '', '   ', 'ÑU 123']) {
          const sql = await q(`select coalesce(public.normalizar_patente($$${s}$$), '<null>')`);
          assertEquals(sql, normalizarPatente(s) ?? '<null>', JSON.stringify(s));
        }
      });

      await t.step(
        'guardar: persiste columnas BD, device_id, sesion_id, promedio; fallo parcial; auxilio null',
        async () => {
          const r = await guardar(1, U1, 'ABCD12', [
            { posicion: 1, mm1: 9, mm2: 8, mm3: 7 },
            { posicion: 2, mm1: 0, mm2: 41, mm3: 7 }, // viola CHECK -> savepoint, solo esta falla
            { posicion: 99, mm1: null, mm2: null, mm3: null }, // auxilio sin medir
            { posicion: 3, mm1: 1, mm2: 1, mm3: 1 }, // sin idneumatico: no existe en el montaje
            { posicion: 5, mm1: 1, mm2: 1, mm3: 1 }, // inexistente
            { posicion: 2, mm1: 1, mm2: 1, mm3: 1, rechazar: 'duplicado_distinto' },
          ], 'k:a');
          assertEquals(r.estado, 'ok');
          assertEquals(r.resultados.map((x: { guardado: boolean }) => x.guardado), [
            true,
            false,
            true,
            false,
            false,
            false,
          ]);
          assertEquals(await nMed(), 1);
          const fila = await qj(`select to_jsonb(m) from public.mediciones m`);
          assertEquals([fila.vehiculo_id, fila.cliente_id, fila.mm1, fila.mm2, fila.mm3, fila.promedio], [
            10,
            1,
            9,
            8,
            7,
            8,
          ]);
          assertEquals([fila.device_id, fila.sesion_id, fila.idneumatico, fila.patente_raw], [
            'api:' + U1,
            SES,
            'N1',
            'ABCD12',
          ]);
        },
      );

      await t.step('idempotencia: misma clave -> replay sin doble escritura; otro contenido -> conflicto', async () => {
        const items = [{ posicion: 1, mm1: 9, mm2: 8, mm3: 7 }];
        const a = await guardar(1, U1, 'ABCD12', items, 'k:b', 'hb');
        const b = await guardar(1, U1, 'ABCD12', items, 'k:b', 'hb');
        assertEquals(a.replay, false);
        assertEquals(b.replay, true);
        assertEquals(b.resultados, a.resultados);
        assertEquals(await nMed(), 2);
        const c = await guardar(1, U1, 'ABCD12', items, 'k:b', 'otro');
        assertEquals(c.estado, 'conflicto');
        assertEquals(await nMed(), 2);
        // misma clave en OTRA cuenta no colisiona
        const d = await guardar(2, U2, 'ZZZZ99', [{ posicion: 1, mm1: 5, mm2: 5, mm3: 5 }], 'k:b', 'hb');
        assertEquals(d.replay, false);
        assertEquals(await nMed(), 3);
      });

      await t.step('idempotencia por hash: ventana de 10 min y TTL de 24 h', async () => {
        const items = [{ posicion: 2, mm1: 3, mm2: 3, mm3: 3 }];
        await guardar(1, U1, 'ABCD12', items, 'h:zz', 'zz');
        assertEquals((await guardar(1, U1, 'ABCD12', items, 'h:zz', 'zz')).replay, true);
        const n = await nMed();
        await q(`update public.api_idempotencia set created_at = now() - interval '11 minutes' where clave = 'h:zz'`);
        assertEquals((await guardar(1, U1, 'ABCD12', items, 'h:zz', 'zz')).replay, false);
        assertEquals(await nMed(), n + 1);
        // 'k:' sigue vigente a los 11 min y se purga a las 25 h
        await q(`update public.api_idempotencia set created_at = now() - interval '11 minutes' where clave = 'k:b'`);
        assertEquals(
          (await guardar(1, U1, 'ABCD12', [{ posicion: 1, mm1: 9, mm2: 8, mm3: 7 }], 'k:b', 'hb')).replay,
          true,
        );
        await q(
          `update public.api_idempotencia set created_at = now() - interval '25 hours' where clave = 'k:b' and cuenta = '${U1}'`,
        );
        assertEquals(
          (await guardar(1, U1, 'ABCD12', [{ posicion: 1, mm1: 9, mm2: 8, mm3: 7 }], 'k:b', 'hb')).replay,
          false,
        );
      });

      await t.step('AISLAMIENTO: vehículo ajeno == inexistente (guardar), sin escrituras', async () => {
        const n = await nMed();
        const items = [{ posicion: 1, mm1: 1, mm2: 1, mm3: 1 }];
        const ajeno = await guardar(1, U1, 'ZZZZ99', items, 'k:c1', 'c');
        const nada = await guardar(1, U1, 'NOEXISTE1', items, 'k:c2', 'c');
        assertEquals(ajeno, nada);
        assertEquals(ajeno.estado, 'no_encontrado');
        // el vehículo 20 con posiciones del vehículo 10: cliente 1 no puede escribir en cliente 2
        const rev = await guardar(2, U2, 'ABCD12', [{ posicion: 2, mm1: 1, mm2: 1, mm3: 1 }], 'k:c3', 'c');
        assertEquals(rev.estado, 'no_encontrado');
        assertEquals(await nMed(), n);
      });

      await t.step('obtener: última por posición (DISTINCT ON), solo del cliente, omite sin idneumatico', async () => {
        await q(`insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, promedio, created_at)
                 values (10,1,1,6,5,4,0, now() + interval '1 hour')`);
        const obt = (cli: number, mat: string, num: string) =>
          qj(`set role service_role; select public.api_obtener_montaje(${cli}, $$${mat}$$, $$${num}$$)`);
        const r = await obt(1, ' abcd 12', '');
        assertEquals([r.encontrado, r.matricula, r.numero], [true, 'ABCD12', '123']);
        assertEquals(r.data.map((d: { posicion: number }) => d.posicion), [1, 2, 99]);
        assertEquals([r.data[0].mm1, r.data[0].mm2, r.data[0].mm3], [6, 5, 4]);
        assertEquals(r.data[0].codigo, 'C1');
        assertEquals([r.data[2].auxilio, r.data[2].mm1], [true, null]);
        assertEquals((await obt(1, '', '123')).matricula, 'ABCD12');
        const sinMat = await obt(1, '', '777');
        assertEquals([sinMat.matricula, sinMat.numero], ['', '777']);
        const ajeno = await obt(1, 'ZZZZ99', '');
        const nada = await obt(1, 'NOEXISTE1', '');
        const ajenoNum = await obt(1, '', '555');
        assertEquals(ajeno, nada);
        assertEquals(ajenoNum, nada);
        assertEquals(nada, { encontrado: false, matricula: '', numero: '', data: [] });
        // las mediciones del otro cliente no se mezclan
        assertEquals((await obt(2, 'ZZZZ99', '')).data[0].mm1, 5);
      });

      await t.step('rate limit: cuenta hasta el máximo y rechaza el exceso', async () => {
        const hit = async () =>
          (await q(`set role service_role; select public.api_rate_limit_hit('${U1}', 3)`)) === 't';
        assertEquals([await hit(), await hit(), await hit(), await hit()], [true, true, true, false]);
        assertEquals(await q(`set role service_role; select public.api_rate_limit_hit('${U2}', 3)`), 't');
      });

      await t.step(
        'privilegios: anon/authenticated/api no acceden a RPC ni tablas nuevas; RLS sin políticas',
        async () => {
          for (const rol of ['anon', 'authenticated']) {
            await assertRejects(
              () => como(rol, `select public.api_rate_limit_hit('${U1}', 1)`),
              Error,
              'permission denied',
            );
            await assertRejects(
              () => como(rol, `select public.api_obtener_montaje(1,'ABCD12','')`),
              Error,
              'permission denied',
            );
            await assertRejects(
              () => como(rol, `select public.api_guardar_montaje(1,'${U1}','ABCD12','[]','${SES}','k:x','x')`),
              Error,
              'permission denied',
            );
          }
          // tablas nuevas: sin privilegios para anon/authenticated y RLS activa sin políticas (doble cierre)
          for (const tabla of ['api_idempotencia', 'api_rate_limit']) {
            for (const rol of ['anon', 'authenticated']) {
              await assertRejects(() => como(rol, `select count(*) from public.${tabla}`), Error, 'permission denied');
            }
            assertEquals(
              await q(`select relrowsecurity from pg_class where oid = 'public.${tabla}'::regclass`),
              't',
            );
            assertEquals(await q(`select count(*) from pg_policies where tablename = '${tabla}'`), '0');
          }
          // la cuenta 'api' (JWT de authenticated) no ve nada por PostgREST: ni perfiles ni datos
          const comoApi = (sql: string) => q(`set role authenticated; set request.jwt.claim.sub = '${U1}'; ${sql}`);
          for (const tabla of ['perfiles', 'vehiculos', 'neumaticos', 'mediciones', 'clientes', 'ingesta_log']) {
            assertEquals(await comoApi(`select count(*) from public.${tabla}`), '0', tabla);
          }
          // el rol 'cliente' sigue viendo solo lo suyo (las políticas existentes no cambian)
          assertEquals(
            await q(
              `set role authenticated; set request.jwt.claim.sub = '${UCLI}'; select count(*) from public.vehiculos`,
            ),
            '2',
          );
          // funciones nuevas: SECURITY DEFINER con search_path fijo
          assertEquals(
            await q(`select count(*) from pg_proc p where p.proname like 'api\\_%' and p.prosecdef
                   and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')`),
            '3',
          );
        },
      );
    } finally {
      try {
        pg.kill('SIGINT');
        await pg.status;
      } catch { /* ya terminó */ }
      await Deno.remove(dir, { recursive: true }).catch(() => {});
      await Deno.remove(sock, { recursive: true }).catch(() => {});
    }
  },
});
