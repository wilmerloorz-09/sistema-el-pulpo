# System Context

## Resumen Ejecutivo
- Sistema POS multi-sucursal con acceso operativo por módulos.
- Un usuario puede tener varias sucursales habilitadas, pero solo una sucursal activa.
- El acceso real se define por `usuario + sucursal + módulo`.
- Superadmin inicial protegido en operación normal.
- Login soporta correo y username.
- Existe proceso excepcional de reset total de usuarios.

## Guía Operativa
### Usuarios y permisos
- Perfil administrativo: jerarquía (`admin`, `superadmin`, `supervisor`).
- Operación diaria: módulos por sucursal (`mesas`, `ordenes`, `despacho`, `caja`, `pagos`, `reportes`, `usuarios`, `sucursales`, `configuracion`).
- Puede usarse plantilla operativa para asignación rápida de módulos.

### Sucursales
- Usuario puede operar en múltiples sucursales habilitadas.
- Solo una sucursal activa por sesión/operación.
- Cambios de sucursal activa y habilitaciones quedan en historial.

### Pagos
- Pago completo.
- Pago parcial por persona.
- Pago por ítem.
- Pago por cantidad de ítem.
- Pago mixto con múltiples métodos en una misma transacción.
- Regla: suma de métodos = total del pago.

## Detalle Técnico
### Backend/BD
- RPC principales: `assign_user_branch`, `remove_user_branch`, `set_user_active_branch`, `upsert_user_branch_module`.
- Historial: `user_branch_change_history`, `user_module_change_history`.
- Protección superadmin por triggers y validaciones en BD.

### Edge Functions
- `create-user`: crea usuario, exige rol+sucursal, asigna sucursal activa y módulos iniciales.
- `login-with-identifier`: login con email o username.
- `reset-users`: reset excepcional con controles de seguridad.

## Checklist de Despliegue
1. Aplicar migraciones SQL pendientes en orden.
2. Deploy de Edge Functions (`create-user`, `login-with-identifier`, `reset-users`).
3. Verificar secretos de funciones.
4. Validar login por email/username.
5. Validar visibilidad de módulos por sucursal activa.
6. Validar historial de cambios de sucursal y módulos.
