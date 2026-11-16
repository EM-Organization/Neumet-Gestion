<script>
  // Insignia de estado: SIEMPRE símbolo y texto, nunca solo color (docs/14 §1.7). Rojo solo para `critico`.
  let { tono = 'neutro', texto } = $props(); // tono: 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'

  const tonos = {
    ok: { simbolo: '✓', clase: 'tw:bg-[var(--success-bg)] tw:text-[var(--success)]' },
    atencion: { simbolo: '!', clase: 'tw:bg-[var(--warning-bg)] tw:text-[var(--warning)]' },
    critico: { simbolo: '▲', clase: 'tw:bg-[var(--danger-bg)] tw:text-[var(--danger)]' },
    info: { simbolo: 'i', clase: 'tw:bg-[var(--accent-light)] tw:text-[var(--accent-dark)]' },
    neutro: { simbolo: '•', clase: 'tw:bg-[rgba(56,52,36,0.07)] tw:text-[var(--text-secondary)]' },
  };
  const t = $derived(tonos[tono] ?? tonos.neutro);
</script>

<span class="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:px-[9px] tw:py-0.5 tw:text-xs tw:font-medium {t.clase}" data-tono={tono}>
  <span aria-hidden="true">{t.simbolo}</span>{texto}
</span>
