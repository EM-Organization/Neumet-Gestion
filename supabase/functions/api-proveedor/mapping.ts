// Mapeo de lecturas API <-> BD (docs/07 §3.1). FUENTE ÚNICA de verdad.
//
// ADVERTENCIA: el orden físico (borde interno/externo) NO está confirmado con el
// equipo de la app de DAC. El panel habla de "exterior, medio, interior" y el
// contrato de "interno, centro, externo". Un mapeo al revés intercambia ambos
// bordes SIN que nada falle. Cambiar SOLO esta constante cuando se confirme
// (y actualizar mapping_test.ts, que fija el comportamiento).

export type CampoApi = 'mm1' | 'mm2' | 'mm3' | 'mm4';
export type ColumnaBd = 'mm1' | 'mm2' | 'mm3';
export const CAMPOS_API: readonly CampoApi[] = ['mm1', 'mm2', 'mm3', 'mm4'];

/** Lectura BD -> API: cada campo del contrato sale de esta columna. mm3 (API) es copia de mm2. */
export const LECTURA_MAP: Readonly<Record<CampoApi, ColumnaBd>> = {
  mm1: 'mm1',
  mm2: 'mm2',
  mm3: 'mm2',
  mm4: 'mm3',
};

/**
 * Escritura API -> BD, derivada de LECTURA_MAP: el primer campo API que apunta a
 * una columna es su fuente (mm1->mm1, mm2->mm2, mm4->mm3); los campos API
 * restantes que apuntan a una columna ya cubierta (mm3 -> mm2) son duplicados
 * y deben ser iguales a la fuente.
 */
export const ESCRITURA_FUENTE: Readonly<Record<ColumnaBd, CampoApi>> = (() => {
  const out: Partial<Record<ColumnaBd, CampoApi>> = {};
  for (const campo of CAMPOS_API) {
    const col = LECTURA_MAP[campo];
    if (!out[col]) out[col] = campo;
  }
  return out as Record<ColumnaBd, CampoApi>;
})();

export type LecturaApi = Record<CampoApi, number | null>;
export type FilaBd = Record<ColumnaBd, number | null>;

/** BD -> API. */
export function aLecturaApi(fila: Partial<FilaBd>): LecturaApi {
  const out = {} as LecturaApi;
  for (const campo of CAMPOS_API) out[campo] = fila[LECTURA_MAP[campo]] ?? null;
  return out;
}

export type EscrituraResultado =
  | { ok: true; cols: FilaBd }
  | { ok: false; motivo: 'duplicado_distinto' };

/** API -> BD. Valida que los campos duplicados (mm3) coincidan con su fuente (mm2). */
export function aColumnasBd(v: LecturaApi): EscrituraResultado {
  const cols = { mm1: null, mm2: null, mm3: null } as FilaBd;
  for (const col of Object.keys(ESCRITURA_FUENTE) as ColumnaBd[]) cols[col] = v[ESCRITURA_FUENTE[col]];
  for (const campo of CAMPOS_API) {
    const col = LECTURA_MAP[campo];
    if (ESCRITURA_FUENTE[col] !== campo && v[campo] !== v[ESCRITURA_FUENTE[col]]) {
      return { ok: false, motivo: 'duplicado_distinto' };
    }
  }
  return { ok: true, cols };
}
