# Project Architecture

## Resumen Ejecutivo
- La arquitectura actual separa identidad, asignacion y autorizacion.
- La autorizacion ya no depende de checks hardcodeados por rol en el frontend.
- El modelo activo se apoya en permisos por modulo y nivel de acceso.
- La base de datos y las Edge Functions siguen concentrando las validaciones sensibles.

## Arquitectura Funcional Vigente
### Capa de identidad
- `profiles`
- autenticacion Supabase
- login por email o username via `login-with-identifier`

### Capa de asignacion
- `branches`
- `user_branch_roles`
- `user_global_roles`
- `profiles.active_branch_id`

### Capa de autorizacion
- `roles`
- `modules`
- `role_permissions`
- `v_user_effective_permissions`
- `has_branch_permission(...)`
- `is_global_admin(...)`

## Flujo de Sesion
1. Login via `login-with-identifier`.
2. `supabase.auth.setSession(...)`.
3. Carga de `profile`.
4. Carga de contexto de sucursal activa y permisos efectivos.
5. Navegacion y acciones filtradas por permisos.

## Frontend
### Contextos y control
- `AuthContext` maneja sesion y profile.
- `BranchContext` resuelve sucursal activa y permisos efectivos.
- `ProtectedRoute` protege por modulo+nivel.
- `BottomNav` renderiza modulos visibles segun permisos.

### Helpers
- `hasPermission(module, level)`
- `canView(module)`
- `canOperate(module)`
- `canManage(module)`

### Pantallas impactadas
- `Admin`
- `UsersCrud`
- `Mesas`
- `Ordenes`
- `Despacho`
- `Caja`
- `ChangePasswordDialog`

## Backend y Edge Functions
### RPC y funciones clave
- `assign_user_branch_role`
- `remove_user_branch_role`
- `assign_user_global_role`
- `remove_user_global_role`
- `set_user_active_branch`
- `admin_list_users_access`
- `admin_list_access_catalog`
- `is_global_admin`
- `has_branch_permission`

### Edge Functions activas del proyecto
- `create-user`
- `login-with-identifier`
- `reset-users`
- `update-password`
- `clone-branch-catalog`
- `webauthn-register`
- `webauthn-authenticate`

### Criterio actual para funciones
- Las funciones administrativas y de autenticacion del proyecto quedaron homologadas para no depender del gateway JWT.
- Se usa `verify_jwt = false` y luego validacion manual interna del bearer token cuando corresponde.
- El patron recomendado es:
  - obtener `Authorization`
  - extraer bearer token
  - validar con `adminClient.auth.getUser(bearerToken)`
  - resolver permisos con RPCs nuevas

## Seguridad
### Reglas vigentes
- No confiar en la UI para seguridad.
- El backend siempre valida permisos efectivos.
- RLS sigue siendo obligatoria en tablas sensibles.
- Los CRUD administrativos deben validar:
  - `is_global_admin(...)`
  - o permisos `admin_sucursal/admin_global` segun caso

### Cambio importante ya resuelto
- `update-password` tenia un `401` persistente porque no estaba alineada con el patron de `verify_jwt = false`.
- Eso ya quedo documentado y resuelto.

## Modulos y niveles
### Modulos
- `mesas`
- `ordenes`
- `despacho_mesa`
- `despacho_para_llevar`
- `despacho_total`
- `caja`
- `admin_sucursal`
- `admin_global`
- `reportes_sucursal`
- `reportes_globales`

### Niveles
- `NONE`
- `VIEW`
- `OPERATE`
- `MANAGE`

## Checklist de Arquitectura para nuevas tareas
1. Si se toca permisos, revisar BD + RPC + UI.
2. Si se toca una Edge Function, revisar tambien `supabase/config.toml`.
3. Si se toca una pantalla operativa, verificar modo `VIEW`.
4. Si se toca cancelaciones, verificar ordenes y despacho.
5. Si se toca caja, verificar denominaciones y RLS.
