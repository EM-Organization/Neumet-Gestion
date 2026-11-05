# Función `contacto`

Recibe el formulario de contacto de la landing y envía un email vía Resend.

## Secrets

| Secret | Obligatorio | Descripción |
|---|---|---|
| `RESEND_API_KEY` | Sí | API key de Resend. |
| `TO_EMAIL` | Sí | Destinatario de las consultas. Si falta, responde 500. |
| `FROM_EMAIL` | No | Remitente. Por defecto `NEUMET Contacto <onboarding@resend.dev>`. |
| `ALLOWED_ORIGINS` | Recomendado | Orígenes permitidos separados por comas. Si no se define, CORS usa `*` (con aviso en logs). Origen no listado: 403. |
| `TURNSTILE_SECRET` | No | Si se define, se exige `cf_token` y se verifica contra Cloudflare Turnstile. |

```bash
supabase secrets set \
  RESEND_API_KEY=re_xxx \
  TO_EMAIL=destino@ejemplo.com \
  FROM_EMAIL="NEUMET Contacto <contacto@tudominio.com>" \
  ALLOWED_ORIGINS=https://neumet.cl,https://www.neumet.cl \
  TURNSTILE_SECRET=0x_xxx
```

## Request

`POST` JSON (máx. 10 KB): `nombre` (1-100), `email` (válido, ≤254), `empresa` (≤120), `telefono` (≤40), `mensaje` (≤2000), `website` (honeypot, debe ir vacío), `cf_token` (si Turnstile está activo).

Respuestas: `{ "ok": true }` o `{ "error": "..." }` (400/403/405/413/500).
