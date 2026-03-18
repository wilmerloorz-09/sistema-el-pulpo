CREATE TABLE IF NOT EXISTS public.cash_register_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('abierta', 'cerrada', 'anulada')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  initial_total numeric(12,2) NOT NULL DEFAULT 0,
  notes text NULL,
  anulada_por uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  anulada_at timestamptz NULL,
  motivo_anulacion text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_register_openings_shift_id
  ON public.cash_register_openings (shift_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_register_openings_branch_id
  ON public.cash_register_openings (branch_id, opened_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_openings_one_open_per_shift
  ON public.cash_register_openings (shift_id)
  WHERE status = 'abierta';

CREATE OR REPLACE FUNCTION public.touch_cash_register_openings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_register_openings_updated_at ON public.cash_register_openings;
CREATE TRIGGER trg_cash_register_openings_updated_at
BEFORE UPDATE ON public.cash_register_openings
FOR EACH ROW
EXECUTE FUNCTION public.touch_cash_register_openings_updated_at();

INSERT INTO public.cash_register_openings (
  shift_id,
  branch_id,
  cashier_id,
  status,
  opened_at,
  closed_at,
  initial_total,
  notes
)
SELECT
  cs.id,
  cs.branch_id,
  cs.cashier_id,
  CASE
    WHEN cs.caja_status = 'OPEN' THEN 'abierta'
    WHEN cs.caja_status = 'CLOSED' THEN 'cerrada'
  END,
  cs.opened_at,
  CASE
    WHEN cs.caja_status = 'CLOSED' THEN COALESCE(cs.closed_at, now())
    ELSE NULL
  END,
  COALESCE((
    SELECT SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0))
    FROM public.cash_shift_denoms csd
    JOIN public.denominations d
      ON d.id = csd.denomination_id
    WHERE csd.shift_id = cs.id
  ), 0),
  cs.notes
FROM public.cash_shifts cs
WHERE cs.caja_status IN ('OPEN', 'CLOSED')
  AND NOT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = cs.id
  );

CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_current_opening_id uuid;
  v_payment_count integer := 0;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  SELECT cro.id
  INTO v_current_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  SELECT COUNT(*)::integer
  INTO v_payment_count
  FROM public.cash_movements cm
  WHERE cm.shift_id = p_shift_id
    AND cm.movement_type = 'PAYMENT_IN'
    AND cm.payment_id IS NOT NULL;

  RETURN QUERY
  SELECT
    cro.id,
    cro.shift_id,
    cro.status,
    cro.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    cro.notes,
    cro.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    cro.anulada_at,
    cro.motivo_anulacion,
    cro.id = v_current_opening_id AS is_current,
    CASE
      WHEN cro.id = v_current_opening_id AND cro.status = 'abierta' THEN v_payment_count
      ELSE 0
    END AS payment_count
  FROM public.cash_register_openings cro
  JOIN public.profiles cashier
    ON cashier.id = cro.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = cro.anulada_por
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_caja_status public.caja_status;
  v_initial_total numeric(12,2) := 0;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users
      WHERE shift_id = p_shift_id
        AND user_id = p_cashier_id
        AND is_enabled = true
        AND can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'La caja ya fue abierta anteriormente en este turno';
  END IF;

  IF v_caja_status = 'CLOSED' THEN
    RAISE EXCEPTION 'La caja ya fue cerrada en este turno y no puede volver a abrirse';
  END IF;

  DELETE FROM public.cash_shift_denoms
  WHERE shift_id = p_shift_id;

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.branch_id = p_branch_id
      AND d.is_active = true;
  ELSE
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.cash_shift_denoms (
        id,
        shift_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d
    ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id;

  INSERT INTO public.cash_register_openings (
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total
  )
  VALUES (
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    v_initial_total
  );

  UPDATE public.cash_shifts
  SET caja_status = 'OPEN'
  WHERE id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_opening_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users
      WHERE shift_id = p_shift_id
        AND user_id = p_cashier_id
        AND is_enabled = true
        AND can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  IF v_caja_status != 'OPEN' THEN
    RAISE EXCEPTION 'La caja no esta abierta para cerrarse';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro una apertura de caja activa';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED',
      notes = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), notes)
  WHERE id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.anular_apertura_caja(
  p_turno_id uuid,
  p_motivo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_caja_status public.caja_status;
  v_opening_id uuid;
  v_payment_count integer := 0;
  v_reason text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF p_turno_id IS NULL THEN
    RAISE EXCEPTION 'turno_id es obligatorio';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de al menos 10 caracteres';
  END IF;

  SELECT cs.branch_id, cs.status, cs.caja_status
  INTO v_branch_id, v_shift_status, v_caja_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_turno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para anular la apertura de caja en esta sucursal';
  END IF;

  IF v_shift_status <> 'OPEN' THEN
    RAISE EXCEPTION 'El turno ya no esta abierto';
  END IF;

  IF v_caja_status <> 'OPEN' THEN
    RAISE EXCEPTION 'No hay una apertura de caja activa para anular';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_turno_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'La apertura actual ya no esta disponible para anular';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_payment_count
  FROM public.cash_movements cm
  WHERE cm.shift_id = p_turno_id
    AND cm.movement_type = 'PAYMENT_IN'
    AND cm.payment_id IS NOT NULL;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'No se puede anular la apertura porque existen ordenes o cobros registrados en esta caja';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'anulada',
      anulada_por = auth.uid(),
      anulada_at = now(),
      motivo_anulacion = v_reason
  WHERE id = v_opening_id
    AND status = 'abierta';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La apertura ya fue anulada anteriormente';
  END IF;

  DELETE FROM public.cash_shift_denoms
  WHERE shift_id = p_turno_id;

  DELETE FROM public.cash_movements
  WHERE shift_id = p_turno_id
    AND payment_id IS NULL;

  UPDATE public.cash_shifts
  SET caja_status = 'UNOPENED'
  WHERE id = p_turno_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_cash_register_openings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_apertura_caja(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;
