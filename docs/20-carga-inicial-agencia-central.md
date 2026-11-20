# 20 · Carga inicial de Agencia Central

Script único que carga el listado de neumáticos del cliente (un `.xlsx` de 2000 filas) en la empresa «Agencia Central» (cliente 1, sucursal 1 «Montevideo»). Lo ejecuta el director; el listado trae datos del cliente y **no va al repositorio** (ni en tests: las pruebas usan un listado sintético). Sin migración.

Código: `supabase/seed/importar-agencia-central.mjs` (CLI), `supabase/seed/lib/` (`xlsx.mjs` lector sin dependencias, `agencia-central.mjs` mapeo puro, `sql.mjs` generador). Pruebas: `tests/unit/importar-agencia-central.test.mjs` y `tests/sql/importar_agencia_central.sh` (contra el Postgres desechable de `tests/sql/run.sh`).

## Cómo correrlo
1. **Dry-run sin base** (solo lee el archivo): `node supabase/seed/importar-agencia-central.mjs --archivo <listado.xlsx>`. Muestra conteos y advertencias por tipo (`--detalle` las lista una a una).
2. **Dry-run con base** (solo lectura; detecta choques con vehículos existentes y revisa la restricción de bajas): igual, con `NEUMET_DB_URL` en el entorno (cadena Postgres del rol `postgres`; se lee del entorno, no se imprime ni se guarda). Requiere `psql`.
3. **Carga**: lo mismo con `--ejecutar`. Una sola transacción: o entra todo o no entra nada. Reejecutarla no duplica nada (clave `idneumatico = CI-<cliente>-<código>`).
4. `--emitir-sql archivo.sql` genera el SQL sin conectarse (contiene datos del cliente: no versionar). `--fecha-carga AAAA-MM-DD` fija la fecha de baja de los descartes. Antes de escribir se verifica que el cliente se llame «Agencia Central» y que la sucursal sea suya.

## Bloqueo conocido: los descartes como baja
`neumaticos_stock_ck` exige que un neumático sin vehículo esté `almacenado`: **una baja sin vehículo no se puede guardar hoy**. Por eso `--descarte baja` (por defecto, la decisión del dueño) se **niega con un mensaje claro** si la base no lo admite, sin escribir nada. Opciones:
- Cargar ya todo lo demás con `--descarte omitir` (vehículos, montados y stock) y los descartes después.
- Una migración propia (fuera de este PR) que relaje la restricción para `baja`. Al hacerlo hay que revisar `assets/js/views/stock.js` y la política de `stock_neumaticos`, que hoy listan por `vehiculo_id is null` y mostrarían las bajas como stock.

## Decisiones de mapeo
- **Montados**: van a su vehículo y posición. **En depósito (no DESCARTE)**: stock (`almacenado`, sin vehículo ni posición, sucursal 1). **DESCARTE**: `baja`, motivo «Descarte (carga inicial)», fecha de baja = fecha de la carga. «Depósito: X» queda en `notas` de cada cubierta.
- **Vehículos**: sucursal Montevideo; `INTERNO` = `patente | número`. Sin número, la patente hace de número (el panel exige uno); nombre «Coche <número>».
- **Posiciones**: la posición más alta es el **auxilio** cuando es 9 u 11 y se guarda como **99** (convención del código; no 98); las ruedas conservan su número. Con 8, 10 o menos no hay auxilio. Todos los vehículos quedan con `tipo_ruedas` 10 y distribución sin definir (la elige el cliente). Posición repetida o fuera de 1..11: no se carga ese vehículo ni sus neumáticos (advertencia).
- **Vida y condición**: `vida` = recapados de carga + extra, acotada a 0..3 (límite de la base; si excede, queda en notas). Condición «recauchutado» con vida > 0 o «Usada recapada»; «nuevo» solo para stock «Nueva original» sin vida ni km; el resto «usado» (un montado nunca es «nuevo»). `km_previos` = KM TOTAL ACUMULADO.
- **Lo que no tiene columna va a `notas`**: dimensión normalizada, banda, estado del listado, recapados originales, km del montaje actual, fabricación, identificador interno. Los **mm** no se cargan como mediciones: quedan como «Últimos mm (carga inicial): a|b|c|d». El número de quema queda vacío.
- **Código repetido**: el primero conserva el código; los siguientes se cargan sin código (`idneumatico` con sufijo `-rN`) y con la nota «Código repetido en el Excel»; el dry-run los cuenta.
- **Historial**: un evento por cubierta (`montaje` con la fecha del listado, `alta_stock` o `baja`), con la nota «Carga inicial Excel…», sin odómetro.

## Qué replica (y por qué es SQL directo)
Las RPC (`neumatico_montar`, `stock_cubierta_agregar`, `vehiculo_crear`) autorizan con `auth.uid()` y el equipo Neumet es de solo lectura desde C2, así que la carga corre como `postgres` e inserta directo, replicando sus invariantes: auxilio 99 único por vehículo, `vida` 0..3, condición sin «nuevo» al montar, `sucursal_id` solo en stock, eventos de historial. Las pruebas SQL comprueban que el administrador de empresa del cliente ve lo cargado por RLS y que otro cliente no.
