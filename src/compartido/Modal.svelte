<script module>
  // Pila de modales abiertos: con varios apilados, solo el de arriba atiende Escape y Tab (igual que core/modal-a11y.js).
  const pila = [];
  const FOCALIZABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
</script>

<script>
  // Modal accesible, equivalente a core/modal-a11y.js: role dialog (alertdialog para confirmaciones), aria-modal, nombre por el título,
  // foco inicial en el primer control fuera del pie, foco atrapado con Tab, Escape y clic en el fondo para cerrar, y retorno del foco
  // al elemento que lo abrió.
  import { tick } from 'svelte';

  let { abierto = $bindable(false), titulo, alerta = false, cerrarConFondo = true, alCerrar = undefined, children, pie } = $props();
  const id = $props.id();

  let dialogo = $state(null);
  const entrada = {}; // identidad de este modal dentro de la pila

  const focalizables = () => [...dialogo.querySelectorAll(FOCALIZABLE)].filter((el) => !el.closest('[hidden]'));

  function cerrar() {
    abierto = false;
    alCerrar?.();
  }

  $effect(() => {
    if (!abierto) return;
    const previo = document.activeElement;
    pila.push(entrada);
    tick().then(() => {
      if (!dialogo) return;
      const items = focalizables();
      (items.find((el) => !el.closest('[data-modal-pie]')) ?? items[0] ?? dialogo).focus();
    });
    return () => {
      pila.splice(pila.indexOf(entrada), 1);
      if (previo?.isConnected && typeof previo.focus === 'function') previo.focus();
    };
  });

  function alTeclear(e) {
    if (!abierto || pila[pila.length - 1] !== entrada || !dialogo) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const items = focalizables();
    if (!items.length) { e.preventDefault(); dialogo.focus(); return; }
    const primero = items[0], ultimo = items[items.length - 1], activo = document.activeElement;
    if (e.shiftKey && (activo === primero || !dialogo.contains(activo))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (activo === ultimo || !dialogo.contains(activo))) { e.preventDefault(); primero.focus(); }
  }

  function alFondo(e) {
    if (cerrarConFondo && !alerta && e.target === e.currentTarget) cerrar();
  }
</script>

<svelte:document onkeydown={alTeclear} />

{#if abierto}
  <div class="tw:fixed tw:inset-0 tw:z-[300] tw:flex tw:items-center tw:justify-center tw:bg-black/40 tw:p-4" role="presentation" onclick={alFondo}>
    <div
      bind:this={dialogo}
      class="tw:flex tw:max-h-full tw:w-full tw:max-w-lg tw:flex-col tw:gap-4 tw:overflow-y-auto tw:rounded-2xl tw:bg-[var(--surface)] tw:p-5 tw:shadow-xl"
      role={alerta ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby="{id}-titulo"
      tabindex="-1"
    >
      <h2 id="{id}-titulo" class="tw:text-lg tw:font-semibold tw:text-[var(--text-primary)]">{titulo}</h2>
      <div>{@render children?.()}</div>
      {#if pie}<div class="tw:flex tw:justify-end tw:gap-2" data-modal-pie>{@render pie()}</div>{/if}
    </div>
  </div>
{/if}
