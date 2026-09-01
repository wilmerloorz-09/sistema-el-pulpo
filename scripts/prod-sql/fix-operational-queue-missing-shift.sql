-- Fix 404 PGRST202: PostgREST no encuentra la RPC si el cliente no envía p_shift_id.
-- Ejecutar en SQL Editor (efecto inmediato, sin redeploy de Vercel).

CREATE OR REPLACE FUNCTION public.get_operational_queue(
  p_branch_id uuid,
  p_module text DEFAULT 'dispatch',
  p_run_repair boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_operational_queue(
    p_branch_id,
    NULL::uuid,
    p_module,
    p_run_repair
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_queue(uuid, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
