#!/usr/bin/env bash
# Mide v_estado_neumaticos, v_km_cubierta, v_costo_cubierta y cpk_por_grupo (mediana de 3 EXPLAIN ANALYZE, en ms) como rol authenticated (RLS activa) y como superusuario.
# No forma parte de la CI. Uso:
#   PERF_PG_URL=postgresql://postgres@host/base tests/perf/bench.sh etiqueta
# La base debe tener las migraciones y los datos de tests/perf/gen.sql (con el usuario administrador a0000000-...-0001
# y el cliente 1 a0000000-...-0002).
set -euo pipefail
: "${PERF_PG_URL:?PERF_PG_URL = URL de superusuario de una base con las migraciones y gen.sql aplicados}"
PS="psql $PERF_PG_URL -X -q -At"
t() { # t <auth|su> <uid> <sql>
  local pre="select 1"
  if [ "$1" = auth ]; then pre="set role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$2','role','authenticated')::text, false)"; fi
  local xs=()
  for _ in 1 2 3; do
    xs+=("$($PS -c "$pre" -c "explain (analyze, timing off) $3" | grep 'Execution Time' | sed 's/.*: //; s/ ms//')")
  done
  printf '%s\n' "${xs[@]}" | sort -n | sed -n 2p
}
CLI=a0000000-0000-0000-0000-000000000002
ADM=a0000000-0000-0000-0000-000000000001
echo "== ${1:-medicion}"
echo "estado p1 (1000 filas), authenticated cliente:  $(t auth $CLI 'select * from public.v_estado_neumaticos limit 1000')"
echo "estado p3 (offset 2000), authenticated cliente: $(t auth $CLI 'select * from public.v_estado_neumaticos offset 2000 limit 1000')"
echo "alertas p1, authenticated cliente:              $(t auth $CLI 'select * from public.v_alertas limit 1000')"
echo "estado de 1 vehiculo, authenticated cliente:    $(t auth $CLI 'select * from public.v_estado_neumaticos where vehiculo_id = 5')"
echo "estado p1, authenticated administrador:         $(t auth $ADM 'select * from public.v_estado_neumaticos limit 1000')"
echo "estado de 1 vehiculo, authenticated admin:      $(t auth $ADM 'select * from public.v_estado_neumaticos where vehiculo_id = 5')"
echo "estado cliente_id=1, superusuario:              $(t su x 'select * from public.v_estado_neumaticos where cliente_id = 1')"
echo "estado p1, superusuario:                        $(t su x 'select * from public.v_estado_neumaticos limit 1000')"
echo "estado count(*) toda la base, superusuario:     $(t su x 'select count(*) from public.v_estado_neumaticos')"
echo "v_resumen_flota_cliente, superusuario:          $(t su x 'select * from public.v_resumen_flota_cliente')"
echo "km de 1 vehiculo, authenticated cliente:       $(t auth $CLI 'select * from public.v_km_cubierta where vehiculo_id = 5')"
echo "km de 1 neumatico, authenticated cliente:      $(t auth $CLI 'select * from public.v_km_cubierta where neumatico_id = 50')"
echo "km de 1 vehiculo, authenticated admin:         $(t auth $ADM 'select * from public.v_km_cubierta where vehiculo_id = 5')"
echo "km toda la vista, authenticated cliente:       $(t auth $CLI 'select * from public.v_km_cubierta')"
echo "km toda la vista, authenticated admin:         $(t auth $ADM 'select * from public.v_km_cubierta')"
echo "-- costos y CPK (F4)"
echo "costo de 1 vehiculo, authenticated cliente:    $(t auth $CLI 'select * from public.v_costo_cubierta where vehiculo_id = 5')"
echo "costo de 1 neumatico, authenticated cliente:   $(t auth $CLI 'select * from public.v_costo_cubierta where neumatico_id = 50')"
echo "costo de 1 vehiculo, authenticated admin:      $(t auth $ADM 'select * from public.v_costo_cubierta where vehiculo_id = 5')"
echo "costo toda la vista, authenticated cliente:    $(t auth $CLI 'select * from public.v_costo_cubierta')"
echo "costo toda la vista, authenticated admin:      $(t auth $ADM 'select * from public.v_costo_cubierta')"
echo "cpk_por_grupo marca, authenticated cliente:    $(t auth $CLI "select * from public.cpk_por_grupo('marca')")"
echo "cpk_por_grupo modelo, authenticated cliente:   $(t auth $CLI "select * from public.cpk_por_grupo('modelo')")"
echo "cpk_por_grupo sucursal, authenticated cliente: $(t auth $CLI "select * from public.cpk_por_grupo('sucursal')")"
echo "cpk_por_grupo marca, authenticated admin:      $(t auth $ADM "select * from public.cpk_por_grupo('marca')")"
