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

## Verificación de tipos (`deno check`)

```bash
deno task --config supabase/functions/deno.json check
```

La config vive en `supabase/functions/deno.json` (y no en la raíz) a propósito: así Deno no mezcla el `package.json` raíz (ESLint) con las Edge Functions, y `nodeModulesDir: "none"` evita crear `node_modules`. El import `jsr:@supabase/functions-js/edge-runtime.d.ts` arrastra paquetes npm (p. ej. `openai`) de forma transitiva; ese es el origen del error de resolución visto por un revisor si se usa un `deno.json`/`package.json` ambiental distinto. `deno.lock` fija las versiones. CI ejecuta el mismo comando (job `deno`).
