<script>
  // Selector de rango de meses con dos <select> nativos («Desde» y «Hasta»). Se eligió el select nativo y no <input type="month">:
  // este último no existe en Safari de escritorio, y el select se maneja con teclado, lector de pantalla y móvil sin código propio.
  // Componente controlado: el padre guarda el rango y recibe `alCambiar({ desde, hasta })` ya con desde <= hasta.
  // `opciones` son las claves ordenables como texto ('2026-03-01'); `etiqueta` las convierte a texto visible.
  let { opciones, desde, hasta, etiqueta = (k) => k, alCambiar, deshabilitado = false } = $props();

  const asc = $derived([...opciones].sort());
  const claseSelect = 'tw:min-h-10 tw:rounded-[9px] tw:border tw:border-[var(--border-strong)] tw:bg-[var(--surface)] tw:px-3 tw:text-sm tw:text-[var(--text-primary)] tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent-dark)] tw:disabled:opacity-50';

  function cambiar(cual, valor) {
    let nuevo = { desde, hasta, [cual]: valor };
    // El que se movió manda: el otro extremo se arrastra para que el rango nunca quede invertido.
    if (nuevo.desde > nuevo.hasta) nuevo = { desde: valor, hasta: valor };
    alCambiar?.(nuevo);
  }
</script>

<div class="tw:flex tw:flex-wrap tw:items-end tw:gap-3" role="group" aria-label="Rango de meses">
  <label class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-[var(--text-secondary)]">
    Desde
    <select class={claseSelect} value={desde} disabled={deshabilitado} onchange={(e) => cambiar('desde', e.currentTarget.value)}>
      {#each asc as k (k)}<option value={k} selected={k === desde}>{etiqueta(k)}</option>{/each}
    </select>
  </label>
  <label class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-[var(--text-secondary)]">
    Hasta
    <select class={claseSelect} value={hasta} disabled={deshabilitado} onchange={(e) => cambiar('hasta', e.currentTarget.value)}>
      {#each asc as k (k)}<option value={k} selected={k === hasta}>{etiqueta(k)}</option>{/each}
    </select>
  </label>
</div>
