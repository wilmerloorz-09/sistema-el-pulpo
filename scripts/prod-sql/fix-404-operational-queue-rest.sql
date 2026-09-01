-- Fix 404 en REST: get_operational_queue existe en SQL pero PostgREST no la ve
-- Ejecutar TODO en SQL Editor y luego recargar schema en Dashboard (paso manual abajo)

-- 1) Permisos (PostgREST devuelve 404 si el rol no puede EXECUTE)
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, uuid, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, uuid, text, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION public.order_treat_as_fully_paid_for_queue(text, timestamptz, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_queue_item_dispatchable(integer, integer, integer, integer, integer, integer, integer, boolean, boolean) TO authenticated;

-- 2) Confirmar que authenticated puede ejecutar
SELECT
  has_function_privilege(
    'authenticated',
    'public.get_operational_queue(uuid, uuid, text, boolean)',
    'EXECUTE'
  ) AS authenticated_ok;

-- 3) Forzar recarga de caché PostgREST
NOTIFY pgrst, 'reload schema';

-- 4) Probar de nuevo (debe devolver 'object')
SELECT jsonb_typeof(
  public.get_operational_queue(
    (SELECT id FROM public.branches WHERE is_active = true ORDER BY name LIMIT 1),
    (SELECT id FROM public.cash_shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1),
    'dispatch',
    false
  )
) AS tipo_respuesta;
