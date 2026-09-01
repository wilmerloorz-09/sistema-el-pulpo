-- Fix 404 con sesión iniciada (rol authenticated): permisos por firma de función
-- Ejecutar TODO en SQL Editor

-- Ver permisos actuales
SELECT
  routine_name,
  grantee,
  privilege_type,
  specific_name
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'get_operational_queue'
ORDER BY grantee, specific_name;

-- Asegurar EXECUTE en TODAS las firmas (4 params y 3 params si existe el wrapper)
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_operational_queue'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    RAISE NOTICE 'Granted: %', fn;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verificar de nuevo
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'get_operational_queue'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee;
