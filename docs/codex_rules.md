# Codex Rules

## Objetivo
Estas reglas dejan continuidad practica para futuras sesiones y para trabajar desde otra computadora sin perder el estado real del proyecto.

## Reglas Obligatorias
### 1. No volver al modelo viejo de permisos
- No introducir logica tipo `if role === 'MESERO'`.
- No usar `user_branch_modules` como fuente primaria nueva.
- No asumir que `user_roles` legacy define autorizacion operativa.

### 2. Toda autorizacion sensible va por backend/BD
- Usar `is_global_admin(...)`.
- Usar `has_branch_permission(...)`.
- Si se crea una nueva RPC o Edge Function, debe validar permisos reales.

### 3. Si se toca una Edge Function, revisar tambien `supabase/config.toml`
- Ya paso un caso real con `update-password`: la funcion estaba bien, pero faltaba `verify_jwt = false`.
- Si una funcion usa validacion manual del bearer token, documentarlo y desplegarla otra vez.

### 4. Si se toca frontend operativo, respetar `VIEW`
- `VIEW` no es ocultar por completo si el modulo debe ser visible.
- `VIEW` significa entrar y ver, pero no ejecutar acciones operativas.
- Esto ya esta aplicado en `mesas`, `ordenes`, `despacho` y `caja`.

### 5. Si se toca cancelaciones, probar ambas vistas
- `Ordenes`
- `Despacho`

Tambien probar:
- cancelacion parcial
- cancelacion total
- pestana `Canceladas`

### 6. Si se toca caja, probar denominaciones y apertura de turno
- La ausencia de denominaciones debe mostrarse claro.
- El desglose de apertura no debe perderse.
- Validar tambien RLS de caja.

## Criterios de Trabajo
### Antes de empezar una tarea
1. Leer estos cuatro docs.
2. Identificar si el cambio impacta:
   - migraciones
   - RLS
   - RPC
   - Edge Functions
   - frontend
3. No hacer cambios solo en UI cuando el problema es de backend o policy.

### Al terminar una tarea
1. Si cambiaste frontend, correr `npm run build`.
2. Si cambiaste una Edge Function, recordar deploy manual.
3. Si cambiaste config de funciones, recordar redeploy.
4. Si cambiaste BD, dejar migracion incremental si el usuario ya aplico la anterior.

## Estado que debe preservarse
- Multirol por misma sucursal ya soportado.
- Cambio de contrasena por admin ya funcionando.
- Duplicacion de catalogo alineada al modelo nuevo.
- Login por email o username funcionando.
- Contexto por sucursal activa vigente.
- Historial y auditoria no deben perderse.

## Deploy Manual Relevante
Cuando se toquen estas funciones, normalmente hay que redeployarlas:
- `create-user`
- `clone-branch-catalog`
- `update-password`
- `login-with-identifier`
- `webauthn-register`
- `webauthn-authenticate`

Comando de referencia:
```powershell
npx supabase functions deploy <function-name> --project-ref apmsuigcveqtjzbpfihb
```

## Senales de diagnostico rapidas
### Si aparece `401` en Edge Function
- Revisar `verify_jwt = false` si la funcion usa validacion manual.
- Revisar bearer token.
- Revisar redeploy de la funcion.

### Si aparece error RLS
- Revisar si esa tabla sigue con policies legacy.
- Revisar sucursal activa.
- Revisar permisos efectivos del usuario.

### Si la UI no refleja cambios de cancelacion
- Revisar hooks de ordenes y despacho.
- Revisar si la vista usa cantidad activa o cantidad original.

## Regla final
- El sistema ya no esta en etapa de inventar arquitectura base.
- A partir de aqui, los cambios deben ser refactor incremental, compatible y orientado a produccion.
