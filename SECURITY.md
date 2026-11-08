# Política de seguridad

## Reporte de vulnerabilidades
Escribir a **contacto.neumet@gmail.com** con el asunto `[SECURITY]`, describiendo el problema y cómo reproducirlo. No abrir issues públicos con detalles explotables. Plazo objetivo de respuesta: 5 días hábiles.

## Qué es público y qué no
- La **anon/publishable key** de Supabase y la URL del proyecto están en el frontend por diseño. Su protección es la RLS de la base.
- Nunca deben aparecer en el repo: `service_role`/secret key, `RESEND_API_KEY`, tokens de Vercel, archivos `.env*`. Si aparece alguno, reportarlo como crítico.

## Estado
Auditoría inicial y plan de remediación en [`docs/02-auditoria-seguridad.md`](docs/02-auditoria-seguridad.md).

## Dónde está el código
El panel son módulos ES nativos en `assets/js/` (ver [`assets/js/README.md`](assets/js/README.md)); todo HTML dinámico pasa por `assets/js/core/html.js`. Procedimientos de operación (claves, cuentas, despliegue) en [`docs/11-runbook-operacion.md`](docs/11-runbook-operacion.md).
