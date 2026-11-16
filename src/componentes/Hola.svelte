<script>
  // Isla de humo: prueba el build, Tailwind, el alias @domain y el contrato `ctx` (lee una vista con el JWT del rol, sin escribir).
  // No es una pantalla del producto.
  import { onMount } from 'svelte';
  import { fmtNum } from '@domain/formato.js';
  let { ctx } = $props();

  let alertas = $state(null); // null = cargando; número = filas que la base deja ver a este rol
  let fallo = $state(false);

  onMount(() => {
    let vigente = true; // la isla puede desmontarse antes de que responda la consulta
    ctx.db.from('v_alertas').select('*', { count: 'exact', head: true }).then(({ count, error }) => {
      if (!vigente) return;
      if (error) fallo = true; else alertas = count ?? 0;
    });
    return () => { vigente = false; };
  });
</script>

<div class="neumet-isla tw:p-4 tw:text-sm" data-isla="hola">
  <p>Isla de prueba. Rol: {ctx.rol}. Formato de dominio: {fmtNum(1234.5, 1)}</p>
  <p data-alertas>
    {#if fallo}Sin lectura de alertas{:else if alertas === null}Cargando…{:else}Alertas visibles: {alertas}{/if}
  </p>
</div>
