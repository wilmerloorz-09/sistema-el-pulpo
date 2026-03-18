DROP POLICY IF EXISTS "Users can read cash register movements from active branch" ON public.cash_register_movements;
CREATE POLICY "Users can read cash register movements from active branch"
ON public.cash_register_movements
FOR SELECT
TO authenticated
USING (
  public.cash_register_movements.branch_id = (
    SELECT p.active_branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
  AND (
    public.can_manage_branch_admin(auth.uid(), public.cash_register_movements.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = public.cash_register_movements.shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  )
);

DROP POLICY IF EXISTS "Users can insert cash register movements from active branch" ON public.cash_register_movements;
CREATE POLICY "Users can insert cash register movements from active branch"
ON public.cash_register_movements
FOR INSERT
TO authenticated
WITH CHECK (
  public.cash_register_movements.recorded_by = auth.uid()
  AND public.cash_register_movements.branch_id = (
    SELECT p.active_branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = public.cash_register_movements.shift_id
      AND cs.branch_id = public.cash_register_movements.branch_id
      AND cs.status = 'OPEN'
      AND cs.caja_status = 'OPEN'
  )
  AND (
    public.can_manage_branch_admin(auth.uid(), public.cash_register_movements.branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = public.cash_register_movements.shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  )
);
