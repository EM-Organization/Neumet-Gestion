# Política de seguridad

## Reporte de vulnerabilidades
Escribí a **contacto.neumet@gmail.com** con el asunto `[SECURITY]`, describiendo el problema y cómo reproducirlo. No abras issues públicos con detalles explotables. Respondemos en un plazo objetivo de 5 días hábiles.

## Qué es público y qué no
- La **anon/publishable key** de Supabase y la URL del proyecto están en el frontend por diseño. Su protección es la RLS de la base.
- Nunca deben aparecer en el repo: `service_role`/secret key, `RESEND_API_KEY`, tokens de Vercel, archivos `.env*`. Si encontrás alguno, reportalo como crítico.

## Estado
Auditoría inicial y plan de remediación en [`docs/02-auditoria-seguridad.md`](docs/02-auditoria-seguridad.md).
