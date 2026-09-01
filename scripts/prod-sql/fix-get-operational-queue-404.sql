-- Diagnóstico 404 get_operational_queue
-- Pegar en SQL Editor y Run

-- 1) ¿Existe la función con la firma correcta?
SELECT
  p.proname AS funcion,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede_ejecutar
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_operational_queue';

-- Si la consulta anterior NO devuelve filas → volver a ejecutar lote-06 completo.

-- 2) Recargar caché de PostgREST (muy común tras crear RPCs)
NOTIFY pgrst, 'reload schema';

-- 3) Probar la RPC directamente en SQL (debe devolver json, no error)
SELECT jsonb_typeof(
  public.get_operational_queue(
    (SELECT id FROM public.branches WHERE is_active = true ORDER BY name LIMIT 1),
    (SELECT id FROM public.cash_shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1),
    'dispatch',
    false
  )
) AS tipo_respuesta;
