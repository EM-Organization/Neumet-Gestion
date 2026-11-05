# Auditoria RLS de NEUMET

## Ejecucion
1. Supabase Dashboard > SQL Editor.
2. Pegar `rls_audit.sql` y ejecutar consulta por consulta (todas son de solo lectura).
3. Cada consulta documenta en su comentario que implica un resultado no vacio.

## Interpretacion
- Consultas 1, 3, 4, 5, 5b, 6, 8: un resultado no vacio es hallazgo salvo justificacion documentada.
- Consulta 2: puede ser intencional (tabla solo accesible por service_role).
- Consulta 7: revisar cada usuario; si el rol admin se infiere por no estar en `clientes`, un usuario huerfano es admin de facto. Preferir un claim o tabla explicita de roles.
- Consulta 9: informativa.

## Pruebas manuales por rol
Placeholders: `PROJECT_URL` (https://dqgrlflrjcarxlfetvoj.supabase.co), `ANON_KEY` (clave publica anon). Obtener los `JWT_*` con login por `/auth/v1/token?grant_type=password`. No guardar claves reales en el repo.

```bash
# anon: debe devolver [] o 401/403 en tablas privadas
curl -s "$PROJECT_URL/rest/v1/clientes?select=*" -H "apikey: $ANON_KEY"

# cliente A: solo sus filas
curl -s "$PROJECT_URL/rest/v1/mediciones?select=*&limit=5" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_CLIENTE_A"

# cliente A intentando leer datos del cliente B: debe devolver []
curl -s "$PROJECT_URL/rest/v1/mediciones?cliente_id=eq.$ID_CLIENTE_B" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_CLIENTE_A"

# cliente A intentando escribir en nombre de B: debe fallar (401/403/RLS)
curl -s -X POST "$PROJECT_URL/rest/v1/mediciones" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_CLIENTE_A" \
  -H "Content-Type: application/json" -d "{\"cliente_id\":\"$ID_CLIENTE_B\"}"

# cliente B: repetir lo anterior invirtiendo roles

# admin: debe ver todo
curl -s "$PROJECT_URL/rest/v1/clientes?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_ADMIN"
```

| Prueba | anon | cliente A | cliente B | admin |
|---|---|---|---|---|
| Leer clientes | denegado | solo propio | solo propio | todo |
| Leer mediciones propias | denegado | OK | OK | OK |
| Leer mediciones ajenas | denegado | vacio | vacio | OK |
| Insertar con cliente_id ajeno | denegado | denegado | denegado | segun diseno |
| Llamar RPC SECURITY DEFINER | denegado | segun diseno | segun diseno | OK |
