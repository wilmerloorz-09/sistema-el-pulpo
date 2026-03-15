CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate(
  p_branch_id uuid
)
RETURNS TABLE (
  shift_id uuid,
  shift_open boolean,
  user_enabled boolean,
  active_tables_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_active_tables_count integer := 0;
  v_user_enabled boolean := false;
  v_shift_user_count integer := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0;
    RETURN;
  END IF;

  SELECT cs.id, COALESCE(cs.active_tables_count, 0)
  INTO v_shift_id, v_active_tables_count
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_shift_user_count
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift_id;

  IF v_shift_user_count = 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_branches ub
      JOIN public.profiles p ON p.id = ub.user_id
      WHERE ub.branch_id = p_branch_id
        AND ub.user_id = auth.uid()
        AND p.is_active = true
    )
    INTO v_user_enabled;
  ELSE
    SELECT COALESCE(csu.is_enabled, false)
    INTO v_user_enabled
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = v_shift_id
      AND csu.user_id = auth.uid();
  END IF;

  RETURN QUERY
  SELECT v_shift_id, true, COALESCE(v_user_enabled, false), v_active_tables_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;
