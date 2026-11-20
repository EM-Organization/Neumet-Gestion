# 20 · Carga inicial de un listado de neumáticos

Script único que carga el listado de neumáticos de un cliente (un `.xlsx`, una fila por cubierta) en su empresa y su sucursal. Lo ejecuta el director; el listado trae datos del cliente y **no va al repositorio** (ni en tests, ni en docs, ni en mensajes de commit: las pruebas usan un listado sintético). Sin migración.

Código: `supabase/seed/importar-carga-inicial.mjs` (CLI), `supabase/seed/lib/` (`xlsx.mjs` lector sin dependencias, `carga-inicial.mjs` mapeo puro, `sql.mjs` generador, `conexion.mjs` conexión a psql). Pruebas: `tests/unit/importar-carga-inicial.test.mjs` y `tests/sql/importar_carga_inicial.sh` (contra el Postgres desechable de `tests/sql/run.sh`).

## Cómo correrlo
Parámetros obligatorios: `--archivo <listado.xlsx> --cliente-id N --sucursal-id N --nombre-cliente "<nombre exacto>"`. El nombre es la salvaguarda: antes de escribir se verifica que el cliente se llame así y que la sucursal sea suya; sin coincidencia no se escribe nada. No hay valores por defecto para ninguno.
1. **Dry-run sin base** (solo lee el archivo): conteos y advertencias por tipo (`--detalle` las lista una a una).
2. **Dry-run con base** (solo lectura; detecta choques con vehículos existentes y revisa la restricción de bajas): igual, con la conexión en el entorno. Requiere `psql`.
3. **Carga**: lo mismo con `--ejecutar`. Una sola transacción: o entra todo o no entra nada. Reejecutarla no duplica nada (clave `idneumatico = CI-<cliente>-<código>`).
4. `--emitir-sql archivo.sql` genera el SQL sin conectarse (contiene datos del cliente: no versionar). `--fecha-carga AAAA-MM-DD` fija la fecha de baja de los descartes; por defecto es **hoy en Montevideo** (no UTC: de noche el día UTC ya cambió).

**Conexión y credencial.** La cadena nunca va en los argumentos de `psql` (se vería en `ps`). Se configura por el entorno, sin imprimirla: `NEUMET_DB_URL` (se descompone en `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` para el proceso hijo) o las variables `PG*` habituales (`PGSERVICE`, `PGPASSWORD`, `~/.pgpass`). El rol debe omitir RLS (`postgres`). Los mensajes de error se limpian de la clave.

## Km del tramo actual: quedan sin dato
Los neumáticos **montados** se cargan con un evento de montaje **sin odómetro** (el listado no trae el odómetro del vehículo en esa fecha). Consecuencia: el tramo actual de cada montada no tiene inicio conocido, así que `v_km_cubierta` lo cuenta «sin dato» (no suma km ni inventa precisión) y el CPK de esas cubiertas queda sin dato hasta completarlo. El dry-run lo avisa con una línea («Montados sin km del tramo actual: n»). Los `km_previos` (km total acumulado del listado) sí se cargan.

Cómo completarlo después, sin migración:
- **Lo normal:** en cada vehículo, registrar el odómetro actual desde el panel o la app; desde ahí los desmontajes y bajas futuros cierran tramos con dato y el CPK empieza a calcularse.
- **Para recuperar también el tramo ya recorrido:** `update eventos_neumatico set odometro_km = <odómetro del vehículo a la fecha del montaje>` sobre los eventos cuya nota empieza con «Carga inicial Excel» y tipo `montaje`, a partir del dato «Km del montaje actual» que cada cubierta tiene en `notas` (odómetro actual del vehículo menos esos km). Lo ejecuta el director con el odómetro real de cada vehículo; no se automatiza porque el listado no lo trae.

## Descartes como baja sin vehículo
La migración `20261125000000_baja_sin_vehiculo.sql` (pendiente de aplicar; apéndice V de `docs/08`) relaja `neumaticos_stock_ck`: un neumático sin vehículo puede estar `baja` si trae `fecha_baja` y `motivo_baja`. Esas bajas no cuentan como stock (los listados de Stock, montaje, cambio y búsqueda filtran `estado = 'almacenado'`). **Antes de aplicarla**, `--descarte baja` (por defecto, la decisión del dueño) se **niega con un mensaje claro** y sin escribir nada; mientras tanto se puede cargar el resto con `--descarte omitir` y repetir la carga con la migración aplicada (es idempotente, completa solo los descartes).

## Decisiones de mapeo
- **Montados**: van a su vehículo y posición. **En depósito (no DESCARTE)**: stock (`almacenado`, sin vehículo ni posición, en la sucursal elegida). **DESCARTE**: `baja`, motivo «Descarte (carga inicial)», fecha de baja = fecha de la carga. «Depósito: X» queda en `notas` de cada cubierta.
- **Vehículos**: en la sucursal elegida; `INTERNO` = `patente | número`. Sin número, la patente hace de número (el panel exige uno); nombre «Coche <número>».
- **Colisiones de patente y número**: se bloquean en el plan, con el motivo en la advertencia, y ese vehículo y sus neumáticos no se cargan: la misma patente con dos números distintos en el listado (o al revés); un vehículo ajeno a la carga con el mismo número o patente; un vehículo de una carga anterior con la misma patente y otro número (o el mismo número y otra patente).
- **Posiciones**: la posición más alta es el **auxilio** cuando es 9 u 11 y se guarda como **99** (convención del código; no 98); las ruedas conservan su número. Con 8, 10 o menos no hay auxilio. Todos los vehículos quedan con `tipo_ruedas` 10 y distribución sin definir (la elige el cliente). Posición repetida o fuera de 1..11: no se carga ese vehículo ni sus neumáticos (advertencia).
- **Vida y condición**: `vida` = recapados de carga + extra, acotada a 0..3 (límite de la base; si excede, queda en notas). Un recapado que no es entero (vacío cuenta como 0) se toma como 0 **con advertencia**. Condición «recauchutado» con vida > 0 o «Usada recapada»; «nuevo» solo para stock «Nueva original» sin vida ni km; el resto «usado» (un montado nunca es «nuevo»). `km_previos` = KM TOTAL ACUMULADO.
- **Fechas**: dd/mm/aaaa en texto, o celdas de fecha de Excel (guardadas como número de serie, con formato de fecha), que el lector convierte a dd/mm/aaaa. Un número sin formato de fecha no se toca.
- **Lo que no tiene columna va a `notas`**: dimensión normalizada, banda, estado del listado, recapados originales, km del montaje actual, fabricación, identificador interno. Los **mm** no se cargan como mediciones: quedan como «Últimos mm (carga inicial): a|b|c|d». El número de quema queda vacío.
- **Código repetido**: el primero conserva el código; los siguientes se cargan sin código (`idneumatico` con sufijo `-rN`) y con la nota «Código repetido en el Excel»; el dry-run los cuenta.
- **Historial**: un evento por cubierta (`montaje` con la fecha del listado, `alta_stock` o `baja`), con la nota «Carga inicial Excel…», sin odómetro.

## Qué replica (y por qué es SQL directo)
Las RPC (`neumatico_montar`, `stock_cubierta_agregar`, `vehiculo_crear`) autorizan con `auth.uid()` y el equipo Neumet es de solo lectura desde C2, así que la carga corre como `postgres` e inserta directo, replicando sus invariantes: auxilio 99 único por vehículo, `vida` 0..3, condición sin «nuevo» al montar, `sucursal_id` solo en stock, eventos de historial. Las pruebas SQL comprueban que el administrador de empresa del cliente y el perfil de la sucursal de la carga ven lo cargado por RLS, y que otra sucursal del mismo cliente y otro cliente no.
