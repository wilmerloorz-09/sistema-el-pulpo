# Database Architecture

## Resumen Ejecutivo
- PostgreSQL (Supabase) con modelo multi-sucursal.
- Acceso operativo por `user_branch_modules`.
- Sucursal activa en `profiles.active_branch_id`.
- Historial obligatorio para cambios de sucursal y módulos.

## Guía Operativa
### Tablas de acceso
- `profiles`: estado de usuario, sucursal activa, protección de superadmin.
- `user_roles`: jerarquía administrativa.
- `branches`: catálogo de sucursales.
- `user_branches`: habilitación de sucursales por usuario.
- `modules`: catálogo de módulos.
- `user_branch_modules`: permisos por usuario+sucursal+módulo.

### Historial y auditoría
- `user_branch_change_history`.
- `user_module_change_history`.
- `audit_log`.

## Detalle Técnico
### Reglas de integridad
1. Sucursal activa debe estar en sucursales habilitadas del usuario.
2. `ON CONFLICT` requiere constraints/índices consistentes.
3. RLS aplicada en tablas sensibles.

### Protección superadmin inicial
- Bloqueo de delete.
- Bloqueo de desactivación.
- Bloqueo de degradación.
- Bloqueo de retiro de módulos críticos.

### Login email/username
- `profiles.email` soporta resolución de username en login.

### Reset excepcional
- Proceso controlado para eliminar usuarios actuales y bootstrap de nuevo superadmin.

### Pagos
- Soporte de pago completo/parcial/mixto.
- Regla contable: suma de métodos = total de pago.

## Checklist de Despliegue
1. Verificar policies RLS de `profiles`, `user_roles`, `user_branches`, `user_branch_modules`.
2. Verificar RPC grants.
3. Verificar historial activo (inserciones en tablas de history).
4. Verificar módulos por rol/base en usuarios existentes (backfill cuando aplique).
