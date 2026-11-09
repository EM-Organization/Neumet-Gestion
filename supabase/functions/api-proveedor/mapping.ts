// Mapeo de lecturas API <-> BD (docs/07 §3.1). FUENTE ÚNICA de verdad.
//
// Orden físico CONFIRMADO (app móvil de DAC): interno, centro, externo.
// En BD: mm1=interno, mm2=centro, mm3=externo; el panel usa las mismas etiquetas.
// Si algún día hubiera que invertirlo, basta cambiar SOLO esta constante
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

// ---------------------------------------------------------------------------------------------
// Unidades (F3, docs/16): la API de proveedor hoy informa milímetros y no cambia. El modelo (mediciones.unidad_origen y
// mediciones.valor_original, migración 20261116000000) ya admite un origen que informe en 32avos de pulgada; estas
// funciones puras dejan lista la conversión para cuando exista. mm1..mm3 siempre se guardan normalizados a mm.
// ---------------------------------------------------------------------------------------------

/** 1/32 de pulgada en milímetros (25,4 / 32). Misma constante que public.convertir_32avos_a_mm. */
export const MM_POR_32AVO = 0.79375;
export type UnidadOrigen = 'mm' | '32avos';

/**
 * 32avos de pulgada -> mm, redondeado a `decimales` (2, como numeric(5,2) de la columna; mitades hacia arriba).
 * Un dato ausente o no numérico da `null`: dato no medido es nulo, nunca cero.
 */
export function convertir32avos(valor: number | null | undefined, decimales = 2): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  const f = 10 ** decimales;
  return Math.round((valor * 79375 * f) / 100000) / f;
}

export interface LecturaNormalizada {
  cols: FilaBd;
  unidad_origen: UnidadOrigen;
  /** Valor crudo tal como lo informó el origen; solo si no vino en mm (en mm el valor ya es el original). */
  valor_original: Record<string, number | null> | null;
}

/** Normaliza una lectura en la unidad del origen a las columnas en mm, conservando el valor crudo. */
export function normalizarUnidad(crudo: FilaBd, unidad: UnidadOrigen): LecturaNormalizada {
  if (unidad === 'mm') return { cols: { ...crudo }, unidad_origen: 'mm', valor_original: null };
  return {
    cols: { mm1: convertir32avos(crudo.mm1), mm2: convertir32avos(crudo.mm2), mm3: convertir32avos(crudo.mm3) },
    unidad_origen: '32avos',
    valor_original: { mm1: crudo.mm1, mm2: crudo.mm2, mm3: crudo.mm3 },
  };
}
