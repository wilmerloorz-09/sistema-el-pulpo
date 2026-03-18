CREATE TABLE IF NOT EXISTS public.cash_register_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('entrada', 'salida', 'cambio_denominacion')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_register_movements_shift_id
  ON public.cash_register_movements (shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_register_movements_branch_id
  ON public.cash_register_movements (branch_id, created_at DESC);

ALTER TABLE public.cash_register_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read cash register movements from active branch" ON public.cash_register_movements;
CREATE POLICY "Users can read cash register movements from active branch"
ON public.cash_register_movements
FOR SELECT
TO authenticated
USING (
  branch_id = (
    SELECT p.active_branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
  AND (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = cash_register_movements.shift_id
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
  recorded_by = auth.uid()
  AND branch_id = (
    SELECT p.active_branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = shift_id
      AND cs.branch_id = branch_id
      AND cs.status = 'OPEN'
      AND cs.caja_status = 'OPEN'
  )
  AND (
    public.can_manage_branch_admin(auth.uid(), branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = cash_register_movements.shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  )
);

CREATE OR REPLACE FUNCTION public.list_cash_register_movements(
  p_turno_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  branch_id uuid,
  movement_type text,
  amount numeric,
  reason text,
  recorded_by uuid,
  recorded_by_name text,
  recorded_by_username text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_caja_status public.caja_status;
BEGIN
  IF p_turno_id IS NULL THEN
    RAISE EXCEPTION 'turno_id es obligatorio';
  END IF;

  SELECT cs.branch_id, cs.status, cs.caja_status
  INTO v_branch_id, v_shift_status, v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_turno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_turno_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver los movimientos de esta caja';
  END IF;

  RETURN QUERY
  SELECT
    crm.id,
    crm.shift_id,
    crm.branch_id,
    crm.movement_type,
    crm.amount,
    crm.reason,
    crm.recorded_by,
    recorder.full_name AS recorded_by_name,
    recorder.username AS recorded_by_username,
    crm.created_at
  FROM public.cash_register_movements crm
  JOIN public.profiles recorder
    ON recorder.id = crm.recorded_by
  WHERE crm.shift_id = p_turno_id
  ORDER BY crm.created_at DESC, crm.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja(
  p_turno_id uuid,
  p_tipo text,
  p_monto numeric,
  p_motivo text
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  branch_id uuid,
  movement_type text,
  amount numeric,
  reason text,
  recorded_by uuid,
  recorded_by_name text,
  recorded_by_username text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_caja_status public.caja_status;
  v_tipo text := lower(NULLIF(btrim(COALESCE(p_tipo, '')), ''));
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_inserted_id uuid;
BEGIN
  IF p_turno_id IS NULL THEN
    RAISE EXCEPTION 'turno_id es obligatorio';
  END IF;

  IF v_tipo IS NULL OR v_tipo NOT IN ('entrada', 'salida', 'cambio_denominacion') THEN
    RAISE EXCEPTION 'El tipo de movimiento no es valido';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para registrar el movimiento';
  END IF;

  SELECT cs.branch_id, cs.status, cs.caja_status
  INTO v_branch_id, v_shift_status, v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_turno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF v_shift_status <> 'OPEN' OR v_caja_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Solo puedes registrar movimientos con una caja abierta';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_turno_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para registrar movimientos en esta caja';
  END IF;

  INSERT INTO public.cash_register_movements (
    shift_id,
    branch_id,
    movement_type,
    amount,
    reason,
    recorded_by
  )
  VALUES (
    p_turno_id,
    v_branch_id,
    v_tipo,
    ROUND(p_monto::numeric, 2),
    v_motivo,
    auth.uid()
  )
  RETURNING cash_register_movements.id
  INTO v_inserted_id;

  RETURN QUERY
  SELECT
    crm.id,
    crm.shift_id,
    crm.branch_id,
    crm.movement_type,
    crm.amount,
    crm.reason,
    crm.recorded_by,
    recorder.full_name AS recorded_by_name,
    recorder.username AS recorded_by_username,
    crm.created_at
  FROM public.cash_register_movements crm
  JOIN public.profiles recorder
    ON recorder.id = crm.recorded_by
  WHERE crm.id = v_inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_cash_register_movements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja(uuid, text, numeric, text) TO authenticated;
