-- Fix: get_my_auxiliary_cash_assignment no debe escribir (era STABLE + ensure).
-- Eso podía fallar en el cliente y dejar isAssigned=false, ocultando el menú de cambios.

CREATE OR REPLACE FUNCTION public.get_my_auxiliary_cash_assignment(p_branch_id uuid)
RETURNS TABLE (
  shift_id uuid,
  is_assigned boolean,
  opening_id uuid,
  opening_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cs.id,
    true,
    NULL::uuid,
    'abierta'::text
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  ORDER BY cs.opened_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_auxiliary_cash_assignment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
