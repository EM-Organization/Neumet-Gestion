<script>
  // Isla de humo: prueba el build, Tailwind y el alias @domain. No es una pantalla del producto.
  import { fmtNum } from '@domain/formato.js';
  let { ctx } = $props();
</script>

<div class="neumet-isla p-4 text-sm" data-isla="hola">
  <p>Isla de prueba. Rol: {ctx.rol}. Formato de dominio: {fmtNum(1234.5, 1)}</p>
</div>
