-- Activar flags en Supabase (producción)
-- 1) Ver sucursales y estado actual
SELECT id, name, is_active, usa_catalogo_global
FROM public.branches
ORDER BY name;

-- 2) Catálogo global: activar en TODAS las sucursales activas
-- (Descomenta y Run SOLO si quieres el catálogo global en todas)
/*
UPDATE public.branches
SET usa_catalogo_global = true
WHERE is_active = true;
*/

-- 3) O activar solo en sucursales concretas (cambia el nombre):
/*
UPDATE public.branches
SET usa_catalogo_global = true
WHERE name IN ('El Pulpo 1', 'El Pulpo 2');
*/

-- 4) Verificar cola operativa RPC responde (debe devolver json, no error)
SELECT public.get_operational_queue(
  (SELECT id FROM public.branches WHERE is_active = true ORDER BY name LIMIT 1),
  NULL,
  'dispatch',
  false
) IS NOT NULL AS rpc_ok;
