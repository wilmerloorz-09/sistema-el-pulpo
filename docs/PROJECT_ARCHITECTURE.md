# Project Architecture

## Resumen Ejecutivo
- Arquitectura orientada a módulos por sucursal.
- Separación explícita entre jerarquía administrativa y acceso operativo.
- Validación crítica en backend/BD (no solo frontend).
- Trazabilidad obligatoria en cambios de permisos/sucursales.

## Guía Operativa
### Flujo de administración de usuarios
1. Crear usuario con rol y al menos una sucursal.
2. Definir sucursal activa.
3. Ajustar módulos por sucursal.
4. Usar perfil operativo (plantilla) para acelerar asignación.

### Flujo de navegación
- `BranchContext` carga sucursal activa y módulos permitidos.
- `ProtectedRoute` restringe vistas por módulos.
- `BottomNav` muestra solo módulos habilitados.

## Detalle Técnico
### Frontend
- Contextos: `AuthContext`, `BranchContext`.
- Pantallas clave: Administración de Usuarios, Sucursales, Permisos por módulo.
- Control visual alineado a `allowedModules` de sucursal activa.

### Backend
- Supabase RPC para operaciones de acceso y sucursal.
- Edge Functions para crear usuario, login flexible y reset excepcional.

### Seguridad
- RLS + funciones `SECURITY DEFINER`.
- Protección de superadmin inicial en operación normal.

## Checklist de Despliegue
1. Migraciones aplicadas y verificadas.
2. Edge Functions desplegadas.
3. `verify_jwt` configurado según función.
4. Pruebas de CRUD de usuario, roles administrativos, sucursales y módulos.
5. Pruebas de pagos parciales/mixtos y consistencia de totales.
