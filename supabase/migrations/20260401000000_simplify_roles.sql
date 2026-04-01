-- Migración: Simplificación de roles a 3 tipos unificados
-- 1. Administrador Global (Global)
-- 2. Supervisor de Sucursal (Branch)
-- 3. Usuario Operativo (Branch)

BEGIN;

-- 1. Asegurar nombres actualizados para roles existentes
UPDATE public.roles SET name = 'Administrador Global' WHERE code = 'administrador';
UPDATE public.roles SET name = 'Supervisor de Sucursal' WHERE code = 'supervisor';

-- 2. Crear/Actualizar el rol consolidado "Usuario Operativo"
INSERT INTO public.roles (code, name, scope)
VALUES ('usuario_operativo', 'Usuario Operativo', 'BRANCH')
ON CONFLICT (code) DO UPDATE SET name = 'Usuario Operativo', is_active = true;

-- 3. Migrar asignaciones de roles obsoletos al nuevo rol "usuario_operativo"
WITH obsolete_roles AS (
  SELECT id FROM public.roles WHERE code IN ('mesero', 'cajero', 'despachador', 'despachador_mesas', 'despachador_para_llevar')
), new_role AS (
  SELECT id FROM public.roles WHERE code = 'usuario_operativo'
)
UPDATE public.user_branch_roles
SET role_id = (SELECT id FROM new_role)
WHERE role_id IN (SELECT id FROM obsolete_roles);

-- 4. Desactivar roles obsoletos
UPDATE public.roles 
SET is_active = false 
WHERE code IN ('mesero', 'cajero', 'despachador', 'despachador_mesas', 'despachador_para_llevar');

-- 5. Configurar Permisos Consolidados para "Usuario Operativo"
-- Queremos que tenga permisos de OPERATE en Mesas, Pedidos, Despacho y Caja.
DELETE FROM public.role_permissions 
WHERE role_id = (SELECT id FROM public.roles WHERE code = 'usuario_operativo');

INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'usuario_operativo'),
  m.id,
  CASE 
    WHEN m.code IN ('mesas', 'ordenes', 'despacho_mesa', 'despacho_para_llevar', 'caja') THEN 'OPERATE'::public.access_level
    ELSE 'VIEW'::public.access_level
  END
FROM public.modules m
WHERE m.code IN ('mesas', 'ordenes', 'despacho_mesa', 'despacho_para_llevar', 'caja', 'reportes_sucursal');

-- 6. Asegurar Permisos para "Supervisor de Sucursal" (Operación + Gestión)
DELETE FROM public.role_permissions 
WHERE role_id = (SELECT id FROM public.roles WHERE code = 'supervisor');

INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'supervisor'),
  m.id,
  CASE 
    WHEN m.code = 'admin_sucursal' THEN 'MANAGE'::public.access_level
    WHEN m.code IN ('mesas', 'ordenes', 'despacho_mesa', 'despacho_para_llevar', 'caja', 'reportes_sucursal') THEN 'OPERATE'::public.access_level
    ELSE 'VIEW'::public.access_level
  END
FROM public.modules m;

COMMIT;
