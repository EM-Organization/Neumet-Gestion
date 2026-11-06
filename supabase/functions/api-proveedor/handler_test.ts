import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { crearEntorno, post, R_GUA, R_LOGIN, R_OBT, U_ADMIN, U_CLI, U_DAC, U_OTRO } from './testkit.ts';
import { RATE_LOGIN_IP_POR_MIN } from './handler.ts';

async function j(r: Response) {
  return await r.json();
}
const T = 'tok-' + U_DAC;
const montaje = (extra: Record<string, unknown>[], patente = 'ABCD12') => ({ patente, numero: '', montajes: extra });

// ------------------------------------------------------------------ login
Deno.test('login OK: HTTP 200 exacto, code 200, access_token, sin refresh_token', async () => {
  const e = crearEntorno();
  const r = await e.handler(post(R_LOGIN, { email: 'dac@x.cl', clave: 'clave-dac', tipoLogin: 2 }));
  assertEquals(r.status, 200);
  assertEquals(await j(r), { code: 200, access_token: T });
  assertFalse(r.headers.has('access-control-allow-origin'));
  assert(r.headers.get('x-request-id'));
});

Deno.test('login acepta la ruta con y sin prefijo de función', async () => {
  const e = crearEntorno();
  for (const p of ['/auth/login', '/api-proveedor/auth/login', '/functions/v1/api-proveedor/auth/login/']) {
    const r = await e.handler(
      new Request('https://x.supabase.co' + p, {
        method: 'POST',
        body: JSON.stringify({ email: 'dac@x.cl', clave: 'clave-dac', tipoLogin: 2 }),
      }),
    );
    assertEquals(r.status, 200, p);
  }
});

Deno.test('login: credenciales inválidas -> 401', async () => {
  const e = crearEntorno();
  const r = await e.handler(post(R_LOGIN, { email: 'dac@x.cl', clave: 'mala', tipoLogin: 2 }));
  assertEquals(r.status, 401);
  assertEquals((await j(r)).code, 401);
});

Deno.test('login: tipoLogin distinto de 2 -> 401 sin consultar Auth', async () => {
  const e = crearEntorno();
  for (const t of [1, 3, '2', undefined]) {
    const r = await e.handler(post(R_LOGIN, { email: 'dac@x.cl', clave: 'clave-dac', tipoLogin: t }));
    assertEquals(r.status, 401);
  }
  assertEquals(e.llamadas.login, 0);
});

Deno.test('login: cuenta válida pero sin rol api -> 401 idéntico (no revela motivo)', async () => {
  const e = crearEntorno();
  const mala = await e.handler(post(R_LOGIN, { email: 'dac@x.cl', clave: 'mala', tipoLogin: 2 }));
  const admin = await e.handler(post(R_LOGIN, { email: 'admin@x.cl', clave: 'clave-admin', tipoLogin: 2 }));
  const cli = await e.handler(post(R_LOGIN, { email: 'cli@x.cl', clave: 'clave-cli', tipoLogin: 2 }));
  assertEquals(admin.status, 401);
  assertEquals(cli.status, 401);
  assertEquals(await j(admin), await j(mala));
  assertEquals(await j(cli), { code: 401, message: 'Credenciales inválidas' });
});

Deno.test('login: cuerpo inválido -> 400; método distinto de POST -> 405; ruta desconocida -> 404', async () => {
  const e = crearEntorno();
  assertEquals((await e.handler(post(R_LOGIN, null, { raw: '{no json' }))).status, 400);
  assertEquals((await e.handler(post(R_LOGIN, { email: 1, clave: 'x', tipoLogin: 2 }))).status, 400);
  const g = await e.handler(new Request('https://x.supabase.co/functions/v1/api-proveedor/auth/login'));
  assertEquals(g.status, 405);
  const o = await e.handler(new Request('https://x.supabase.co/auth/login', { method: 'OPTIONS' }));
  assertEquals(o.status, 405);
  assertFalse(o.headers.has('access-control-allow-origin'));
  assertEquals((await e.handler(post('/otra', {}))).status, 404);
});

Deno.test('login: límite por IP -> 429', async () => {
  const e = crearEntorno();
  let ultimo = 0;
  for (let i = 0; i <= RATE_LOGIN_IP_POR_MIN; i++) {
    const r = await e.handler(
      post(R_LOGIN, { email: 'a@a.cl', clave: 'x', tipoLogin: 2 }, {
        headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
      }),
    );
    ultimo = r.status;
  }
  assertEquals(ultimo, 429);
  // otra IP no se ve afectada
  const otra = await e.handler(
    post(R_LOGIN, { email: 'a@a.cl', clave: 'x', tipoLogin: 2 }, { headers: { 'x-forwarded-for': '9.9.9.9' } }),
  );
  assertEquals(otra.status, 401);
});

// ---------------------------------------------------------- autorización
Deno.test('token ausente, malformado o inválido -> 401 code 401 (ambos endpoints)', async () => {
  const e = crearEntorno();
  for (const ruta of [R_OBT, R_GUA]) {
    assertEquals((await e.handler(post(ruta, {}))).status, 401);
    assertEquals((await e.handler(post(ruta, {}, { headers: { authorization: 'Basic abc' } }))).status, 401);
    const r = await e.handler(post(ruta, {}, { token: 'basura' }));
    assertEquals(r.status, 401);
    assertEquals((await j(r)).code, 401);
  }
  assertEquals(e.llamadas.obtener + e.llamadas.guardar, 0);
});

Deno.test('rol distinto de api (admin, cliente) -> 401 en 2 y 3', async () => {
  const e = crearEntorno();
  for (const u of [U_ADMIN, U_CLI]) {
    assertEquals(
      (await e.handler(post(R_OBT, { matricula: 'ABCD12', numero: '' }, { token: 'tok-' + u }))).status,
      401,
    );
    assertEquals(
      (await e.handler(post(R_GUA, montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }]), { token: 'tok-' + u })))
        .status,
      401,
    );
  }
  assertEquals(e.mediciones.length, 1);
});

// --------------------------------------------------------- obtener_montaje
Deno.test('obtener por matrícula (normalizada): última medición, auxilio, sin idneumatico omitido', async () => {
  const e = crearEntorno();
  e.mediciones.push({
    vehiculo_id: 10,
    cliente_id: 1,
    posicion: 1,
    mm1: 5,
    mm2: 4,
    mm3: 3,
    sesion_id: 's1',
    device_id: 'x',
  });
  const r = await e.handler(post(R_OBT, { matricula: ' abcd 12 ', numero: '' }, { token: T }));
  assertEquals(r.status, 200);
  assertEquals(await j(r), {
    code: 200,
    matricula: 'ABCD12',
    numero: '123',
    data: [
      { idneumatico: 'N1', codigo: 'C1', posicion: 1, auxilio: 'no', mm1: 5, mm2: 4, mm3: 4, mm4: 3 },
      { idneumatico: 'N2', codigo: 'C2', posicion: 2, auxilio: 'no', mm1: null, mm2: null, mm3: null, mm4: null },
      { idneumatico: 'N99', codigo: 'C99', posicion: 99, auxilio: 'si', mm1: null, mm2: null, mm3: null, mm4: null },
    ],
  });
});

Deno.test('obtener por numero devuelve matricula; sin matrícula -> cadena vacía', async () => {
  const e = crearEntorno();
  const a = await j(await e.handler(post(R_OBT, { matricula: '', numero: '123' }, { token: T })));
  assertEquals([a.code, a.matricula, a.numero], [200, 'ABCD12', '123']);
  const b = await j(await e.handler(post(R_OBT, { matricula: '', numero: '777' }, { token: T })));
  assertEquals([b.code, b.matricula, b.numero, b.data.length], [200, '', '777', 1]);
});

Deno.test('AISLAMIENTO: vehículo de otro cliente indistinguible de inexistente (obtener)', async () => {
  const e = crearEntorno();
  const ajeno = await e.handler(post(R_OBT, { matricula: 'ZZZZ99', numero: '' }, { token: T }));
  const nada = await e.handler(post(R_OBT, { matricula: 'NOEXISTE1', numero: '' }, { token: T }));
  const ajenoNum = await e.handler(post(R_OBT, { matricula: '', numero: '555' }, { token: T }));
  assertEquals(ajeno.status, 200);
  assertEquals(await j(ajeno), { code: 404, matricula: '', numero: '', data: [] });
  assertEquals(await j(nada), { code: 404, matricula: '', numero: '', data: [] });
  assertEquals(await j(ajenoNum), { code: 404, matricula: '', numero: '', data: [] });
  // y el dueño sí lo ve
  const dueno = await j(await e.handler(post(R_OBT, { matricula: 'ZZZZ99', numero: '' }, { token: 'tok-' + U_OTRO })));
  assertEquals(dueno.code, 200);
});

Deno.test('obtener: cliente_id del cuerpo se ignora', async () => {
  const e = crearEntorno();
  const r = await j(
    await e.handler(post(R_OBT, { matricula: 'ZZZZ99', numero: '', cliente_id: 2, clienteId: 2 }, { token: T })),
  );
  assertEquals(r.code, 404);
});

Deno.test('obtener: cuerpo inválido -> 400', async () => {
  const e = crearEntorno();
  for (
    const b of [{}, { matricula: 'A', numero: 5 }, { matricula: '', numero: '' }, {
      matricula: 'x'.repeat(65),
      numero: '',
    }]
  ) {
    assertEquals((await e.handler(post(R_OBT, b, { token: T }))).status, 400);
  }
  assertEquals((await e.handler(post(R_OBT, [], { token: T }))).status, 400);
});

// ------------------------------------------------------------- guardar
Deno.test('guardar OK: mapeo mm4->mm3, un objeto por elemento, device_id api:<cuenta>', async () => {
  const e = crearEntorno();
  const r = await e.handler(post(
    R_GUA,
    montaje([
      { posicion: 1, mm1: 9, mm2: 8, mm3: 8, mm4: 7 },
      { posicion: 2, mm1: 6, mm2: 5, mm3: 5, mm4: 4 },
    ]),
    { token: T },
  ));
  assertEquals(r.status, 200);
  assertEquals(await j(r), {
    code: 200,
    data: { guardados: [{ posicion: 1, guardado: true }, { posicion: 2, guardado: true }] },
  });
  const m = e.mediciones.at(-2)!;
  assertEquals([m.mm1, m.mm2, m.mm3, m.cliente_id, m.device_id], [9, 8, 7, 1, 'api:' + U_DAC]);
  assertEquals(e.mediciones.at(-1)!.sesion_id, m.sesion_id);
});

Deno.test('guardar: patente con minúsculas/espacios se normaliza', async () => {
  const e = crearEntorno();
  const r = await j(
    await e.handler(post(R_GUA, montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }], ' abcd 12 '), { token: T })),
  );
  assertEquals(r.data.guardados, [{ posicion: 1, guardado: true }]);
});

Deno.test('auxilio con los 4 null: NO se persiste, NO es error, guardado:true', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const r = await j(
    await e.handler(post(
      R_GUA,
      montaje([
        { posicion: 99, mm1: null, mm2: null, mm3: null, mm4: null },
      ]),
      { token: T },
    )),
  );
  assertEquals(r, { code: 200, data: { guardados: [{ posicion: 99, guardado: true }] } });
  assertEquals(e.mediciones.length, antes);
});

Deno.test('rueda NO auxilio con los 4 null -> guardado:false', async () => {
  const e = crearEntorno();
  const r = await j(await e.handler(post(R_GUA, montaje([{ posicion: 1 }]), { token: T })));
  assertEquals(r.data.guardados, [{ posicion: 1, guardado: false }]);
});

Deno.test('mm3 distinto de mm2 -> guardado:false solo en esa posición; el resto se guarda', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const r = await j(
    await e.handler(post(
      R_GUA,
      montaje([
        { posicion: 1, mm1: 9, mm2: 8, mm3: 6, mm4: 7 },
        { posicion: 2, mm1: 9, mm2: 8, mm3: 8, mm4: 7 },
      ]),
      { token: T },
    )),
  );
  assertEquals(r.data.guardados, [{ posicion: 1, guardado: false }, { posicion: 2, guardado: true }]);
  assertEquals(e.mediciones.length, antes + 1);
});

Deno.test('fallo parcial: fuera de rango, incompleta, posición inexistente en el vehículo', async () => {
  const e = crearEntorno();
  const r = await j(
    await e.handler(post(
      R_GUA,
      montaje([
        { posicion: 1, mm1: 41, mm2: 8, mm3: 8, mm4: 7 },
        { posicion: 2, mm1: -1, mm2: 8, mm3: 8, mm4: 7 },
        { posicion: 5, mm1: 1, mm2: 1, mm3: 1, mm4: 1 },
        { posicion: 99, mm1: 1, mm2: null, mm3: null, mm4: 1 },
        { posicion: 50, mm1: 0, mm2: 40, mm3: 40, mm4: 40 },
      ]),
      { token: T },
    )),
  );
  assertEquals(r.code, 200);
  assertEquals(r.data.guardados.map((g: { guardado: boolean }) => g.guardado), [false, false, false, false, false]);
  const ok = await j(
    await e.handler(post(R_GUA, montaje([{ posicion: 2, mm1: 0, mm2: 40, mm3: 40, mm4: 40 }]), { token: T })),
  );
  assertEquals(ok.data.guardados, [{ posicion: 2, guardado: true }]);
});

Deno.test('duplicados de posición, posición no entera o fuera de 1..99 -> 400', async () => {
  const e = crearEntorno();
  const ok = { mm1: 1, mm2: 1, mm3: 1, mm4: 1 };
  for (
    const montajes of [
      [{ posicion: 1, ...ok }, { posicion: 1, ...ok }],
      [{ posicion: 1.5, ...ok }],
      [{ posicion: 0, ...ok }],
      [{ posicion: 100, ...ok }],
      [{ posicion: '1', ...ok }],
      [{ posicion: 1, ...ok, mm1: '9' }],
      [null],
    ]
  ) {
    assertEquals(
      (await e.handler(post(R_GUA, montaje(montajes as Record<string, unknown>[]), { token: T }))).status,
      400,
    );
  }
  assertEquals(e.llamadas.guardar, 0);
});

Deno.test('límites: patente obligatoria, numero vacío, montajes 1..40, cuerpo <= 64 KB', async () => {
  const e = crearEntorno();
  const ok = { posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 };
  const casos: unknown[] = [
    { numero: '', montajes: [ok] },
    { patente: '   ', numero: '', montajes: [ok] },
    { patente: 'AB', numero: '', montajes: [ok] },
    { patente: 'AB CD$1', numero: '', montajes: [ok] },
    { patente: 'ABCD12', numero: '123', montajes: [ok] },
    { patente: 'ABCD12', montajes: [ok] },
    { patente: 'ABCD12', numero: '', montajes: [] },
    { patente: 'ABCD12', numero: '', montajes: Array.from({ length: 41 }, (_, i) => ({ ...ok, posicion: i + 1 })) },
    { patente: 'ABCD12', numero: '', montajes: 'x' },
  ];
  for (const c of casos) assertEquals((await e.handler(post(R_GUA, c, { token: T }))).status, 400);
  const grande = await e.handler(
    post(R_GUA, { patente: 'ABCD12', numero: '', montajes: [ok], relleno: 'x'.repeat(70_000) }, { token: T }),
  );
  assertEquals(grande.status, 400);
  assertEquals((await e.handler(post(R_GUA, null, { token: T, raw: '{"patente":' }))).status, 400);
  // 40 montajes exactos es válido
  const cuarenta = await e.handler(
    post(R_GUA, montaje(Array.from({ length: 40 }, (_, i) => ({ ...ok, posicion: i + 1 }))), { token: T }),
  );
  assertEquals((await j(cuarenta)).data.guardados.length, 40);
});

Deno.test('AISLAMIENTO: guardar sobre vehículo de otro cliente == inexistente, sin escrituras', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const cuerpo = (p: string) => montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }], p);
  const ajeno = await e.handler(post(R_GUA, cuerpo('ZZZZ99'), { token: T }));
  const nada = await e.handler(post(R_GUA, cuerpo('NOEXISTE1'), { token: T }));
  assertEquals(ajeno.status, nada.status);
  assertEquals(await j(ajeno), await j(nada));
  assertEquals(e.mediciones.length, antes);
  // posición que no está en el montaje visible del vehículo (sin idneumatico): falla solo esa
  const r = await j(
    await e.handler(post(R_GUA, montaje([{ posicion: 3, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }]), { token: T })),
  );
  assertEquals(r.data.guardados, [{ posicion: 3, guardado: false }]);
  assertEquals(e.mediciones.length, antes);
});

Deno.test('el cuerpo no puede elegir cliente_id', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const r = await j(
    await e.handler(post(R_GUA, {
      ...montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }], 'ZZZZ99'),
      cliente_id: 2,
    }, { token: T })),
  );
  assertEquals(r.data.guardados[0].guardado, false);
  assertEquals(e.mediciones.length, antes);
});

Deno.test('idempotencia: misma Idempotency-Key -> misma respuesta, sin doble escritura', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const cuerpo = montaje([{ posicion: 1, mm1: 9, mm2: 8, mm3: 8, mm4: 7 }]);
  const h = { 'idempotency-key': 'abc-123' };
  const a = await j(await e.handler(post(R_GUA, cuerpo, { token: T, headers: h })));
  const b = await j(await e.handler(post(R_GUA, cuerpo, { token: T, headers: h })));
  assertEquals(a, b);
  assertEquals(e.mediciones.length, antes + 1);
  // misma clave con otro contenido -> 409
  const c = await e.handler(
    post(R_GUA, montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }]), { token: T, headers: h }),
  );
  assertEquals(c.status, 409);
  // clave inválida -> 400
  const d = await e.handler(post(R_GUA, cuerpo, { token: T, headers: { 'idempotency-key': 'con espacio' } }));
  assertEquals(d.status, 400);
});

Deno.test('idempotencia sin cabecera: hash del contenido (independiente del orden)', async () => {
  const e = crearEntorno();
  const antes = e.mediciones.length;
  const m1 = { posicion: 1, mm1: 9, mm2: 8, mm3: 8, mm4: 7 };
  const m2 = { posicion: 2, mm1: 6, mm2: 5, mm3: 5, mm4: 4 };
  await e.handler(post(R_GUA, montaje([m1, m2]), { token: T }));
  const rep = await e.handler(post(R_GUA, montaje([m2, m1]), { token: T }));
  assertEquals(rep.status, 200);
  assertEquals(e.mediciones.length, antes + 2);
  // contenido distinto sí se guarda
  await e.handler(post(R_GUA, montaje([{ ...m1, mm1: 8 }]), { token: T }));
  assertEquals(e.mediciones.length, antes + 3);
});

Deno.test('rate limit por cuenta -> 429 con Retry-After; otra cuenta no se afecta', async () => {
  const e = crearEntorno();
  e.estado.limite = 2;
  const q = () => e.handler(post(R_OBT, { matricula: 'ABCD12', numero: '' }, { token: T }));
  assertEquals((await q()).status, 200);
  assertEquals((await q()).status, 200);
  const r = await q();
  assertEquals(r.status, 429);
  assertEquals(r.headers.get('retry-after'), '60');
  assertEquals((await j(r)).code, 429);
  assertEquals(
    (await e.handler(post(R_OBT, { matricula: 'ZZZZ99', numero: '' }, { token: 'tok-' + U_OTRO }))).status,
    200,
  );
});

Deno.test('fallo interno -> 500 sin detalles; el log registra error', async () => {
  const e = crearEntorno();
  e.estado.fallaGuardar = true;
  const r = await e.handler(post(R_GUA, montaje([{ posicion: 1, mm1: 1, mm2: 1, mm3: 1, mm4: 1 }]), { token: T }));
  assertEquals(r.status, 500);
  assertEquals(await j(r), { code: 500, message: 'Error interno' });
  assertEquals(e.logs.at(-1)!.status, 'error');
});

Deno.test('logs: un registro por request a 2 y 3, sin secretos; X-Request-Id coincide; fallo de log no rompe', async () => {
  const e = crearEntorno();
  const r1 = await e.handler(post(R_OBT, { matricula: 'ABCD12', numero: '' }, { token: T }));
  const r2 = await e.handler(post(
    R_GUA,
    montaje([
      { posicion: 1, mm1: 9, mm2: 8, mm3: 8, mm4: 7 },
      { posicion: 2, mm1: 9, mm2: 8, mm3: 1, mm4: 7 },
    ]),
    { token: T },
  ));
  assertEquals(e.logs.length, 2);
  const [l1, l2] = e.logs;
  assertEquals(l1.request_id, r1.headers.get('x-request-id'));
  assertEquals([l1.endpoint, l1.cuenta, l1.cliente_id, l1.vehiculo_id, l1.status, l1.http_code], [
    'obtener_montaje',
    U_DAC,
    1,
    10,
    'ok',
    200,
  ]);
  assertEquals(l2.request_id, r2.headers.get('x-request-id'));
  assertEquals([l2.endpoint, l2.n_guardados, l2.n_fallidos, l2.device_id, l2.motivo], [
    'guardar_montaje_mm',
    1,
    1,
    'api:' + U_DAC,
    'fallo_parcial',
  ]);
  const texto = JSON.stringify(e.logs);
  assertFalse(texto.includes('tok-'));
  assertFalse(texto.includes('clave-dac'));
  assertFalse(texto.includes('mm1'));
  e.estado.fallaLog = true;
  assertEquals((await e.handler(post(R_OBT, { matricula: 'ABCD12', numero: '' }, { token: T }))).status, 200);
});

Deno.test('vehículo ajeno se registra como rechazado en el log', async () => {
  const e = crearEntorno();
  await e.handler(post(R_OBT, { matricula: 'ZZZZ99', numero: '' }, { token: T }));
  assertEquals(e.logs.at(-1)!.status, 'rechazado');
  assertEquals(e.logs.at(-1)!.vehiculo_id, null);
});
