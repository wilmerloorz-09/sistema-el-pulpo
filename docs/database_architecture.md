# Database Architecture

## Resumen Ejecutivo
- PostgreSQL en Supabase con modelo multi-sucursal.
- El modelo vigente de acceso ya no es `user_branch_modules` como fuente primaria.
- La autorizacion principal ahora se resuelve con:
  - `roles`
  - `role_permissions`
  - `user_branch_roles`
  - `user_global_roles`
- `profiles.active_branch_id` sigue siendo el pivote operativo de la sesion.

## Modelo Vigente de Acceso
### Tablas principales
- `profiles`
- `branches`
- `modules`
- `roles`
- `role_permissions`
- `user_branch_roles`
- `user_global_roles`

### Legacy que aun puede existir
- `user_roles`
- `user_branches`
- `user_branch_modules`

Importante:
- Esas tablas legacy pueden seguir existiendo por compatibilidad o migraciones previas.
- No deben usarse como fuente primaria de autorizacion nueva.

## Reglas de Integridad
### Asignaciones
- Una asignacion de sucursal vincula:
  - `user_id`
  - `branch_id`
  - `role_id`
- Ya se permite multirol en la misma sucursal.
- La unicidad vigente esperada es `user + sucursal + rol`, no `user + sucursal`.

### Sucursal activa
- `profiles.active_branch_id` debe ser una sucursal accesible para el usuario.
- No se debe permitir sucursal activa inactiva.

### Permisos efectivos
- Los permisos efectivos se calculan desde la matriz de `role_permissions`.
- El admin global puede operar transversalmente.
- El resto de usuarios se evalua por la sucursal activa.

## Funciones y vistas relevantes
### RPC / funciones
- `is_global_admin(uuid)`
- `has_branch_permission(user_id, branch_id, module_code, access_level)`
- `assign_user_branch_role(...)`
- `remove_user_branch_role(...)`
- `assign_user_global_role(...)`
- `remove_user_global_role(...)`
- `set_user_active_branch(...)`
- `admin_list_users_access()`
- `admin_list_access_catalog()`

### Vistas
- `v_user_effective_permissions`
- posibles vistas legacy de compatibilidad si siguen presentes

## Migraciones clave ya aplicadas o creadas
- `20260310100000_refactor_branch_roles_permissions_v1.sql`
- `20260310130000_allow_multi_roles_same_branch.sql`
- `20260310143000_fix_admin_crud_rls_for_new_permissions.sql`
- `20260310170000_fix_cash_rls_for_new_permissions.sql`
- `20260310183000_replace_cash_rls_policies.sql`

## RLS y Politicas
### Administracion
- Los CRUD administrativos importantes ya fueron migrados para usar el modelo nuevo.
- No asumir que `has_role('admin')` sigue siendo suficiente.

### Caja
- `cash_shifts`
- `cash_shift_denoms`
- `cash_movements`

Estas tablas ya fueron revisadas para operar con permisos efectivos de caja o administracion.

### Recomendacion obligatoria
- Si un CRUD sensible da error RLS, revisar primero si la policy sigue en modelo viejo.

## Cancelaciones y ordenes
### Estado actual
- La representacion visual de cantidades activas ya descuenta cancelaciones parciales.
- Eso se reflejo en frontend, pero depende de que la BD siga registrando bien:
  - `order_cancellations`
  - `order_item_cancellations`

### Pestana Canceladas
- Debe incluir ordenes con cancelaciones aplicadas aunque el estado global no sea `CANCELLED`.

## Caja y denominaciones
### Reglas vigentes
- Si no hay denominaciones activas en la sucursal, no se puede abrir turno con desglose.
- El formulario de apertura depende de datos reales en `denominations`.

## Reset y bootstrap
- `reset-users` sigue siendo excepcional.
- No usarlo como flujo normal administrativo.

## Checklist BD
1. Antes de tocar permisos, revisar migraciones de marzo 2026.
2. Antes de tocar RLS, validar si la tabla sigue en modelo viejo o nuevo.
3. Antes de tocar caja, revisar `cash_shifts`, `cash_shift_denoms`, `cash_movements`, `denominations`.
4. Antes de tocar usuarios, revisar `user_branch_roles`, `user_global_roles`, `profiles.active_branch_id`.
