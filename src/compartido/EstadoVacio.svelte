<script>
  // Estado vacío (docs/14 §1.6): dice qué pasa y, si hay una acción posible, la ofrece. Región `status`: se anuncia al aparecer.
  let { titulo, detalle = '', accion } = $props();
</script>

<div class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:px-4 tw:py-10 tw:text-center" role="status">
  <p class="tw:text-sm tw:font-medium tw:text-[var(--text-primary)]">{titulo}</p>
  {#if detalle}<p class="tw:text-sm tw:text-[var(--text-secondary)]">{detalle}</p>{/if}
  {#if accion}<div class="tw:mt-2">{@render accion()}</div>{/if}
</div>
