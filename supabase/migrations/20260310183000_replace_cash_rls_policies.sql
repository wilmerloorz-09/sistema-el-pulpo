-- Harden cash RLS by fully replacing legacy policies and tying shifts to the acting user

DROP POLICY IF EXISTS "Authenticated can view shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Users can insert cash shifts by permission" ON public.cash_shifts;
DROP POLICY IF EXISTS "Users can update cash shifts by permission" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cajeros can insert shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cajeros can update shifts" ON public.cash_shifts;

CREATE POLICY "Users can view cash shifts by permission"
ON public.cash_shifts
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), branch_id)
  OR cashier_id = auth.uid()
);

CREATE POLICY "Users can insert own cash shifts by permission"
ON public.cash_shifts
FOR INSERT
TO authenticated
WITH CHECK (
  cashier_id = auth.uid()
  AND public.can_operate_cash_branch(auth.uid(), branch_id)
);

CREATE POLICY "Users can update own cash shifts by permission"
ON public.cash_shifts
FOR UPDATE
TO authenticated
USING (
  cashier_id = auth.uid()
  AND public.can_operate_cash_branch(auth.uid(), branch_id)
)
WITH CHECK (
  cashier_id = auth.uid()
  AND public.can_operate_cash_branch(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Authenticated can view shift denoms" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Users can insert cash shift denoms by permission" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Users can update cash shift denoms by permission" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Cajeros can insert shift denoms" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Cajeros can update shift denoms" ON public.cash_shift_denoms;

CREATE POLICY "Users can view cash shift denoms by permission"
ON public.cash_shift_denoms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_denoms.shift_id
      AND (public.can_operate_cash_branch(auth.uid(), cs.branch_id) OR cs.cashier_id = auth.uid())
  )
);

CREATE POLICY "Users can insert cash shift denoms by shift permission"
ON public.cash_shift_denoms
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND cs.cashier_id = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);

CREATE POLICY "Users can update cash shift denoms by shift permission"
ON public.cash_shift_denoms
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_shift_denoms.shift_id
      AND cs.cashier_id = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND cs.cashier_id = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);

DROP POLICY IF EXISTS "Authenticated can view movements" ON public.cash_movements;
DROP POLICY IF EXISTS "Users can insert cash movements by permission" ON public.cash_movements;
DROP POLICY IF EXISTS "Cajeros can insert movements" ON public.cash_movements;

CREATE POLICY "Users can view cash movements by permission"
ON public.cash_movements
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = cash_movements.shift_id
      AND (public.can_operate_cash_branch(auth.uid(), cs.branch_id) OR cs.cashier_id = auth.uid())
  )
);

CREATE POLICY "Users can insert cash movements by shift permission"
ON public.cash_movements
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND cs.cashier_id = auth.uid()
      AND public.can_operate_cash_branch(auth.uid(), cs.branch_id)
  )
);
