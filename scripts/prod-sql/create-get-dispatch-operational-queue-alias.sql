-- Alias RPC: PostgREST a veces no expone get_operational_queue aunque exista en pg_proc.
-- El cliente llamará get_dispatch_operational_queue (misma lógica).

CREATE OR REPLACE FUNCTION public.get_dispatch_operational_queue(
  p_branch_id uuid,
  p_shift_id uuid DEFAULT NULL,
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
    p_shift_id,
    p_module,
    p_run_repair
  );
$$;

REVOKE ALL ON FUNCTION public.get_dispatch_operational_queue(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dispatch_operational_queue(uuid, uuid, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dispatch_operational_queue(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dispatch_operational_queue(uuid, uuid, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
