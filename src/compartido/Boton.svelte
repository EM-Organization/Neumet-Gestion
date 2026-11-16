<script>
  // Botón único del sistema de diseño (docs/19 §3.1). Tres variantes; ninguna es roja: el rojo se reserva a lo crítico (docs/14 §1.7).
  // `cargando` bloquea el doble envío y lo comunica con texto («Procesando…»), no solo con un efecto visual.
  let {
    variante = 'primario', // 'primario' | 'secundario' | 'fantasma'
    tipo = 'button',
    deshabilitado = false,
    cargando = false,
    textoCargando = 'Procesando…',
    onclick = undefined,
    children,
    ...resto
  } = $props();

  const base = 'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-[9px] tw:px-4 tw:min-h-10 tw:text-sm tw:font-medium tw:cursor-pointer tw:transition-colors tw:border tw:border-transparent tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent-dark)] tw:disabled:opacity-50 tw:disabled:cursor-not-allowed';
  const variantes = {
    primario: 'tw:bg-[var(--accent-dark)] tw:text-white tw:hover:bg-[var(--accent-dark-hover)]',
    secundario: 'tw:bg-[var(--surface)] tw:text-[var(--text-primary)] tw:border-[var(--border-strong)] tw:hover:bg-[var(--surface-2)]',
    fantasma: 'tw:bg-transparent tw:text-[var(--text-primary)] tw:hover:bg-[var(--surface-2)]',
  };
</script>

<button
  type={tipo}
  class="{base} {variantes[variante] ?? variantes.primario}"
  disabled={deshabilitado || cargando}
  aria-busy={cargando ? 'true' : undefined}
  {onclick}
  {...resto}
>
  {#if cargando}{textoCargando}{:else}{@render children?.()}{/if}
</button>
