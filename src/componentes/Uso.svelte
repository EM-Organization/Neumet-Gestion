<script>
  // Pantalla «Uso» (F11, piloto de la ola 1): consumo mensual por cliente, solo lectura y solo para el equipo Neumet.
  // La base decide quién ve qué: uso_clientes_listar responde 42501 a quien no es `admin` (docs/08 apéndice O); esta pantalla solo
  // traduce ese error. Lee únicamente con ctx.db a través de la capa de datos; no escribe nada.
  // Meses calendario UTC. El mes en curso no tiene fila (uso_cerrar_mes solo cierra meses terminados): se avisa en vez de mostrar
  // una cifra parcial que parecería definitiva.
  import { onMount } from 'svelte';
  import { Boton, EstadoVacio, Insignia, SelectorRango, Tabla, crearDatos } from '../compartido/index.js';
  import { COLUMNAS, etiquetaMes, filasDeUso, mesEnCurso, mesesElegibles, rangoPorDefecto } from '../uso/uso.js';

  let { ctx, ahora = () => new Date() } = $props();

  // `ctx` y `ahora` no cambian durante la vida de la isla (cada montaje recibe un ctx nuevo): se leen una vez, dentro de funciones.
  const datos = $derived(crearDatos(ctx.db));
  const meses = $derived(mesesElegibles(ahora()));
  const enCurso = $derived(mesEnCurso(ahora()));
  const rangoInicial = () => rangoPorDefecto(ahora());

  let rango = $state(rangoInicial());
  let clienteId = $state(''); // '' = todos los clientes
  let clientes = $state([]);
  // fase: 'cargando' | 'listo' | 'error'
  let estado = $state({ fase: 'cargando', filas: [], error: '', codigo: null });
  let turno = 0; // una respuesta vieja nunca pisa a una más nueva (cambios de filtro seguidos)

  async function cargar() {
    const miTurno = ++turno;
    estado = { fase: 'cargando', filas: [], error: '', codigo: null };
    const r = await datos.rpc('uso_clientes_listar', {
      p_desde: rango.desde,
      p_hasta: rango.hasta,
      p_cliente_id: clienteId === '' ? null : Number(clienteId),
    });
    if (miTurno !== turno) return;
    estado = r.error
      ? { fase: 'error', filas: [], error: r.error, codigo: r.codigo }
      : { fase: 'listo', filas: filasDeUso(r.datos), error: '', codigo: null };
  }

  onMount(() => {
    // La lista de clientes solo alimenta el filtro: si falla, el filtro queda en «Todos» y la tabla sigue funcionando.
    datos.leer((db) => db.from('clientes').select('id, nombre').order('nombre')).then((r) => { if (!r.error) clientes = r.datos ?? []; });
    cargar();
    return () => { turno++; }; // desmontada: ninguna respuesta pendiente debe escribir en el estado
  });

  const sinPermiso = $derived(estado.fase === 'error' && estado.codigo === '42501');
</script>

<div class="neumet-isla tw:flex tw:flex-col tw:gap-4" data-isla="uso">
  <h2 class="tw:text-base tw:font-semibold tw:text-[var(--text-primary)]">Uso mensual por cliente</h2>

  {#if sinPermiso}
    <EstadoVacio titulo="Sin permiso" detalle="Esta pantalla es solo para el equipo Neumet." />
  {:else}
    <div class="tw:flex tw:flex-wrap tw:items-end tw:gap-4">
      <SelectorRango
        opciones={meses}
        desde={rango.desde}
        hasta={rango.hasta}
        etiqueta={etiquetaMes}
        alCambiar={(nuevo) => { rango = nuevo; cargar(); }}
      />
      <label class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-[var(--text-secondary)]">
        Cliente
        <select
          class="tw:min-h-10 tw:rounded-[9px] tw:border tw:border-[var(--border-strong)] tw:bg-[var(--surface)] tw:px-3 tw:text-sm tw:text-[var(--text-primary)] tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[var(--accent-dark)]"
          value={clienteId}
          onchange={(e) => { clienteId = e.currentTarget.value; cargar(); }}
        >
          <option value="">Todos los clientes</option>
          {#each clientes as c (c.id)}<option value={String(c.id)}>{c.nombre}</option>{/each}
        </select>
      </label>
    </div>

    <p class="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-sm tw:text-[var(--text-secondary)]">
      <Insignia tono="info" texto="En curso: {etiquetaMes(enCurso)}, sin cerrar" />
      <span>Solo se muestran meses cerrados. Los meses son calendario UTC.</span>
    </p>

    {#if estado.fase === 'cargando'}
      <p role="status" class="tw:py-6 tw:text-center tw:text-sm tw:text-[var(--text-secondary)]">Cargando uso…</p>
    {:else if estado.fase === 'error'}
      <div role="alert" class="tw:flex tw:flex-col tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-[var(--border)] tw:bg-[var(--surface)] tw:p-4 tw:text-sm tw:text-[var(--text-primary)]">
        <p><strong>Error:</strong> {estado.error}</p>
        <Boton variante="secundario" onclick={cargar}>Reintentar</Boton>
      </div>
    {:else}
      <p role="status" class="tw:text-sm tw:text-[var(--text-secondary)]">
        {estado.filas.length === 1 ? '1 registro' : `${estado.filas.length} registros`}
      </p>
      <Tabla
        columnas={COLUMNAS}
        filas={estado.filas}
        leyenda="Uso mensual por cliente"
        vacio={{ titulo: 'Sin meses cerrados en este rango', detalle: 'Elegir otro rango de meses. El mes en curso aparece cuando se cierra.' }}
      />
      {#if estado.filas.length > 0}
        <p class="tw:text-xs tw:text-[var(--text-tertiary)]">
          Llamadas API no incluye logins, que se cuentan aparte. Vehículos, dispositivos, usuarios y último ingreso son una foto
          tomada al primer cierre de cada mes.
        </p>
      {/if}
    {/if}
  {/if}
</div>
