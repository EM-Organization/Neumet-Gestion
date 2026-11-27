# asistente-reportes

Edge Function (Deno) del asistente de reportes con IA (docs/24). Recibe la pregunta del panel, reserva cupo, arma la
conversación, ejecuta el bucle de tools contra PostgREST **con el JWT del usuario y la clave anon** y llama a OpenRouter
con el modelo gratuito, con respaldo de pago ante fallos.

## Contrato

`POST /functions/v1/asistente-reportes` con `Authorization: Bearer <JWT del usuario>` y JSON:

```json
{ "pregunta": "string", "historial": [{ "rol": "usuario" | "asistente", "texto": "string" }], "cliente_id": 5 }
```

- `pregunta`: tras `trim`, de 1 a 500 caracteres.
- `historial`: opcional; hasta 10 turnos, `texto` de hasta 4000 caracteres.
- `cliente_id`: `null`, ausente o entero positivo. Solo lo usa el perfil `admin`; la RPC lo valida.
- Cuerpo de hasta 24 KB.

Éxito (200): `{ "ok": true, "bloques": [...], "fuentes": [...], "modelo": "...", "cuota": { "usadas", "limite" } }`.

| Estado                | `error`                                                        | Causa                                                                                   |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 400                   | `pregunta_invalida`, `historial_invalido`, `cliente_requerido` | Validación del cuerpo, o la RPC informa `22023` (admin sin cliente válido)              |
| 401 / 403 / 405 / 413 |                                                                | Token inválido, origen no permitido, método, cuerpo grande (los da `_shared/acceso.ts`) |
| 403                   | `sin_acceso`                                                   | La RPC informa `42501` (sin perfil o `api`)                                             |
| 429                   | `cuota`                                                        | Sin cupo diario (campo `cuota` con `usadas` y `limite`)                                 |
| 502                   | `fallo_modelo`                                                 | OpenRouter falló en el principal y en el respaldo                                       |
| 503                   | `no_disponible`                                                | Falta `OPENROUTER_API_KEY`, o OpenRouter respondió 401, 402 o 403                       |
| 504                   | `tiempo`                                                       | Pasaron 55 s, o la señal de tiempo se cortó en una llamada                              |
| 500                   | `error_interno`                                                | Error inesperado o respuesta malformada de la RPC                                       |

## Flujo

1. `preludio` (CORS, método, Bearer, `getUser`, tamaño) y validación del cuerpo.
2. Sin `OPENROUTER_API_KEY`: 503 sin reservar cupo.
3. `asistente_reservar` (RPC con el JWT del usuario). Sin cupo: 429.
4. Bucle: hasta 8 vueltas, hasta 6 llamadas a tools. Al agotar las 6, la vuelta siguiente va con `tool_choice: none`.
5. `asistente_cerrar` siempre que se reservó cupo (ok o error). Si falla, solo queda en el log (`cerrar_fallo`).

## Modelos y respaldo

- Principal: `nvidia/nemotron-3-ultra-550b-a55b:free`. Respaldo: `deepseek/deepseek-v4.1-flash`.
- El respaldo es pegajoso dentro de una pregunta: tras un fallo del principal, las vueltas siguientes van directo al
  respaldo. Cada pregunta tiene su propio cliente (`Deps.modelo` es una fábrica).
- El principal pasa al respaldo ante 404, 429, 502, 503, código no numérico o error de red, y ante cualquier otro código
  distinto de 400, 401, 402 y 403. Un 400 no reintenta; un 401, 402 o 403 cierra con `no_disponible`.
- La variante de pago `nvidia/nemotron-3-ultra-550b-a55b` nunca se usa. Un principal sin `:free` cae al por defecto con
  el aviso `modelo_principal_sin_free`.

## Variables de entorno

| Variable                            | Uso                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | PostgREST y Auth, con el JWT del usuario                                           |
| `ALLOWED_ORIGINS`                   | Orígenes del panel separados por comas. Vacía: se deniega todo origen de navegador |
| `OPENROUTER_API_KEY`                | Secreto de la función. Si falta, toda pregunta responde 503                        |
| `ASISTENTE_MODELO`                  | Opcional. Principal (debe terminar en `:free`)                                     |
| `ASISTENTE_MODELO_RESPALDO`         | Opcional. Respaldo                                                                 |

La función **no lee la clave de servicio**: todo el acceso a datos pasa por la RLS y los privilegios por columna con el
JWT del usuario. Una prueba falla si algún `.ts` de la carpeta la menciona.

## Archivos

- `handler.ts`: el bucle, con dependencias inyectadas (`Deps`). Sin I/O propio.
- `openrouter.ts`: cliente de OpenRouter con respaldo y `elegirModelos`.
- `rest.ts`: PostgREST y Auth con `fetch`.
- `deps.ts`: cableado real desde el entorno. `index.ts` solo arranca el servidor.
- `servidor_e2e.ts`: arnés de las pruebas e2e. Usa el handler real, PostgREST real y un modelo guionado (ver abajo).
- `catalogo.ts`, `contrato.ts`: catálogo de tools y contrato compartido (los mantiene la tarea del catálogo).

## Pruebas

```
deno task --config supabase/functions/deno.json check
deno task --config supabase/functions/deno.json test
```

Las pruebas usan dobles de `fetch`, Auth, PostgREST y el modelo. Ninguna llama a OpenRouter.

El arnés e2e se levanta con `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `ALLOWED_ORIGINS`:

```
deno run --allow-net --allow-env supabase/functions/asistente-reportes/servidor_e2e.ts
```

Imprime `LISTO <puerto>`. El modelo guionado pide una tool por cada marca `[[tool:NOMBRE {json}]]` del último mensaje
del usuario, y con resultados de tools responde con una línea `NOMBRE: contenido` por cada uno.
