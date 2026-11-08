# 16 · Hoja de ruta de producto (sin machine learning)

Fuente de inspiración: análisis técnico público de una plataforma competidora (documento privado, fuera del repo). Este documento resume qué se adopta, en qué orden y qué queda fuera.

## Principios

1. **Orden de inversión:** identidad, custodia y exposición de cada cubierta primero; después experiencia de campo y calidad de datos; luego costos y reportes; luego proyección y alertas accionables. Machine learning y visión quedan **fuera de alcance** hasta contar con datos reales suficientes.
2. **Una cubierta física = una identidad estable** (la carcasa, con su número de quema) a lo largo de todas sus vidas, montajes y bajas.
3. **Condición, ubicación y aptitud son dimensiones separadas.** «Usado» es una condición, no un lugar; «recauchutado» describe la banda, no la disponibilidad.
4. **Todo cambio deja rastro:** quién, cuándo (fecha efectiva y fecha de carga), origen y destino, y motivo. Los ajustes de stock llevan causal; no hay ediciones silenciosas.
5. **Dato no medido es nulo, nunca cero.** No se oculta un surco bajo detrás de un promedio alto: se conserva el valor crudo y el mínimo de puntos.
6. **Primero indicadores reproducibles e interpretables** (regresión lineal con confianza visible), después nada más complejo.

## Estado actual frente al plan

| Capacidad | Estado |
|---|---|
| Multi-empresa con aislamiento por RLS, sucursales y perfiles | Hecho |
| Identidad por cubierta (idneumatico, número de quema único por cliente) | Hecho |
| Montaje, desmontaje, rotación y cambio con eventos y auditoría | Hecho |
| Mediciones por cubierta (no por posición), últimas mediciones con comparativa | Hecho |
| API de proveedor con idempotencia, mapeo mm1/mm2/mm3 y trazabilidad | Hecho |
| Tasa de desgaste robusta y vista rápida | En curso (PR de tasa) |
| Stock individual con condición y sucursal | En curso (PR de stock de cubiertas: cubierta = neumático sin montar, condición, sucursal, traslados, devolución desde el cambio; ver `docs/08` apéndice F) |
| Motivo explícito `sin_neumaticos` en la API | En curso |
| Mini vehículos y posiciones legibles | En curso |

## Fases propuestas

### F1 · Stock individual y custodia (siguiente)
- Cubierta de stock individual: quema, marca, modelo, fecha de compra, precio opcional, **condición** (Nuevo → Usado al primer montaje; Reparado y Recauchutado manuales) y **ubicación** (sucursal).
- Traslados entre sucursales con registro del movimiento (origen, destino, fecha, autor).
- Desmontaje con destino explícito: volver a stock (usado apto), reparación, recauchutado o baja.
- Criterio de salida: una cubierta conserva su historial completo al pasar por stock, vehículo y sucursal; ninguna operación duplica o pierde unidades.
- Estado: cubierta individual, condición, ubicación, traslado con registro y devolución al stock desde «Cambiar neumático» (destino «Almacenar») están en el PR de stock de cubiertas. Pendiente de F1: que los destinos «reparación» y «recauchutado» también devuelvan la cubierta a un lugar del stock al volver (hoy quedan aparcadas en el vehículo) y la baja con disposición física (F9).

### F2 · Montaje como intervalo y km por cubierta
- Km de la cubierta = km previos + suma de los tramos montados (odómetro final − inicial de cada montaje). No comparar odómetros absolutos entre vehículos.
- Invariantes: un solo montaje activo por cubierta y por posición, sin solapamientos, rotación múltiple atómica.
- Detección de odómetro negativo o reiniciado, con corrección auditada.

### F3 · Calidad de datos y unidades
- Controles al ingresar: aumento de profundidad sin nueva banda, lectura repetida, rango fuera de lo físico, posición incorrecta.
- Invalidar con motivo en lugar de borrar.
- Conservar el valor original y la unidad (mm o 32avos de pulgada) además del normalizado.
- Indicador de confiabilidad por cubierta (pocas mediciones, mediciones viejas).

### F4 · Costos y costo por km (CPK)
- Entradas de costo por cubierta y vida: compra, reparación, recauchutado, montaje.
- **CPK observado** = costo acumulado / km acumulado, con carcasa, banda y tramo explícitos; sin dato cuando los km son cero.
- **CPK final de carcasa** = costo neto total / suma de km de todas las vidas.
- Reportes por marca, modelo, banda y sucursal, mostrando tamaño de muestra y km (no promediar CPK individuales sin ponderar).

### F5 · Recauchutado por carcasa
- Flujo: selección → envío al proveedor → dictamen → aceptación o rechazo → nueva banda.
- Mismo identificador de carcasa; nueva vida con profundidad inicial y costo propios; los km de carcasa no se reinician.
- Un rechazo no crea una vida ficticia.

### F6 · Indicadores de desgaste interpretables
- mm útiles = max(0, mínimo − umbral), caucho útil %, tasa por 1.000 km (cuando hay km confiables), km restantes lineales y fecha estimada de retiro como **escenario** (no garantía).
- Detección de asimetría interior/exterior (alineación) y de centro frente a hombros (presión), siempre como indicios.
- Ver diseño y mediciones de rendimiento en `docs/15-rotacion-alertas-rendimiento.md`.

### F7 · Alertas accionables
- Un solo tipo de alerta «crítico» personalizable por cliente, con histéresis, reconocimiento, silencio y cierre (etapa 1 de `docs/15`).
- Etapas posteriores: destinatarios, correo, reglas por marca y modelo, inspección vencida.

### F8 · Rotación y reposición
- Recomendación de rotación con umbral configurable (diseño en `docs/15`).
- Reposición: necesidad neta = demanda durante el plazo de entrega + seguridad − disponible apto; sugerencia revisable, nunca una compra automática.

### F9 · Conteo físico y bajas
- Conteo por ubicación con diferencias (faltantes y sobrantes) y ajuste con causal y aprobación.
- Baja técnica (retiro autorizado, causal, mm de retiro) separada de la disposición física (retiro del patio, destino, comprobante).
- Sin resurrección desde «dispuesto» por simple edición.

## Fuera de alcance por ahora

- **Machine learning y visión por computadora** (pronóstico contextual, supervivencia, OCR de DOT, detección de daños): requieren histórico propio y etiquetado.
- Lectura RFID y TPMS, instrumentos Bluetooth adicionales, integraciones con ERP o telemática.
- App móvil con modo sin conexión (pertenece a la app de DAC; la API ya es idempotente para soportar reintentos).

## Criterios de aceptación transversales

- Dos operaciones concurrentes sobre la misma cubierta: una confirma y la otra falla de forma explícita, sin duplicar stock.
- Rotación de varias posiciones: todas cambian o ninguna, sin duplicar km.
- Reenvío del mismo lote por la API: idempotente, sin eventos ni costos duplicados.
- Dato no medido: nulo, sin falsa alerta crítica.
- Usuario de otra empresa: sin acceso a cubiertas, fotos, costos ni exportaciones ajenas.
- Predicción sin datos suficientes: se muestra «mediciones insuficientes», nunca una fecha inventada.
