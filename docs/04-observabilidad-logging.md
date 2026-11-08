# 04 · Observabilidad y logging

> **Nota (2026-11):** las referencias `app.js:N` de este documento apuntan al monolito `assets/js/app.js` previo a la modularización (PR del refactor a módulos ES). Hoy el panel vive en módulos ES bajo `assets/js/` (`main.js`, `core/`, `domain/`, `views/`; ver [`assets/js/README.md`](../assets/js/README.md)); los números de línea ya no existen y se conservan como evidencia histórica.

> Estado: Diagnóstico y objetivo de 2026-11-06; `ingesta_log` y `audit_log` ya existen (ver [08-esquema-datos.md](08-esquema-datos.md)). Sentry, uptime y alertas siguen pendientes.

## 1. Estado actual

| Capa | Hoy | Problema |
|---|---|---|
| Frontend (`app.js`, landing) | **Cero** `console.*`, sin reporte de errores. Los errores se muestran como toast (`'Error: '+e.message`) y se pierden | No se sabe qué falla en producción; los mensajes crudos del servidor llegan al usuario |
| `contacto` | Un `console.error('Resend error:', err)` | Sin contexto, sin id de correlación; no hay registro de qué consultas llegaron |
| `guardar-montaje-mm` | No versionada; se desconoce | Si el firmware envía algo inválido, nadie lo ve (es el punto más frágil: hardware en campo) |
| Acciones de admin | Sin auditoría | No hay forma de saber quién borró un cliente, cambió un precio o reasignó un dispositivo |
| Auth | Logs de Supabase Auth (no revisados) | Sin alertas de fuerza bruta |
| Disponibilidad | Indicador "Conectado" en UI según la última carga | No es monitoreo |

## 2. Qué se necesita (y por qué)

**Principio:** tres preguntas deben poder responderse sin SSH ni suerte:
1. *¿Está llegando data de los dispositivos?* (negocio crítico)
2. *¿Quién hizo qué en el panel?* (confianza y soporte)
3. *¿Se está rompiendo algo al usuario?* (calidad)

### 2.1 Ingesta de dispositivos (prioridad máxima)
- Tabla `ingesta_log(id, recibido_at, device_id, status, http_code, motivo, payload_resumen, duracion_ms, request_id)`. Registrar **también los rechazos** (MAC desconocida, patente inexistente, payload inválido, clave inválida).
- Vista "Salud de dispositivos": último mensaje por dispositivo, dispositivos silenciosos > N horas, tasa de rechazo.
- Respuestas con `request_id` que el firmware pueda imprimir en su log serie.
- Retención: 30–90 días del payload, agregados después.
- **Alerta:** dispositivo asignado que no reporta en X días; pico de rechazos.

### 2.2 Auditoría de acciones (`audit_log`)
`audit_log(id, at, actor_id, actor_rol, accion, entidad, entidad_id, antes jsonb, despues jsonb)` alimentada por **triggers en Postgres** (no desde el navegador, que es manipulable) para: `clientes`, `dispositivos`, `vehiculos`, `gastos`, cambios de `precio_mensual`, ejecución de `asignar_dispositivo_a_cliente`, altas y bajas de usuarios. Solo lectura para admin; inmutable (sin UPDATE/DELETE por políticas).
Junto con *soft delete* (`02` S5) esto convierte los borrados en recuperables.

### 2.3 Errores de frontend
- Sentry (o equivalente) con *source maps* tras pasar a build (Fase 2). Capturar: errores no manejados, `unhandledrejection`, errores de Supabase (con `code`, sin PII).
- Un único wrapper `logError(ctx, err)` que: registra en Sentry, muestra un mensaje **genérico** al usuario y conserva el detalle solo en el log.
- Nunca registrar contraseñas, JWT ni cuerpos de formularios.

### 2.4 Edge Functions
- Log estructurado JSON por línea: `{ts, fn, level, request_id, device_id?, user_id?, msg, ms}`. Sin PII (el email del lead se guarda en `leads`, no en logs).
- Los logs de funciones en Supabase tienen retención corta según plan → exportar (Log Drains en planes superiores) o persistir lo importante en tablas (§2.1).

### 2.5 Auth y seguridad
- Revisar Supabase Auth logs; alertar con: ≥ N fallos de login por cuenta/IP, creación de usuarios inesperada, inicio de sesión de admin desde país nuevo.
- Con signup deshabilitado, **cualquier** evento de alta fuera de `crear-cliente` es una anomalía.

### 2.6 Plataforma / disponibilidad
- Vercel: Analytics y Speed Insights (frontend); Log Drains/Observability según plan.
- Monitor de uptime externo (landing, login, y un *health check* a una Edge Function de lectura).
- Canal de alertas único (email/Slack/WhatsApp) para: caída, dispositivos silenciosos, picos de errores.

## 3. Higiene de logs
- Niveles `debug|info|warn|error`; `debug` apagado en producción.
- Sin secretos ni datos personales innecesarios (GDPR/Ley 18.331: minimización).
- `request_id` propagado de cliente → función → log.
- Tabla `leads` con retención definida.

## 4. Hitos
| Hito | Entregable |
|---|---|
| L1 | `ingesta_log` + vista de salud de dispositivos + alertas de silencio |
| L2 | `audit_log` por triggers + soft delete |
| L3 | Sentry + wrapper `logError` (tras migración a Vite) |
| L4 | Uptime + canal de alertas + revisión mensual de Auth logs |
