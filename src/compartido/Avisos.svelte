<script>
  // Anfitrión de avisos. Las dos regiones vivas existen siempre (un lector de pantalla solo anuncia cambios en una región que ya
  // estaba en la página): `status` (cortés) para avisos normales y `alert` (asertiva) para errores. El error lleva el texto «Error:»
  // además del símbolo: el estado no se comunica solo con color (docs/14 §1.7).
  let { avisos: cola } = $props(); // store de crearAvisos()

  const normales = $derived($cola.filter((a) => !a.error));
  const errores = $derived($cola.filter((a) => a.error));
</script>

{#snippet aviso(a)}
  <div class="tw:flex tw:items-center tw:gap-2 tw:rounded-[10px] tw:bg-[var(--text-primary)] tw:px-4 tw:py-2.5 tw:text-sm tw:text-white tw:shadow-lg {a.error ? 'tw:border-l-4 tw:border-[var(--danger)]' : ''}" data-aviso>
    <span aria-hidden="true">{a.error ? '▲' : '✓'}</span>
    <span>{#if a.error}<strong class="tw:mr-1">Error:</strong>{/if}{a.mensaje}</span>
    <button type="button" class="tw:ml-1 tw:min-h-8 tw:cursor-pointer tw:rounded tw:px-2 tw:underline" onclick={() => cola.cerrar(a.id)}>Cerrar aviso</button>
  </div>
{/snippet}

<div class="tw:fixed tw:bottom-5 tw:right-5 tw:z-[400] tw:flex tw:max-w-xs tw:flex-col tw:gap-2">
  <div role="status" aria-live="polite" class="tw:flex tw:flex-col tw:gap-2">
    {#each normales as a (a.id)}{@render aviso(a)}{/each}
  </div>
  <div role="alert" class="tw:flex tw:flex-col tw:gap-2">
    {#each errores as a (a.id)}{@render aviso(a)}{/each}
  </div>
</div>
