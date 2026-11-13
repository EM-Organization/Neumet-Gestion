# 15 · Rotación, alerta única de estado crítico y rendimiento del indicador de desgaste

Documento de investigación y diseño. Los esbozos de SQL y de JavaScript de las secciones A y B son propuestas. De la sección C ya están implementadas la tasa robusta, la vista rápida y la referencia con `MIN_MUESTRAS` = 5 (ver C.6 y C.7); las tablas de C.1 a C.5 describen el estado **anterior** a esos cambios y se conservan como registro de la medición. Estilo de textos según `docs/14-guia-de-textos.md`.

Contenido: A) recomendación de rotación; B) alerta única de estado crítico, personalizable por cliente; C) auditoría de rendimiento del texto «Desgaste mayor al normal…».

---

## A. Recomendación de rotación

Para camiones y buses de pasajeros, la propuesta ampliada (rol de eje, duales, retiro por posición, reposición) está en [18](18-rotacion-vehiculos-pesados.md); esta sección queda como diseño base, y donde ambos difieren manda [18](18-rotacion-vehiculos-pesados.md) según su tabla de decisiones reemplazadas (sección 2.2).

### A.1 Qué dicen las fuentes

| Tema | Hallazgo | Fuente |
|---|---|---|
| Eje direccional | La rotación se hace de lado a lado (izquierda con derecha). Pasar un neumático direccional a tracción solo si el fabricante aprueba ese modelo para tracción. | Michelin (D. Jones), citado en [Overdrive: Tire rotation](https://www.overdriveonline.com/business/article/14873403/tire-rotation); resumen de búsqueda en [heavyvehicleinspection.com](https://heavyvehicleinspection.com/blog/post/semi-truck-tire-rotation-pattern-guide) |
| Tracción y remolque | Pueden rotarse de adelante hacia atrás, de lado a lado o en cruz (X). El remolque sigue el patrón de tracción. | Mismas fuentes; [Overdrive: Tire rotation](https://www.overdriveonline.com/feature-article-tire-rotation/) |
| Cuándo rotar | El manual de servicio de Michelin indica rotar cuando aparece desgaste irregular o cuando la tasa de desgaste difiere de forma notable entre ejes (tracción) o entre lados (dirección). No hay intervalo fijo obligatorio; las guías comerciales dan rangos muy distintos (30 000 a 75 000 millas), por lo que no se usa un intervalo en km como regla. | [DMT / Michelin](https://read.dmtmag.com/i/34501/49); Overdrive |
| Rotar no corrige la causa | Un desgaste desparejo por alineación, presión o suspensión no se arregla rotando. Hay que corregir la causa. | Michelin (D. Jones) en Overdrive; [heavyvehicleinspection.com: diagnóstico](https://heavyvehicleinspection.com/article/tire-wear-pattern-diagnosis-alignment-fleet) |
| Por qué los delanteros se desgastan más | Los neumáticos direccionales soportan las fuerzas de giro y frenado (rozamiento del hombro) y suelen tener los problemas de alineación; el hombro llega al límite antes que el centro. Es una explicación cualitativa, sin cifras fiables. | [heavyvehicleinspection.com](https://heavyvehicleinspection.com/blog/post/semi-truck-tire-rotation-pattern-guide) (fuente comercial, uso orientativo) |
| Duales | La diferencia máxima habitual es de 1/4 de pulgada (6 mm) de **diámetro**, que se verifica con una diferencia de profundidad de 4/32 de pulgada (3,2 mm). Esa regla solo vale si tamaño, fabricante y diseño son iguales; con marcas o diseños distintos, y en reencauches, hay que medir el diámetro o la circunferencia. El neumático mayor soporta más carga y se recalienta. | [FleetOwner: Playing matchmaker](https://fleetowner.com/equipment/article/21687894/playing-matchmaker), [Dual matching nightmares](https://www.fleetowner.com/equipment/article/21693491/dual-matching-nightmares), [Tire Review](https://www.tirereview.com/?p=59825), [Truckinginfo: Mismatched duals](https://www.truckinginfo.com/articles/mismatched-duals) |
| Mezcla en un eje | Mismo tamaño, construcción y diseño de banda en el eje direccional, con diámetros y profundidades lo más cercanos posible; nunca radial con diagonal. Michelin (Europa) prefiere el mismo dibujo por eje y no más de 10 mm de diferencia de diámetro. No se halló un límite publicado de profundidad entre ruedas direccionales. | [heavyvehicleinspection.com: steer](https://heavyvehicleinspection.com/article/steer-tire-inspection-requirements-fleet-safety); [Michelin UK](https://tvs.michelin.co.uk/daf/Fitting-new-tyres) |
| Límites de retiro (EE. UU.) | Direccionales 4/32 pulgada (3,2 mm), resto 2/32 (1,6 mm). En NEUMET el retiro es `clientes.umbral_retiro_mm` (3 mm por defecto). | Overdrive; FMCSA citada en la búsqueda |

Límites de la investigación: varias páginas son blogs comerciales; el mejor respaldo (Michelin, FleetOwner, Tire Review, Truckinginfo) cubre dirección, duales y criterio de «rotar cuando difiere». Las cifras de intervalo no se usan. El umbral por defecto del algoritmo sale de la regla de duales (4/32 pulgada), no de un intervalo.

### A.2 Lo que ya tienen los datos

- `v_estado_neumaticos`: por neumático montado `posicion`, `promedio` (mm), `mm1..mm3`, `tasa_mm_semana`, `n_mediciones_90d`, `marca`, `modelo`, `vida`, `ultima_medicion_at`, `sin_medir`.
- `ejeDePosicion(pos)` y `layoutRuedas()` (`assets/js/domain/vehiculo-diagrama.js`): eje, lado y si la rueda es interna o externa. Eje 1 es direccional; los demás son de tracción o remolque (la base no distingue entre ambos: ver TODO).
- RPC `neumatico_rotar(p_vehiculo_id, p_pos_a, p_pos_b, p_odometro_km)` (`20261108000000_cambio_neumatico.sql`): intercambia dos posiciones con bloqueo de filas, rechaza neumáticos dados de baja, exige `neumatico_autorizar_vehiculo` y registra un evento `rotacion` por neumático. **Es un intercambio de a pares**: toda recomendación se expresa como pares `(pos_a, pos_b)`.
- `eventos_neumatico` (tipo `rotacion`, con `created_at`): permite no recomendar una rotación reciente.
- Lo que **no** hay: la medida del neumático (la tabla `neumaticos` solo tiene `marca`, `modelo`, `vida`), el tipo de eje (tracción o remolque) ni la calidad. `marca + modelo + vida` es el sustituto de «calidad y diseño» mientras no exista la medida.

### A.3 Algoritmo propuesto

Función pura `recomendarRotacion(filas, opciones)` en `assets/js/domain/rotacion.js`, sin DOM ni red (mismo patrón que `desgaste-flota.js`). Entrada: filas de `v_estado_neumaticos` de **un** vehículo, más los eventos recientes de rotación. Salida: lista ordenada de sugerencias `{ posA, posB, motivo, difAntes, difDespues, grupo }`.

Parámetros por cliente (columnas nuevas en `clientes`, con el mismo patrón que `umbrales.js`):

| Parámetro | Defecto | Justificación |
|---|---|---|
| `rotacion_umbral_mm` | **3,0 mm** | Equivale al límite de 4/32 pulgada (3,2 mm) de la regla de duales, redondeado al décimo inferior. Es mayor que la tolerancia entre huellas de un mismo neumático (`irregularidad_mm` = 2 mm) y menor que la distancia entre `umbral_bajo_mm` (8) y `umbral_critico_mm` (5), así que se actúa antes de entrar en estado bajo. Configurable de 1,0 a 6,0 mm. |
| `rotacion_dual_max_mm` | 3,0 mm | Diferencia máxima tolerada entre las dos ruedas de un dual tras rotar. Por defecto igual al umbral; puede ser menor, no mayor que 6 mm. |
| `rotacion_espera_dias` | 30 | No recomendar un par si alguno rotó hace menos de ese plazo (evita sugerencias en bucle). |

Pasos:

1. **Filtrar candidatas**: neumáticos `estado_montaje = 'montado'`, con `promedio` no nulo, `sin_medir = false` y no auxilio (posición 99). Una rueda sin medición vigente no entra: se recomienda medir primero.
2. **Agrupar por clase de rotación**. Solo se compara dentro de un grupo:
   - Grupo `direccional`: eje 1. Solo intercambio **de lado a lado** (posiciones 1 y 2).
   - Grupo `traccion_remolque`: ejes 2 en adelante, **sin** mezclar con el eje 1. Intercambios entre ruedas del mismo lado (adelante-atrás), y dentro de un mismo eje entre interna y externa. No se cruza de lado en la primera versión.
   - Dentro de un grupo, dos ruedas solo son intercambiables si tienen igual `marca`, `modelo` y `vida` (no se mezclan calidades, diseños ni reencauches con neumáticos nuevos) y, cuando exista la columna, igual medida. Un campo nulo cuenta como «distinto» salvo que ambos sean nulos.
3. **Medir la desigualdad** de cada grupo:
   - Direccional: `|mm(pos1) − mm(pos2)|`.
   - Tracción y remolque: la mayor diferencia entre ejes del mismo lado y la mayor diferencia dentro de un dual (interna contra externa).
4. **Disparador**: si la desigualdad del grupo es menor que `rotacion_umbral_mm`, no se recomienda nada («Desgaste parejo: sin rotación necesaria»). Si es mayor o igual, se evalúan todos los intercambios candidatos del grupo.
5. **Puntuar cada intercambio**: se simula el estado tras el intercambio y se calcula la desigualdad máxima del grupo (`difDespues`). Se descarta el intercambio si:
   - `difDespues` no mejora a `difAntes` en al menos 1 mm,
   - algún dual queda con diferencia mayor que `rotacion_dual_max_mm`,
   - el vehículo tiene una rotación que involucre esas posiciones dentro de `rotacion_espera_dias`.
6. **Elegir y repetir**: se toma el intercambio con mayor mejora y se vuelve a simular (máximo 2 sugerencias por vehículo, para no pedir una reorganización completa).
7. **Salvaguarda de causa**: si el neumático con menos mm tiene `desgaste_irregular` (diferencia entre huellas mayor que `irregularidad_mm`) o su tasa supera 1,5 veces la mediana (`evaluarDesgaste`), la sugerencia incluye la frase «Revisar alineación y presión antes de rotar», porque rotar no corrige la causa.

Texto de salida (sin segunda persona): «Rotar P1 con P2: 3,6 mm de diferencia entre las ruedas del eje 1.» / «Rotar P4 con P8: la rueda interna del eje 2 supera en 3,4 mm a su externa.»

Uso de la tasa (mm por semana), solo como desempate y con la misma cautela de la sección C.5: cuando hay `n_mediciones_90d >= 4` y tasa válida en ambas ruedas, se calcula la diferencia proyectada a 4 semanas `(mm_a − tasa_a·4) − (mm_b − tasa_b·4)`; si la actual está bajo el umbral pero la proyectada lo supera, la sugerencia se marca como «preventiva» con menor prioridad. Esta parte es **TODO** (A.4).

### A.4 Qué se puede aplicar ya y qué queda como TODO

| Elemento | Estado | Notas |
|---|---|---|
| `recomendarRotacion` con grupos direccional y tracción/remolque, comparación por `marca/modelo/vida`, umbral y espera | **Aplicable ya** | Solo usa columnas existentes. |
| Columna `clientes.rotacion_umbral_mm` (y las dos restantes) con el check de rango, y campos en el formulario de umbrales (`CAMPOS_UMBRAL`) | **Aplicable ya** | Migración corta e idempotente; mismos controles de `umbrales.js`. Mientras no exista, se usan los valores por defecto. |
| Mostrar la sugerencia en la ficha del vehículo con botón que llama a `neumatico_rotar` | **Aplicable ya** | La confirmación y los permisos ya existen (RPC). |
| Medida del neumático (`neumaticos.medida`) y restricción «no mezclar medidas» | **TODO** | Requiere columna nueva, captura en altas y en la API del proveedor. Hasta entonces la restricción de medida se aproxima con `marca/modelo`. |
| Tipo de eje (tracción o remolque) | **TODO** | Hoy no se distingue; el grupo `traccion_remolque` los une. Una columna `vehiculos.ejes_config` o por eje lo resuelve. |
| Pasar un direccional a tracción | **TODO** | Exige dato de aprobación del fabricante por modelo; no se recomienda. |
| Proyección a 4 semanas y sugerencia preventiva | **TODO** | Depende de que la tasa sea robusta (C.5). |
| Rotación en cruz entre lados | **TODO** | Más de dos pasos con la RPC actual (intercambio de a pares); evaluar una RPC de permutación atómica. |
| Intervalo por km desde `odometro_km` | **TODO** | Las fuentes no dan un intervalo común; decidir con datos propios. |
| Umbral distinto para dirección y para tracción | **TODO** | Una sola cifra por cliente en la primera versión. |

### A.5 Criterios de aceptación

1. Con un vehículo cuyas ruedas del eje 1 difieren menos que el umbral, la función devuelve lista vacía.
2. Con diferencia mayor o igual al umbral en el eje 1 y misma marca, modelo y vida, devuelve exactamente el par `(1, 2)`.
3. Nunca devuelve un par con marca, modelo o vida distintos, ni un par que incluya el eje 1 y otro eje, ni la posición 99.
4. Tras aplicar cualquier sugerencia, ningún dual supera `rotacion_dual_max_mm` si no lo superaba antes; y la desigualdad del grupo disminuye al menos 1 mm.
5. Una rueda sin medir, sin `promedio` o con neumático no montado no se sugiere.
6. Un par rotado dentro de `rotacion_espera_dias` no se vuelve a sugerir.
7. Cambiar `rotacion_umbral_mm` a un valor mayor reduce (o iguala) el número de sugerencias; es monótono.
8. La salida es determinista: mismo orden ante empates (por posición ascendente).
9. Los textos pasan la revisión de `docs/14` (sin voseo ni segunda persona).

### A.6 Tests sugeridos

Unitarios (`tests/unit/rotacion.test.mjs`, patrón de `desgaste.test.mjs` y `vehiculo-detalle.test.mjs`):

- Parejo bajo el umbral, justo en el umbral (se recomienda) y justo bajo él (no).
- Eje direccional con marcas distintas: sin sugerencia. Con misma marca y modelo: sugiere `(1, 2)`.
- Camión 10 ruedas: dual con 3,5 mm de diferencia y ruedas del mismo tipo en otro eje que lo corrigen; verificar que el resultado no empeora otro dual.
- Dual con vida 0 y vida 1: no se mezclan.
- Rueda `sin_medir` o auxilio: ignorada.
- Evento `rotacion` de hace 10 días: bloquea; de hace 40: no.
- Propiedad: para filas aleatorias, toda sugerencia cumple los criterios 3 y 4 (test de propiedades sencillo con semilla fija).
- Umbral monótono (criterio 7).

SQL (`tests/sql/t_80_rotacion.sql`): migración idempotente, check de rango de las columnas nuevas, y que `neumatico_rotar` aplicado a la sugerencia deja el estado esperado en `v_estado_neumaticos` (las mediciones siguen al neumático).

E2E (`tests/e2e/specs`): ficha de un vehículo del demo con ruedas desparejas muestra la sugerencia y el botón; confirmar ejecuta la RPC y la sugerencia desaparece.

---

## B. Alerta única de estado crítico, personalizable

> Estado: la etapa 1 está implementada en la migración `20261118500000` (ver `docs/08`, apéndice M). Quedó fuera de esa etapa la anulación por eje y posición, que sigue descrita abajo como diseño. Las tablas B.1 y B.6 describen el estado y el esbozo anteriores.

### B.1 Situación actual

- `v_alertas` (`20261109000000_mediciones_por_neumatico.sql`) genera sobre la marcha cinco tipos: `critico` (severidad 3), `bajo`, `cruza_critico_pronto`, `desgaste_irregular` (2) y `sin_medir` (1), a partir de `v_estado_neumaticos`.
- No hay estado: no existe «abierta», «reconocida» ni «resuelta»; una alerta existe mientras se cumple la condición. No hay historial, ni destinatarios, ni notificación, ni forma de silenciar.
- Una sola configuración por cliente (`clientes.umbral_*`, `irregularidad_mm`, `dias_sin_medir_alerta`).
- Ruido observado (sección C.5): `cruza_critico_pronto` se dispara con 2 mediciones separadas un día porque la tasa se extrapola desde dos puntos.

### B.2 Definición de producto

Un solo tipo de alerta: **«Neumático en estado crítico»**. Un neumático montado está en estado crítico cuando su promedio de mm es menor que el umbral crítico aplicable. «Bajo», «cruza el crítico pronto», «desgaste irregular» y «sin medir» dejan de ser alertas: pasan a ser indicadores visibles en la ficha, el color del diagrama y «Requieren atención» de Inicio, sin notificación ni estado.

### B.3 Personalización

| Dimensión | Diseño |
|---|---|
| Umbral crítico | Por cliente (hoy `clientes.umbral_critico_mm`, queda como valor base). Anulaciones opcionales por **eje** (p. ej. direccional 6 mm), por **posición** y por **marca y modelo**. Precedencia: posición, luego marca/modelo, luego eje, luego cliente. Debe mantenerse `umbral_retiro_mm < umbral_critico_mm`. |
| Histéresis | `histeresis_mm` por cliente, 0,5 mm por defecto. Se abre cuando `promedio < U`; se resuelve cuando `promedio >= U + histeresis`. Evita abrir y cerrar con el ruido del sensor (la dispersión entre huellas de un mismo neumático puede ser de décimas de mm; ajustar con datos reales). |
| Destinatarios y canal | Tabla de destinatarios por cliente (y opcionalmente por sucursal): correo en la etapa 2; webhook y mensajería quedan como TODO. Cada alerta nueva produce un envío; los recordatorios son configurables. |
| Silenciar | Por neumático o por vehículo, hasta una fecha (`silenciada_hasta`), con motivo y autor. Una alerta silenciada sigue abierta pero no notifica. |
| Reconocer | Un usuario con permiso sobre el vehículo marca «Reconocida» (con nota opcional); no cierra la alerta, indica que alguien la atiende. |
| Evitar duplicados | Índice único parcial: a lo sumo una alerta no resuelta por neumático. Una rotación no genera alerta nueva: la alerta sigue al neumático. Un neumático nuevo en la posición es otro neumático. |
| Reapertura | Si una alerta resuelta por recuperación vuelve a cruzar el umbral dentro de 7 días (configurable), se reabre la misma fila y se incrementa `veces_reabierta`, en lugar de crear una nueva. |
| Resolución | Automática: `promedio >= U + histéresis` (motivo `recuperada`), cambio del neumático (`cambio`), baja (`baja`). Manual: un usuario con permiso (`manual`, con nota). |
| Auditoría | Toda transición queda en `audit_log` (trigger como `trg_audit_*`) y en columnas de la propia alerta (`abierta_at`, `reconocida_por`, `resuelta_motivo`…). |
| RLS | Lectura con la misma regla que `vehiculos` (cliente, sucursal, admin). Sin `INSERT`/`UPDATE` directo para `authenticated`: las transiciones van por funciones `SECURITY DEFINER` que llaman a `neumatico_autorizar_vehiculo`, como `neumatico_rotar`. La configuración la edita el administrador del cliente. |

### B.4 Cómo se evalúa: dos alternativas

**Alternativa 1 · Solo vista (`v_alertas` reducida + tabla de configuración).** La vista calcula el estado crítico en cada consulta con el umbral efectivo (join con `alerta_umbrales`).

- Pros: sin estado que mantener ni sincronizar; cambia un umbral y la vista lo refleja de inmediato; migración pequeña.
- Contras: sin reconocimiento, historial, silencios ni histéresis (la histéresis necesita memoria: no se sabe si la alerta «ya estaba abierta»); no hay punto de transición para notificar, así que habría que consultar la vista periódicamente y comparar; no hay auditoría de quién atendió qué; hereda el coste de `v_estado_neumaticos` (sección C: unos 0,45 s por consulta con 3 000 neumáticos).

**Alternativa 2 · Tabla de eventos de alerta con estado (`alertas`).** Una función evalúa cada neumático cuando entra una medición (o cambia su estado) y abre, reabre o resuelve la fila. `v_alertas` pasa a leer la tabla.

- Pros: histéresis, deduplicación, reconocimiento, silencio, historial y auditoría naturales; las notificaciones nacen de las transiciones (una vez por apertura); lectura barata (tabla indexada, no recalcula la flota); permite métricas (tiempo hasta reconocer, reaperturas).
- Contras: más piezas (trigger, función de evaluación, reevaluación al cambiar la configuración); riesgo de desincronización si falla el trigger (mitigado con una reevaluación nocturna y un test de consistencia contra `v_estado_neumaticos`); migración y pruebas más grandes.

**Recomendación: alternativa 2**, por etapas. La necesidad de histéresis, reconocimiento y notificación sin duplicados no se resuelve con una vista, y la tabla además elimina el coste de recalcular la flota para listar alertas.

### B.5 Plan por etapas

**Etapa 1 · mínimo viable (un PR).**

- Tabla `alertas` (esbozo abajo) con índice único parcial, RLS de lectura y auditoría.
- Tabla `alerta_umbrales` con anulaciones por eje y por posición (marca/modelo queda para la etapa 3) y columna `clientes.alerta_histeresis_mm`.
- Función `alerta_umbral_efectivo(vehiculo_id, posicion, marca, modelo)` y uso en `v_estado_neumaticos` (el estado `critico` y la alerta usan el mismo umbral).
- Trigger `AFTER INSERT` en `mediciones` (solo filas con `idneumatico`) y `AFTER UPDATE OF estado, posicion` en `neumaticos`; función `alerta_evaluar_neumatico(neumatico_id)`.
- Funciones `alerta_reconocer(id, nota)`, `alerta_silenciar(id, hasta, motivo)` y `alerta_resolver(id, nota)` con autorización.
- Reevaluación de un cliente al cambiar sus umbrales: `alerta_reevaluar_cliente(cliente_id)`; relleno inicial con los neumáticos críticos actuales.
- `v_alertas` conserva sus columnas y solo devuelve `critico` desde la tabla; el panel deja de mostrar los demás tipos como alertas (siguen como indicadores).
- Tests SQL y e2e (B.6).

**Etapa 2 · notificación.** Tabla `alerta_destinatarios`, tabla de salida `alerta_envios` (idempotente por alerta y destinatario), Edge Function que envía correo por transición (y un resumen diario), pantalla de configuración de destinatarios. TODO.

**Etapa 3 · reglas finas.** Anulación por marca/modelo, confirmación con dos mediciones consecutivas (opcional), recordatorios y escalado, métricas de atención, webhook y mensajería. TODO.

### B.6 Esbozo de migración (solo en este documento)

```sql
-- 2026xxxx_alertas_criticas.sql  (ESBOZO, no existe en supabase/migrations)
alter table public.clientes
  add column if not exists alerta_histeresis_mm numeric(3,1) not null default 0.5
    check (alerta_histeresis_mm between 0 and 3);

create table if not exists public.alerta_umbrales (
  id          bigint generated by default as identity primary key,
  cliente_id  bigint not null references public.clientes (id) on delete cascade,
  eje         smallint,            -- 1 = direccional
  posicion    smallint,
  umbral_mm   numeric(3,1) not null check (umbral_mm > 0),
  created_at  timestamptz not null default now(),
  check ((eje is not null) <> (posicion is not null))   -- una sola dimensión por fila
);
create unique index if not exists alerta_umbrales_uk
  on public.alerta_umbrales (cliente_id, coalesce(eje, 0), coalesce(posicion, 0));

create table if not exists public.alertas (
  id               bigint generated by default as identity primary key,
  cliente_id       bigint not null references public.clientes (id) on delete restrict,
  vehiculo_id      bigint not null references public.vehiculos (id) on delete restrict,
  neumatico_id     bigint not null references public.neumaticos (id) on delete restrict,
  idneumatico      text,
  tipo             text not null default 'critico' check (tipo = 'critico'),
  estado           text not null default 'abierta' check (estado in ('abierta','reconocida','resuelta')),
  umbral_mm        numeric(3,1) not null,        -- umbral vigente al abrir
  mm_apertura      numeric(5,2) not null,
  mm_minimo        numeric(5,2) not null,
  abierta_at       timestamptz not null default now(),
  reconocida_at    timestamptz, reconocida_por uuid, nota_reconocida text,
  silenciada_hasta timestamptz, silencio_motivo text,
  resuelta_at      timestamptz, resuelta_motivo text
                   check (resuelta_motivo in ('recuperada','cambio','baja','manual')),
  veces_reabierta  integer not null default 0,
  ultimo_aviso_at  timestamptz
);
-- A lo sumo una alerta no resuelta por neumático (deduplicación).
create unique index if not exists alertas_una_abierta_uk
  on public.alertas (neumatico_id) where estado <> 'resuelta';
create index if not exists alertas_cliente_estado_idx on public.alertas (cliente_id, estado);
create index if not exists alertas_vehiculo_idx on public.alertas (vehiculo_id);

alter table public.alertas enable row level security;
revoke all on public.alertas from anon, authenticated;
grant select on public.alertas to authenticated;
-- policy de lectura: misma regla que vehiculos (admin, cliente, sucursal)
-- create policy alertas_select on public.alertas for select to authenticated using (...);
create trigger trg_audit_alertas after insert or update or delete on public.alertas
  for each row execute function public.audit_row();   -- nombre real según el trigger de auditoría existente

-- Evaluación (esbozo de la lógica)
create or replace function public.alerta_evaluar_neumatico(p_neumatico_id bigint) returns void ... as $$
  -- 1. último promedio del neumático y umbral efectivo U (alerta_umbral_efectivo)
  -- 2. sin alerta no resuelta y promedio < U           -> insertar 'abierta' (o reabrir la resuelta de <7 días)
  -- 3. con alerta no resuelta y promedio >= U + hist.  -> resolver ('recuperada')
  -- 4. con alerta no resuelta y promedio < U           -> actualizar mm_minimo
  -- 5. neumático ya no 'montado' o dado de baja         -> resolver ('cambio' / 'baja')
$$;
```

### B.7 Criterios de aceptación y tests de la etapa 1

1. Una medición bajo el umbral abre exactamente una alerta; una segunda medición bajo el umbral no abre otra (índice único).
2. Una medición entre `U` y `U + histéresis` no resuelve; una por encima de `U + histéresis` resuelve con motivo `recuperada`.
3. Reapertura: cruce nuevo dentro de 7 días reabre la misma fila (`veces_reabierta + 1`).
4. Rotar un neumático con alerta abierta conserva la alerta (misma fila, nueva posición vía `neumatico_id`); cambiarlo la resuelve con motivo `cambio`.
5. El umbral por eje y por posición se respeta con la precedencia indicada; cambiarlo y llamar a `alerta_reevaluar_cliente` abre o resuelve según corresponda.
6. Aislamiento: un usuario de otro cliente o de otra sucursal no ve ni reconoce la alerta (`42501` en la función, cero filas por RLS). El rol `api` no accede.
7. `authenticated` no puede hacer `INSERT/UPDATE/DELETE` directos sobre `alertas`.
8. `audit_log` registra apertura, reconocimiento y resolución con el usuario.
9. Consistencia: para toda la base de prueba, el conjunto de neumáticos con alerta no resuelta coincide con los de `v_estado_neumaticos` en estado `critico` (salvo la banda de histéresis, que se verifica aparte).
10. El panel muestra una sola categoría de alerta; los demás indicadores siguen visibles en la ficha.

Tests: `tests/sql/t_80_alertas.sql` (puntos 1 a 9 con `test.eq` y `test.denied`), `tests/unit` (agrupación y textos del centro de alertas con un solo tipo), `tests/e2e/specs/alertas-dispositivos.mjs` (conteos contra la tabla) y la prueba de contrato existente para las columnas nuevas.

---

## C. Auditoría de rendimiento del indicador «Desgaste mayor al normal»

Ejemplo de texto: «Desgaste mayor al normal. Se gasta 0,69 mm por semana, 1,7 veces lo habitual en la posición 3 de la flota (0,41 mm por semana).»

### C.1 Dónde y cuándo se calcula

> Descripción anterior a la migración `20261111000000`. El estado vigente está en C.6.

Hay dos cálculos separados.

**En la base de datos, en cada consulta, sin guardar nada.** La tasa `tasa_mm_semana` sale de una regresión (`regr_slope`) sobre los últimos 90 días de mediciones, calculada dentro de `v_estado_neumaticos` (`20261109000000_mediciones_por_neumatico.sql`). Se recalcula completa cada vez que alguien consulta la vista, **para toda la flota visible, aunque se pida una fila**. Motivos medidos en los planes:

- La CTE `h` (materializada) lee **todas** las mediciones de todos los neumáticos montados (180 000 filas con 3 000 neumáticos) y calcula la ventana sobre todo el historial; el límite de 90 días se aplica solo como `FILTER` dentro de la ventana, por lo que no reduce las filas leídas.
- Después hay un ordenamiento de 180 000 filas (`DISTINCT ON` por la última medición) y otro de los 3 000 resultados.
- Un filtro externo (`vehiculo_id = 5`, `cliente_id = 1` sin RLS, `LIMIT`/`OFFSET`) no entra en las CTE materializadas: la consulta de **un vehículo cuesta lo mismo que la de toda la flota**. Con RLS de cliente el filtro sí se aplica en el origen (por eso un cliente de una base grande no paga la base entera); con perfil administrador, no.
- `v_alertas` y `v_resumen_flota_cliente` vuelven a evaluar `v_estado_neumaticos` (la segunda, dos veces).

**En el navegador, en cada carga y cada render.** `referenciaTasas(rows)` calcula la mediana de la tasa por posición y por eje sobre las filas recibidas, y `evaluarDesgaste(fila, ref)` arma la frase.

- Inicio (`views/inicio.js` y `domain/inicio.js`): descarga `v_estado_neumaticos` y `v_alertas` completas con `fetchAll`, páginas de 1 000 filas, secuenciales (cada página es una consulta que recalcula toda la vista) y hasta `MAX_FILAS` = 20 000. `requierenAtencion` llama a `referenciaTasas` una vez y a `evaluarDesgaste` por cada fila.
- Ficha del vehículo (`views/vehiculo-detalle.js`, línea 358): para mostrar **un** vehículo descarga **toda** la flota visible solo para obtener la referencia (`referenciaTasas`, línea 366); después `evaluarDesgaste` se llama en el resumen (una vez por fila), en el dibujo de cada rueda (línea 119) y en el panel de la rueda (línea 238).
- La «flota» de referencia es la que el usuario puede ver (cliente o sucursal), por lo que el mismo neumático puede recibir una frase distinta según quién la mire.

### C.2 Costo medido

Entorno: Postgres 17.11 local (macOS, arm64, `shared_buffers` 512 MB, sin red), todas las migraciones del repositorio aplicadas con el mismo esquema que el arnés `tests/e2e` (`tests/sql/00_stub_auth.sql` + `supabase/migrations`), `ANALYZE` previo, 3 repeticiones, mediana. Datos sintéticos: 10 neumáticos por vehículo, 60 mediciones por neumático en 210 días, desgaste lineal con ruido, tasas entre 0,1 y 0,5 mm por semana (1,4 veces en las posiciones 1 y 2), todas con `idneumatico`. Ejecución como rol `authenticated` con RLS (cliente) y como administrador, tal como llega desde PostgREST. Los scripts de generación y medición se usaron desde el directorio temporal de la sesión y no se incluyen en el repositorio; el arnés de `tests/e2e` puede reproducirlos añadiendo una carga masiva con `generate_series`.

| Consulta (como la hace el panel) | 3 000 neumáticos / 180 000 mediciones | 30 000 neumáticos / 1 800 000 mediciones (10 clientes de 3 000) |
|---|---|---|
| `v_estado_neumaticos`, página 1 (1 000 filas), cliente | 480 ms | 575 ms |
| `v_estado_neumaticos`, página 3 (offset 2 000), cliente | 480 ms | 575 ms |
| `v_alertas`, página 1, cliente | 470 ms | 566 ms |
| `v_estado_neumaticos` de **un** vehículo, cliente | 477 ms | 575 ms |
| `v_ultima_medicion`, cliente | 288 ms | 383 ms |
| `v_estado_neumaticos`, página 1, **administrador** | 469 ms | **6 100 ms** |
| `v_estado_neumaticos` filtrado por `cliente_id` sin RLS | 354 ms | **3 900 ms** |
| `v_resumen_flota_cliente` (todos los clientes) | 853 ms | no medido |
| JavaScript: `referenciaTasas` + `evaluarDesgaste` de todas las filas (Node, no incluye red ni DOM) | 9 ms | 100 ms (30 000 filas) |

Lectura:

- Una carga de Inicio de un cliente con 3 000 neumáticos ejecuta 3 consultas de `v_estado_neumaticos` y 3 de `v_alertas`: unos 6 × 0,48 s = **2,8 s de CPU de base de datos** (dos cadenas secuenciales en paralelo, unos 1,4 s de espera como mínimo). El costo crece de forma cuadrática con el tamaño de la flota por cliente, porque cada página repite el cálculo completo: con 10 000 neumáticos serían 10 páginas de unos 1,5 s cada una.
- Para el administrador la base entera pesa: 6,1 s por página con 30 000 neumáticos, y el tope de `MAX_FILAS` (20 000) corta la lista sin aviso a partir de ese tamaño.
- El tiempo en JavaScript es secundario (9 ms con 3 000 filas); lo caro es **descargar** todas las filas solo para obtener unas medianas.

### C.3 Optimizaciones probadas

Se midieron dos prototipos sobre los mismos datos (como vistas de prueba, no incluidas en el repositorio):

- **Prototipo A: reescribir `v_estado_neumaticos` por neumático**: para cada neumático montado, una sonda al índice `mediciones_idneumatico_idx` por la última medición y otra por el rango de 90 días para la regresión (`LATERAL` con `LIMIT 1` y `created_at >= now() - interval '90 days'`), sin CTE materializada que lea todo. No requiere índices nuevos (se aprovecha `mediciones (idneumatico, created_at desc)`). En 9 000 neumáticos comparados, el resultado coincidió exactamente con la vista actual (0 diferencias en `promedio` y `tasa_mm_semana`).
- **Prototipo B: tabla de estado por neumático** (`neumatico_estado`: última medición, `n_mediciones_90d`, tasa, `calculado_at`), mantenida por trigger al insertar una medición, con una vista de lectura que une con `vehiculos` y `clientes` (la RLS se conserva porque la vista es `security_invoker`).

| Consulta | Vista actual | A: sondas por índice | B: tabla de estado |
|---|---|---|---|
| Página 1, cliente, 3 000 neumáticos | 480 ms | 23 ms | 0,7 ms |
| Un vehículo, 3 000 neumáticos | 477 ms | 1,5 ms | 0,35 ms |
| Página 1, administrador, 30 000 neumáticos | 6 100 ms | 21 ms | 0,9 ms |
| Un vehículo, 30 000 neumáticos | 575 ms | 1,2 ms | 0,5 ms |
| Toda la base sin RLS, 30 000 | 3 800 ms | no medido | 11 ms |
| Recalcular **un** neumático (lo que hace el trigger por inserción) | n/a | n/a | 0,04 ms (3 000) / 0,2 ms (30 000) |
| Reconstruir la tabla completa | n/a | n/a | 54 ms (3 000) / 600 ms (30 000) |
| Mediana por cliente y posición (referencia de flota) | n/a | n/a | 1,2 ms (3 000) / 12 ms (30 000) |

Limitación de los prototipos: solo cubren las mediciones atribuidas por `idneumatico` (regla 1 de la migración). La migración real también atribuye mediciones históricas sin `idneumatico` por posición (reglas 2 y 3), que son las ramas más caras de `v_mediciones_neumatico`. Para aplicar A o B hay dos caminos: mantener esas ramas solo para las filas con `idneumatico is null`, o hacer una migración de datos única que rellene `mediciones.idneumatico` donde la atribución es inequívoca y reducir la vista a la regla 1. Lo segundo es más simple y mantenible; requiere verificar cuántas filas históricas quedan sin atribuir antes de decidir.

### C.4 Recomendaciones y a partir de qué tamaño

| Medida | Qué cambia | Trade-off | Cuándo aplicarla |
|---|---|---|---|
| 1. Limitar la ventana a 90 días **en el origen** y calcular por neumático con sondas al índice (prototipo A) | Reescribir `v_estado_neumaticos` sin CTE materializada global; misma salida | Una sola vista; el costo pasa a depender de las mediciones de 90 días por neumático, no de todo el historial. Hay que decidir el destino de las reglas por posición (backfill) | **Ya**: es equivalente, no agrega objetos y reduce de 0,5 s a 20 ms. Obligatoria antes de superar unos 1 000 neumáticos visibles por usuario o de abrir al administrador con más de unos 5 000 neumáticos en total |
| 2. Referencia de flota calculada en el servidor (RPC o vista pequeña con la mediana por posición y eje del alcance del usuario) y una columna booleana `desgaste_mayor_al_normal` en la vista | El navegador deja de descargar la flota para la ficha de un vehículo; Inicio sigue descargando solo lo que muestra | Más lógica en SQL (duplica la regla que hoy vive en `desgaste-flota.js`; hay que mantener ambas o eliminar la de JavaScript) | Con la medida 1 aplicada, cuando la ficha de vehículo tarde más de 300 ms en cargar o la flota supere unos 3 000 neumáticos; el costo de calcularla es 1 a 12 ms |
| 3. Paginación y filtrado en el servidor para Inicio (consultar solo críticos y «requieren atención», no toda la flota) | Menos páginas y menos filas | Cambia los contratos de las vistas del panel | Junto con la medida 2 |
| 4. Tabla de estado por neumático mantenida por trigger (prototipo B) | Lectura casi instantánea; se pueden indexar estado, tasa y alertas | Escritura un poco más cara por medición (0,04 a 0,2 ms), riesgo de desincronización (mitigado con reconstrucción nocturna y test de consistencia), vencimiento de la ventana de 90 días requiere recálculo periódico | A partir de unos **10 000 neumáticos visibles** en una consulta o 1 M de mediciones, o si el p95 de la vista tras la medida 1 supera 100 ms. Es también la base natural de la tabla `alertas` (sección B) |
| 5. Vista materializada de `v_estado_neumaticos` | Lectura rápida | No admite `security_invoker` ni RLS: exige una vista envoltorio que filtre por vehículo; datos con retraso hasta el siguiente `REFRESH` (0,6 s con 30 000 neumáticos); el refresh bloquea o exige `CONCURRENTLY` con índice único | No recomendada frente a la medida 4 |
| 6. Índices | `mediciones (idneumatico, created_at desc)` ya existe y alcanza. Opcional: añadir `include (promedio)` para lecturas solo por índice si el volumen supera 10 M de mediciones | Más espacio y escritura | Con más de 10 M de mediciones |

Orden propuesto: 1 inmediatamente (un PR de migración y pruebas), 2 y 3 en el siguiente, 4 cuando se cruce el umbral de tamaño o junto con la tabla de alertas.

### C.5 ¿Es robusto el indicador?

Se insertaron seis neumáticos de prueba en la base sintética y se leyó `v_estado_neumaticos`:

| Caso | Datos | `tasa_mm_semana` obtenida | Valoración |
|---|---|---|---|
| Pocas muestras | 2 mediciones con 24 h de diferencia (12,0 y 11,7 mm) | **2,100** | Poco confiable: la tasa real de ese neumático podría ser 0,5. La vista la entrega igual y `cruza_critico_pronto` se dispara (3,2 semanas hasta el crítico). |
| Mismo día | 3 mediciones el mismo día UTC | nula | Correcto: no hay tasa con una sola fecha. |
| Mediciones en días UTC consecutivos pero separadas 2 horas (cruce de medianoche) | 12,0 y 11,8 mm | **16,800** | Falla: `n_fechas` cuenta fechas distintas, no tiempo transcurrido; 0,2 mm en 2 horas se extrapola a 16,8 mm por semana y `cruza_critico_pronto` marca 0,4 semanas. |
| Serie normal | 11 mediciones semanales, 0,5 mm por semana | 0,500 | Correcto. |
| Reencauche o reparación a mitad de la ventana | Desgaste de 0,75 mm por semana durante 8 semanas (14 a 8,75 mm), salto a 14 mm hace 2 semanas y 0,5 mm por semana después | **0,064** | Subestima: la regresión mezcla antes y después del salto. Con un salto mayor o más reciente, la tasa sale negativa. |
| Una lectura errónea (+3 mm) | 11 mediciones, una con +3 mm | 0,555 | Razonablemente robusta con 11 puntos. |

Otros puntos:

- **Tasa negativa**: `referenciaTasas` y `evaluarDesgaste` ignoran tasas menores o iguales a 0 (no entran en la mediana ni generan frase). Bien tratado, pero el neumático con salto positivo queda sin indicador en lugar de reiniciar la ventana.
- **Cambio de neumático**: robusto. La tasa se calcula por neumático (`idneumatico`); el nuevo figura «sin datos» hasta tener mediciones propias y no hereda la tasa del anterior (cubierto por `t_55_mediciones_neumatico.sql` y el e2e `mediciones-neumatico`). Un neumático recién montado tiene pocas muestras: aplica el caso «pocas muestras».
- **Rotación**: la tasa sigue al neumático, pero se compara con la mediana de la **posición actual**; un neumático que pasó de dirección a tracción conserva en la regresión semanas de otro régimen de desgaste.
- **Referencia**: `MIN_MUESTRAS` = 3 hacía que la mediana de una posición con tres neumáticos fuera inestable (ya corregido: ver C.7), y el factor 1,5 es una convención sin calibrar con datos reales. Mezclar camiones y buses o rutas muy distintas en una misma referencia puede sobrar o faltar.
- **Resultado equivalente en el texto**: la frase muestra «1,7 veces lo habitual», pero con 2 mediciones no hay forma de saber si es real.

Correcciones propuestas (los puntos 1, 2 y 4 ya están aplicados, ver C.6 y C.7; el 3 queda como mejora posterior):

1. Exigir tiempo transcurrido, no fechas: tasa solo si hay al menos 3 mediciones y el intervalo entre la primera y la última es de al menos 14 días; de lo contrario, nula y sin `cruza_critico_pronto`.
2. Reiniciar la ventana en el último evento del neumático de tipo `reencauche`, `reparacion` o `montaje` (de `eventos_neumatico`), o cuando `promedio` suba más de la dispersión esperada (p. ej. 1,5 mm) entre dos mediciones consecutivas.
3. Estimador robusto (Theil-Sen, mediana de pendientes entre pares) como mejora posterior si el ruido real lo exige.
4. Elevar `MIN_MUESTRAS` a 5 y publicar en la frase el tamaño del grupo («mediana de 12 neumáticos de la posición 3»).
5. Tests: casos de la tabla anterior en `tests/sql/t_55_mediciones_neumatico.sql` y en `tests/unit/desgaste.test.mjs`.

### C.6 Estado de implementación: tasa robusta y vista rápida

Implementado en `supabase/migrations/20261111000000_tasa_y_rendimiento.sql` (prueba SQL: `tests/sql/t_58_tasa_robusta.sql`):

- **Tasa robusta.** `tasa_mm_semana` se calcula con tiempo transcurrido, no con fechas distintas. Exige al menos 3 mediciones y 14 días entre la primera y la última de la ventana de 90 días; si no se cumple, es nula y no se dispara `cruza_critico_pronto`. La ventana se reinicia en el último evento del neumático de tipo `reencauche`, `reparacion` o `montaje`. Una pendiente negativa queda nula. `n_mediciones_90d` conserva su significado.
- **Vista rápida (medida 1 de C.4).** `v_estado_neumaticos` se calcula por neumático: una sonda al índice `mediciones_idneumatico_idx` para la última medición y otra por el rango de 90 días para la regresión. Un filtro externo (`vehiculo_id`, `cliente_id`, `LIMIT`) se aplica en el origen: consultar un vehículo ya no cuesta lo mismo que consultar toda la flota. Las mediciones históricas sin `idneumatico` se conservan con las mismas reglas, como respaldo por índice solo donde hace falta (sin backfill de datos).
- **Función `posiciones_medidas_sin_neumatico(p_vehiculo_id)`.** Enumera las posiciones con mediciones que no tienen fila en `neumaticos` (regla 3). Es `SECURITY INVOKER`, `STABLE`, con `search_path` vacío y `ROWS 1`; la RLS de `mediciones` y `neumaticos` decide qué ve cada rol.

**Por qué es una función con `ROWS 1` y no una CTE recursiva dentro de la vista.** La primera versión enumeraba esas posiciones con una CTE recursiva dentro de la vista. El planificador de PostgreSQL estima unas 100 filas por vehículo en una CTE recursiva, y la vista salía con un costo estimado de cientos de miles incluso con 14 vehículos. Ese costo supera `jit_above_cost` (100 000 por defecto) y activa el JIT, que añade cientos de milisegundos de compilación a cada consulta donde está disponible (la imagen `postgres:16` del CI). Declarar la función con `ROWS 1` mantiene baja la estimación de esa parte y evita el disparo. Producción corre PostgreSQL 17.11 con `jit=off`, de modo que allí el JIT no interviene; la función protege los entornos con JIT activo.

**Medición tras el cambio.** PostgreSQL 17.11 local, 2 940 neumáticos y 180 000 mediciones generados con `tests/perf/gen.sql`, rol `authenticated`, mediana de 3 ejecuciones. La instalación local no tiene JIT (`pg_jit_available()` es falso), por lo que no se midió su efecto.

| Consulta | Antes (C.2) | Ahora |
|---|---|---|
| `v_estado_neumaticos`, página 1, cliente | 480 ms | 17 ms |
| `v_estado_neumaticos`, un vehículo, cliente | 477 ms | 2 ms |
| `v_estado_neumaticos`, página 1, administrador | 469 ms | 18 ms |
| `v_alertas`, página 1, cliente | 470 ms | 25 ms |

Tras `20261113000000_stock_cubiertas.sql` (que ajusta `v_mediciones_neumatico` para que el historial siga a la cubierta en stock) se midió también esa vista, con los mismos datos: primeras 1 000 filas, 0,9 ms (costo estimado 42 106); todas las filas del cliente (`count(*)`), 119 ms; un vehículo, 17 ms. `v_estado_neumaticos` con `LIMIT 1000` tiene un costo estimado de 1,38 millones en el plan aunque se ejecuta en 18 ms: la estimación del planificador es alta para esta vista (sin JIT local no hay efecto visible); si algún entorno con JIT activo mostrara compilaciones largas en esas consultas, conviene fijar `jit=off` o revisar las estimaciones antes de ampliar la vista.

Siguen pendientes las medidas 2 a 4 de C.4 (referencia de flota en el servidor, paginación en Inicio, tabla de estado), que dependen del tamaño de la flota. Las cifras de «Ahora» no son comparables al milímetro con las de «Antes» (otro volumen sintético y otra máquina), pero el orden de magnitud sí.

### C.7 `MIN_MUESTRAS`: de 3 a 5

`MIN_MUESTRAS` está definido en `assets/js/domain/desgaste-flota.js` y lo usa `referenciaTasas`: una posición solo aporta una mediana de referencia si tiene al menos ese número de neumáticos con tasa mayor a 0 en la flota visible. Pasó de 3 a 5 por robustez de la mediana:

- Con 3 tasas la referencia depende de solo tres neumáticos: dos valores atípicos bastan para llevar la mediana a cualquier valor. Con 5, hacen falta tres.
- La frase «N veces lo habitual» y el umbral `FACTOR_TASA` (1,5) se calculan sobre esa mediana, de modo que su error pasa directo al indicador de cada neumático de la posición.

Efecto en flotas chicas: si una posición tiene menos de 5 neumáticos con tasa, no se usa su mediana y se recurre a la del mismo eje; si el eje tampoco llega a 5, no se evalúa la tasa y el neumático no recibe la frase por tasa (el desgaste irregular no depende de la flota y se evalúa igual). Una flota pequeña puede no ver ese indicador hasta acumular muestras suficientes: es el costo aceptado de no emitir una comparación poco fiable. El valor queda fijado por `tests/unit/vehiculo-detalle.test.mjs` («MIN_MUESTRAS es 5: con 4 neumáticos en la posición no hay referencia»). Queda pendiente publicar el tamaño del grupo en la frase.

---

## Resumen de decisiones propuestas

| Tema | Decisión | Estado |
|---|---|---|
| Rotación | Función pura `recomendarRotacion` con umbral por cliente (3,0 mm por defecto, equivalente a 4/32 pulgada) y restricciones por grupo, marca, modelo y vida; usa `neumatico_rotar` | Aplicable ya (medida y tipo de eje: TODO) |
| Alertas | Un solo tipo «Neumático en estado crítico» con tabla `alertas` de estados, histéresis y umbral por cliente, eje y posición | Etapa 1 en un PR; destinatarios y reglas finas: TODO |
| Rendimiento | Reescribir `v_estado_neumaticos` por neumático con ventana de 90 días en el origen; luego referencia en el servidor y tabla de estado | Medida 1 hecha (`20261111000000`); medidas 2 a 4 por tamaño |
| Robustez de la tasa | Exigir 3 mediciones y 14 días, reiniciar en eventos, no extrapolar de dos puntos | Hecho (`20261111000000`, `desgaste-flota.js`); falta el tamaño del grupo en la frase |

## C.8 Costo del filtro de calidad (migración `20261116000000`)

Las vistas añaden `calidad <> 'invalidada'` a sus sondas existentes (sin joins ni CTE recursivas nuevas). Medido con `tests/perf` (1 cliente, 300 vehículos, 3.000 neumáticos, 180.000 mediciones; PG16 local, jit=off, mediana de 3, en ms), antes → después: estado p1 17,8 → 19,0; estado p3 108,6 → 111,5; alertas p1 25,6 → 27,2; estado de 1 vehículo 1,86 → 1,94; estado de un cliente (superusuario) 71,1 → 72,3. Costo estimado del plan: v_estado_neumaticos 276.985 → 278.113; v_alertas 55.836 → 56.063; v_mediciones_neumatico de un vehículo 8.840 → 9.667. La carga de 180.000 mediciones con el trigger pasó de 3 a 5 s (unos 11 µs por fila).
