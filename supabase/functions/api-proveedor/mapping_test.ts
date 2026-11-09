import { assertEquals } from 'jsr:@std/assert@1';
import {
  aColumnasBd,
  aLecturaApi,
  convertir32avos,
  ESCRITURA_FUENTE,
  LECTURA_MAP,
  MM_POR_32AVO,
  normalizarUnidad,
} from './mapping.ts';

Deno.test('convertir32avos: 1/32" = 0,79375 mm, redondeo a 2 decimales (igual que convertir_32avos_a_mm + numeric(5,2))', () => {
  assertEquals(MM_POR_32AVO, 0.79375);
  assertEquals(convertir32avos(1, 5), 0.79375);
  assertEquals(convertir32avos(1), 0.79);
  assertEquals(convertir32avos(32), 25.4);
  assertEquals(convertir32avos(12), 9.53); // 9,525 -> mitad hacia arriba, como round() de numeric
  assertEquals(convertir32avos(11), 8.73);
  assertEquals(convertir32avos(0), 0); // 0 medido es 0
  assertEquals(convertir32avos(12, 3), 9.525);
});

Deno.test('convertir32avos: dato ausente o no numérico es null, nunca 0', () => {
  for (const v of [null, undefined, Number.NaN, Infinity, -Infinity]) assertEquals(convertir32avos(v), null, String(v));
  assertEquals(convertir32avos('12' as unknown as number), null);
});

Deno.test('normalizarUnidad: mm no cambia nada; 32avos convierte y conserva el valor crudo', () => {
  assertEquals(normalizarUnidad({ mm1: 9, mm2: 8, mm3: 7 }, 'mm'), {
    cols: { mm1: 9, mm2: 8, mm3: 7 },
    unidad_origen: 'mm',
    valor_original: null,
  });
  assertEquals(normalizarUnidad({ mm1: 12, mm2: 11, mm3: null }, '32avos'), {
    cols: { mm1: 9.53, mm2: 8.73, mm3: null },
    unidad_origen: '32avos',
    valor_original: { mm1: 12, mm2: 11, mm3: null },
  });
});

Deno.test('32avos -> mm queda exacto a 5 decimales para enteros de 0 a 32', () => {
  for (let n = 0; n <= 32; n++) {
    assertEquals(Math.abs(convertir32avos(n, 5)! - n * 0.79375) < 1e-9, true, String(n));
  }
});

Deno.test('LECTURA_MAP fija el mapeo (docs/07 §3.1; orden físico NO confirmado)', () => {
  assertEquals(LECTURA_MAP, { mm1: 'mm1', mm2: 'mm2', mm3: 'mm2', mm4: 'mm3' });
  assertEquals(ESCRITURA_FUENTE, { mm1: 'mm1', mm2: 'mm2', mm3: 'mm4' });
});

Deno.test('lectura BD -> API: mm3 es copia de mm2 y mm4 sale de la columna mm3', () => {
  assertEquals(aLecturaApi({ mm1: 9, mm2: 8, mm3: 7 }), { mm1: 9, mm2: 8, mm3: 8, mm4: 7 });
  assertEquals(aLecturaApi({}), { mm1: null, mm2: null, mm3: null, mm4: null });
});

Deno.test('escritura API -> BD: mm1->mm1, mm2->mm2, mm4->mm3', () => {
  assertEquals(aColumnasBd({ mm1: 9, mm2: 8, mm3: 8, mm4: 7 }), { ok: true, cols: { mm1: 9, mm2: 8, mm3: 7 } });
});

Deno.test('escritura: mm3 distinto de mm2 se rechaza', () => {
  assertEquals(aColumnasBd({ mm1: 9, mm2: 8, mm3: 6, mm4: 7 }), { ok: false, motivo: 'duplicado_distinto' });
});

Deno.test('ida y vuelta conserva los valores', () => {
  const api = { mm1: 10.5, mm2: 6, mm3: 6, mm4: 3.25 };
  const w = aColumnasBd(api);
  if (!w.ok) throw new Error('debía ser válido');
  assertEquals(aLecturaApi(w.cols), api);
});
