<script>
  // Tabla única del sistema de diseño: en ancho de escritorio es una <table> con encabezados; bajo 768 px (el único punto de corte,
  // docs/19 §3.1) pasa a una lista de tarjetas. Se cambia el marcado y no solo el CSS: forzar `display:block` sobre filas y celdas
  // le quita la semántica de tabla a los lectores de pantalla, y una lista de pares etiqueta/valor la conserva.
  import { onMount } from 'svelte';
  import EstadoVacio from './EstadoVacio.svelte';

  // columnas: [{ clave, etiqueta, alinear?: 'der' }]; filas: objetos planos; `celda` (opcional) pinta una celda con marcado propio.
  let { columnas, filas, leyenda, clave = (f, i) => f.id ?? i, vacio = { titulo: 'Sin registros' }, celda } = $props();

  let estrecho = $state(false);
  onMount(() => {
    const mq = globalThis.matchMedia?.('(max-width: 767px)');
    if (!mq) return;
    estrecho = mq.matches;
    const alCambiar = (e) => { estrecho = e.matches; };
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  });

  const valor = (fila, col) => fila[col.clave] ?? '';
</script>

{#if filas.length === 0}
  <EstadoVacio titulo={vacio.titulo} detalle={vacio.detalle ?? ''} />
{:else if estrecho}
  <ul class="tw:flex tw:flex-col tw:gap-3" aria-label={leyenda}>
    {#each filas as fila, i (clave(fila, i))}
      <li class="tw:rounded-xl tw:border tw:border-[var(--border)] tw:bg-[var(--surface)] tw:p-3">
        <dl class="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-sm">
          {#each columnas as col (col.clave)}
            <dt class="tw:text-[var(--text-secondary)]">{col.etiqueta}</dt>
            <dd class="tw:text-[var(--text-primary)]">{#if celda}{@render celda(fila, col)}{:else}{valor(fila, col)}{/if}</dd>
          {/each}
        </dl>
      </li>
    {/each}
  </ul>
{:else}
  <div class="tw:overflow-x-auto">
    <table class="tw:w-full tw:border-collapse tw:text-sm">
      {#if leyenda}<caption class="tw:sr-only">{leyenda}</caption>{/if}
      <thead>
        <tr>
          {#each columnas as col (col.clave)}
            <th scope="col" class="tw:px-3 tw:py-2 tw:text-left tw:text-xs tw:font-medium tw:uppercase tw:tracking-wide tw:text-[var(--text-tertiary)] {col.alinear === 'der' ? 'tw:text-right' : ''}">{col.etiqueta}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each filas as fila, i (clave(fila, i))}
          <tr class="tw:border-t tw:border-[var(--border)]">
            {#each columnas as col (col.clave)}
              <td class="tw:px-3 tw:py-2 tw:text-[var(--text-primary)] {col.alinear === 'der' ? 'tw:text-right' : ''}">{#if celda}{@render celda(fila, col)}{:else}{valor(fila, col)}{/if}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
