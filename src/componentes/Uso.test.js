// Pantalla «Uso»: estados (cargando, vacío, 42501, error, éxito), filtros, móvil y accesibilidad, con un ctx.db simulado.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Uso from './Uso.svelte';

const AHORA = new Date('2026-11-16T10:00:00Z'); // último mes cerrado: octubre de 2026; en curso: noviembre
const montados = [];
afterEach(() => {
  while (montados.length) unmount(montados.pop());
  document.body.innerHTML = '';
  delete globalThis.matchMedia;
  vi.restoreAllMocks();
});

const espera = async () => { await tick(); await new Promise((ok) => setTimeout(ok, 0)); await tick(); };

const REGISTRO = {
  cliente_id: 7, cliente_nombre: 'Transportes Alfa', mes: '2026-10-01', api_llamadas: 1234, api_por_endpoint: {}, logins: 5, mediciones: 40,
  vehiculos_activos: 10, dispositivos_activos: 2, usuarios: 3, ultimo_ingreso_at: '2026-10-31T23:59:00Z', cerrado_at: '2026-11-01T00:05:00Z',
};

// `respuestas`: una por llamada a la RPC, en orden; cada una es un valor {data,error} o una función que devuelve una promesa.
function crearCtx({ respuestas = [{ data: [REGISTRO], error: null }], clientes = [{ id: 7, nombre: 'Transportes Alfa' }, { id: 9, nombre: 'Beta' }] } = {}) {
  const llamadas = [];
  const tablas = [];
  let i = 0;
  const db = {
    rpc: (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = respuestas[Math.min(i++, respuestas.length - 1)];
      return typeof r === 'function' ? r() : Promise.resolve(r);
    },
    from: (tabla) => {
      tablas.push(tabla);
      return { select: () => ({ order: () => Promise.resolve({ data: clientes, error: null }) }) };
    },
  };
  return { ctx: { api: 1, rol: 'admin', db }, llamadas, tablas };
}

async function montar(opciones) {
  const c = crearCtx(opciones);
  const target = document.body.appendChild(document.createElement('div'));
  const inst = mount(Uso, { target, props: { ctx: c.ctx, ahora: () => AHORA } });
  montados.push(inst);
  await espera();
  return { target, ...c };
}
const cambiar = async (select, valor) => { select.value = valor; select.dispatchEvent(new Event('change', { bubbles: true })); await espera(); };
const selectDe = (target, etiqueta) => [...target.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(etiqueta)).querySelector('select');

describe('Uso: éxito', () => {
  it('pide el rango por defecto (12 meses cerrados) a la RPC y pinta la fila con sus métricas', async () => {
    const { target, llamadas } = await montar();
    expect(llamadas).toEqual([{ nombre: 'uso_clientes_listar', args: { p_desde: '2025-11-01', p_hasta: '2026-10-01', p_cliente_id: null } }]);
    const celdas = [...target.querySelectorAll('tbody tr td')].map((td) => td.textContent);
    expect(celdas).toEqual(['octubre de 2026', 'Transportes Alfa', '1.234', '5', '40', '10', '2', '3', '31/10/2026']);
    expect([...target.querySelectorAll('th')].map((th) => th.textContent)).toEqual(
      ['Mes', 'Cliente', 'Llamadas API', 'Inicios de sesión de API', 'Mediciones', 'Vehículos', 'Dispositivos', 'Usuarios', 'Último ingreso al panel']);
    expect(target.textContent).toContain('1 registro');
  });

  it('solo usa la RPC para el uso y lee la lista de clientes de la tabla clientes: nunca uso_cliente_mensual ni escribe', async () => {
    const { tablas, llamadas } = await montar();
    expect(tablas).toEqual(['clientes']);
    expect(llamadas.every((l) => l.nombre === 'uso_clientes_listar')).toBe(true);
  });

  it('el mes en curso no se ofrece y se declara como sin cerrar; los meses son UTC', async () => {
    const { target } = await montar();
    const opciones = [...selectDe(target, 'Mes').options].map((o) => o.textContent);
    expect(opciones).not.toContain('noviembre de 2026');
    expect(opciones.slice(0, 2)).toEqual(['Últimos 12 meses', 'octubre de 2026']);
    expect(target.textContent).toContain('En curso: noviembre de 2026, sin cerrar');
    expect(target.textContent).toContain('UTC');
    expect(target.textContent).toContain('Llamadas API no incluye logins');
  });

  it('un valor con HTML se muestra como texto', async () => {
    const { target } = await montar({ respuestas: [{ data: [{ ...REGISTRO, cliente_nombre: '<img src=x onerror=alert(1)>' }], error: null }] });
    expect(target.querySelector('tbody img')).toBeNull();
    expect(target.querySelector('tbody td:nth-child(2)').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('sin último ingreso dice «Sin ingresos»', async () => {
    const { target } = await montar({ respuestas: [{ data: [{ ...REGISTRO, ultimo_ingreso_at: null }], error: null }] });
    expect(target.querySelector('tbody td:last-child').textContent).toBe('Sin ingresos');
  });
});

describe('Uso: estados', () => {
  it('cargando: avisa con texto mientras la RPC no responde', async () => {
    let resolver;
    const { target } = await montar({ respuestas: [() => new Promise((ok) => { resolver = ok; })] });
    expect(target.querySelector('[role="status"]').textContent).toContain('Cargando uso…');
    expect(target.querySelector('table')).toBeNull();
    resolver({ data: [REGISTRO], error: null });
    await espera();
    expect(target.textContent).not.toContain('Cargando uso…');
    expect(target.querySelector('table')).not.toBeNull();
  });

  it('vacío: dice qué pasa y qué hacer, sin tabla', async () => {
    const { target } = await montar({ respuestas: [{ data: [], error: null }] });
    expect(target.querySelector('table')).toBeNull();
    expect(target.textContent).toContain('Sin meses cerrados en este rango');
    expect(target.textContent).toContain('Elegir otro rango de meses');
    expect(target.textContent).toContain('0 registros');
  });

  it('42501: «Sin permiso» y ningún control ni dato; no expone el mensaje del servidor ni hace console.error', async () => {
    const error = vi.spyOn(console, 'error');
    const { target } = await montar({ respuestas: [{ data: null, error: { code: '42501', message: 'no autorizado', details: 'tabla secreta' } }] });
    expect(target.textContent).toContain('Sin permiso');
    expect(target.textContent).toContain('solo para el equipo Neumet');
    expect(target.querySelector('select')).toBeNull();
    expect(target.querySelector('table')).toBeNull();
    expect(target.textContent).not.toContain('tabla secreta');
    expect(error).not.toHaveBeenCalled();
  });

  it('error genérico: alerta con texto «Error:» y Reintentar vuelve a pedir y se recupera', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { target, llamadas } = await montar({ respuestas: [{ data: null, error: { code: 'XX000', message: 'boom interno' } }, { data: [REGISTRO], error: null }] });
    const alerta = target.querySelector('[role="alert"]');
    expect(alerta.textContent).toContain('Error:');
    expect(alerta.textContent).not.toContain('boom interno');
    alerta.querySelector('button').click();
    await espera();
    expect(llamadas).toHaveLength(2);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('móvil: la tabla pasa a tarjetas con pares etiqueta y valor', async () => {
    globalThis.matchMedia = (q) => ({ matches: q === '(max-width: 767px)', addEventListener() {}, removeEventListener() {} });
    const { target } = await montar();
    expect(target.querySelector('table')).toBeNull();
    const tarjeta = target.querySelector('ul[aria-label="Uso mensual por cliente"] li');
    expect([...tarjeta.querySelectorAll('dt')].map((x) => x.textContent)).toContain('Llamadas API');
    expect([...tarjeta.querySelectorAll('dd')].map((x) => x.textContent)).toContain('1.234');
  });
});

describe('Uso: filtros', () => {
  it('filtrar por cliente vuelve a pedir con p_cliente_id numérico; «Todos» lo devuelve a null', async () => {
    const { target, llamadas } = await montar();
    const sel = selectDe(target, 'Cliente');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Todos los clientes', 'Transportes Alfa', 'Beta']);
    await cambiar(sel, '9');
    expect(llamadas.at(-1).args.p_cliente_id).toBe(9);
    await cambiar(sel, '');
    expect(llamadas.at(-1).args.p_cliente_id).toBeNull();
  });

  it('hay un solo selector «Mes» (sin «Desde» ni «Hasta») y arranca en «Últimos 12 meses»', async () => {
    const { target } = await montar();
    const etiquetas = [...target.querySelectorAll('label')].map((l) => l.firstChild.textContent.trim());
    expect(etiquetas).toEqual(['Mes', 'Cliente']);
    expect(target.querySelector('[role="group"]')).toBeNull();
    expect(selectDe(target, 'Mes').value).toBe('ultimos');
    expect(selectDe(target, 'Mes').selectedOptions[0].textContent).toBe('Últimos 12 meses');
  });

  it('elegir un mes pide ese mes solo y volver a «Últimos 12 meses» pide el rango completo', async () => {
    const { target, llamadas } = await montar();
    await cambiar(selectDe(target, 'Mes'), '2026-03-01');
    expect(llamadas.at(-1).args).toMatchObject({ p_desde: '2026-03-01', p_hasta: '2026-03-01' });
    expect(llamadas).toHaveLength(2); // un solo cambio, una sola consulta
    await cambiar(selectDe(target, 'Mes'), 'ultimos');
    expect(llamadas.at(-1).args).toMatchObject({ p_desde: '2025-11-01', p_hasta: '2026-10-01' });
  });

  it('una respuesta vieja no pisa a una más nueva', async () => {
    let resolverVieja;
    const { target } = await montar({
      respuestas: [
        { data: [REGISTRO], error: null },
        () => new Promise((ok) => { resolverVieja = ok; }),
        { data: [{ ...REGISTRO, cliente_nombre: 'Beta', cliente_id: 9 }], error: null },
      ],
    });
    const sel = selectDe(target, 'Cliente');
    await cambiar(sel, '7'); // queda pendiente
    await cambiar(sel, '9'); // responde primero
    resolverVieja({ data: [{ ...REGISTRO, cliente_nombre: 'Vieja' }], error: null });
    await espera();
    expect(target.querySelector('tbody td:nth-child(2)').textContent).toBe('Beta');
  });

  it('si la lista de clientes falla, el filtro queda en «Todos» y la tabla funciona', async () => {
    const c = crearCtx();
    c.ctx.db.from = () => ({ select: () => ({ order: () => Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }) }) });
    const target = document.body.appendChild(document.createElement('div'));
    montados.push(mount(Uso, { target, props: { ctx: c.ctx, ahora: () => AHORA } }));
    await espera();
    expect([...selectDe(target, 'Cliente').options].map((o) => o.textContent)).toEqual(['Todos los clientes']);
    expect(target.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('desmontar con una consulta pendiente no escribe en el DOM ni lanza', async () => {
    let resolver;
    const c = crearCtx({ respuestas: [() => new Promise((ok) => { resolver = ok; })] });
    const target = document.body.appendChild(document.createElement('div'));
    const inst = mount(Uso, { target, props: { ctx: c.ctx, ahora: () => AHORA } });
    await espera();
    unmount(inst);
    resolver({ data: [REGISTRO], error: null });
    await espera();
    expect(target.innerHTML).toBe('');
  });
});

describe('Uso: accesibilidad y teclado', () => {
  it('cada control tiene etiqueta visible y hay un solo h2', async () => {
    const { target } = await montar();
    for (const t of ['Mes', 'Cliente']) expect(selectDe(target, t).closest('label').textContent).toContain(t);
    expect(target.querySelectorAll('h2')).toHaveLength(1);
    expect(target.querySelector('table caption').textContent).toBe('Uso mensual por cliente');
    expect(target.querySelectorAll('th[scope="col"]')).toHaveLength(9);
  });

  it('el foco queda en el control tras filtrar (la pantalla no deshabilita ni reemplaza los selectores)', async () => {
    const { target } = await montar();
    const sel = selectDe(target, 'Cliente');
    sel.focus();
    await cambiar(sel, '9');
    expect(document.activeElement).toBe(sel);
    expect(sel.disabled).toBe(false);
  });

  it('no usa solo color: el aviso del mes en curso lleva símbolo y texto', async () => {
    const { target } = await montar();
    const insignia = target.querySelector('[data-tono="info"]');
    expect(insignia.querySelector('[aria-hidden="true"]').textContent).toBe('i');
    expect(insignia.textContent).toContain('sin cerrar');
  });
});
