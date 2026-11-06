import { assertEquals } from 'jsr:@std/assert@1';
import { aColumnasBd, aLecturaApi, ESCRITURA_FUENTE, LECTURA_MAP } from './mapping.ts';

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
