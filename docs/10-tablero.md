# 10 · Tablero del proyecto

> Actualizado: 2026-11-06 (director de proyecto). Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su worktree → PR con tests → revisor (agente "PR Reviewer") comenta y fusiona → el director aplica migraciones/despliega.

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase **nuevo** `kootszosdejmawanfxug` | Esquema inicial **aplicado y verificado** (10 tablas, RLS en todas, 0 grants a `anon`) |
| Proyecto Supabase heredado `dqgrlflrjcarxlfetvoj` | El frontend desplegado aún apunta a este; **cutover pendiente** |
| Vercel `neumet-gestion-theta.vercel.app` | Desplegado desde `main`; CSP sin `unsafe-inline` en scripts |
| CI (GitHub Actions) | gitleaks, lint, static, deno; `test` y `sql` en camino |

## Hecho (fusionado en `main`)
- Auditoría, plan de despliegue, identidad visual aplicada, endurecimiento del panel (XSS, SRI), CSP, `.vercelignore`.
- Esquema SQL inicial con RLS/roles/auditoría (PR #12), aplicado a `kootszos…`.
- Benchmark de plataformas y backlog (PR #13) → `09-benchmark-gestion-neumaticos.md`.
- Diseño y contrato de la API de proveedor (PR #10, #11).

## En curso
| Frente | Rama | Depende de |
|---|---|---|
| Panel en módulos ES + tests unitarios + URL configurable | `refactor/panel-es-modules` | — |
| API de proveedor (login, obtener/guardar montaje) | `feat/api-proveedor` | esquema (aplicado) |
| `crear-cliente` (admin, invitación) | `feat/crear-cliente` | esquema (aplicado) |
| Vistas SQL, odómetro, ciclo de vida, umbrales por cliente | `feat/db-producto` | esquema (aplicado) |

## Siguiente (se lanza al fusionar lo anterior)
| Ítem del backlog | Notas |
|---|---|
| 1 · Panel de flota con prioridades · 2 · Centro de alertas · 8 · predicción · 9 · desgaste irregular | usan `v_estado_neumaticos`/`v_alertas` |
| 3 · Reportes exportables · 4 · Vista de cliente mejorada | |
| 5 · Salud de dispositivos · 6 · Captura de km · 7 · Ciclo de vida (UI) | usan `v_salud_dispositivos`, `eventos_neumatico` |
| Baja lógica de clientes en el panel · mínimo de contraseña 12 | RPC `cliente_eliminar_suave` |
| Cutover del frontend a `kootszos…` (URL + clave publishable + CSP `connect-src`) | requiere funciones desplegadas y primer admin |
| Despliegue de funciones (`contacto`, `crear-cliente`, `api-proveedor`) | lo hace el director con el MCP |

## Acciones manuales del dueño (dashboard de Supabase)
1. Crear el usuario administrador (Authentication → Users → Add user) → el director registra su rol en `perfiles`.
2. Desactivar **Allow new users to sign up**.
3. Secrets de `contacto`: `RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`; de `crear-cliente`: `ALLOWED_ORIGINS`.
4. (Opcional) MFA para admins.

## Fuera de alcance de la primera versión (siguiente iteración)
CPK, reencauche, presión/temperatura (TPMS): dependen de odómetro y eventos reales acumulados.

## Riesgos abiertos
- Orden físico de `mm1..mm4` (interno/externo) sin confirmar con la app de DAC (una constante en el código).
- Avisos del linter de Supabase: 4 WARN `SECURITY DEFINER` ejecutables por `authenticated` (intencionales; mover helpers a esquema privado más adelante).
- Sin probar con sesión real y datos reales de punta a punta.
