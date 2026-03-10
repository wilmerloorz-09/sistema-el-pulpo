# System Context

## Resumen Ejecutivo
- Sistema POS multi-sucursal para restaurante.
- La autorizacion vigente ya no se basa en `if role === ...`; ahora se evalua por `usuario + sucursal activa + permisos efectivos por modulo`.
- Un usuario puede tener multiples roles en la misma sucursal y en multiples sucursales.
- El usuario solo opera una sucursal activa por sesion.
- El backend sigue siendo la fuente real de autorizacion; el frontend solo refleja permisos.
- El superadmin/administrador inicial sigue protegido en el flujo normal.

## Estado Funcional Vigente
### Acceso y autorizacion
- El modelo actual usa permisos por modulo con niveles:
  - `NONE`
  - `VIEW`
  - `OPERATE`
  - `MANAGE`
- Roles base sembrados:
  - `administrador`
  - `supervisor`
  - `mesero`
  - `despachador`
  - `despachador_mesas`
  - `despachador_para_llevar`
  - `cajero`
- `administrador` es global.
- Los demas roles son por sucursal.
- Los permisos se resuelven desde la sucursal activa.

### Reglas operativas clave
- Un usuario puede tener varias asignaciones `usuario + sucursal + rol`.
- Se permite multirol en la misma sucursal.
- La sucursal activa vive en `profiles.active_branch_id`.
- Todas las consultas operativas deben filtrar por sucursal activa.
- `despacho_total` se trata como vista consolidada; no debe duplicar logica de escritura.

### Modo consulta por modulo
- El frontend ya diferencia `VIEW` vs `OPERATE`.
- `mesero` puede entrar a despacho, pero en modo consulta.
- `VIEW` ya fue endurecido en:
  - `despacho`
  - `ordenes`
  - `mesas`
  - `caja`

### Cancelaciones
- Las cancelaciones parciales ya descuentan cantidades visibles en:
  - `Ordenes`
  - `Despacho`
- La pestana `Canceladas` del modulo ordenes ya incluye:
  - cancelaciones totales
  - cancelaciones parciales aplicadas

### Caja
- La apertura de caja sigue solicitando desglose por denominacion.
- Si no existen denominaciones en la sucursal activa, el formulario avisa y bloquea apertura.
- El resumen de caja muestra:
  - `Apertura`
  - `Actual`

## Cambios Relevantes Ya Realizados
### Refactor de usuarios, roles y permisos
- Se reemplazo el modelo hibrido viejo por un modelo centralizado de roles y permisos.
- Se dejo de depender operativamente de `user_roles` legacy para navegacion diaria.
- Se incorporo multirol por sucursal.

### Frontend
- `AuthContext` y `BranchContext` ya trabajan con permisos efectivos.
- `ProtectedRoute` y `BottomNav` ya usan permisos por modulo.
- `UsersCrud` ya administra asignaciones `usuario + sucursal + rol`.
- `ChangePasswordDialog` ya usa el flujo nuevo de cambio de contrasena.

### Edge Functions
- `create-user` ya usa el modelo nuevo.
- `login-with-identifier` se conserva para login por email o username.
- `update-password` ya funciona con el modelo nuevo y validacion manual de token.
- `clone-branch-catalog` fue alineada al modelo nuevo de admin global.

## Deploy y Operacion Remota
### Proyecto remoto realmente usado
- Los despliegues se estan haciendo contra el proyecto Supabase:
  - `apmsuigcveqtjzbpfihb`
- No confiar ciegamente en `project_id` de `supabase/config.toml` para despliegue; usar `--project-ref` en CLI cuando haga falta.

### Edge Functions con `verify_jwt = false`
- `create-user`
- `login-with-identifier`
- `reset-users`
- `update-password`
- `clone-branch-catalog`
- `webauthn-register`
- `webauthn-authenticate`

### Importante
- Cuando se cambie una Edge Function, hay que redeployarla manualmente.
- Cuando se cambie `supabase/config.toml`, tambien hay que redeployar la funcion afectada para que tome la configuracion nueva.

## Checklist de Continuidad
1. Aplicar migraciones pendientes en Supabase antes de probar frontend.
2. Redeploy de Edge Functions tocadas.
3. Validar login.
4. Validar cambio de sucursal activa.
5. Validar cambio de contrasena.
6. Validar crear usuario y asignar multiples roles en la misma sucursal.
7. Validar `VIEW` vs `OPERATE` en ordenes, despacho, mesas y caja.
