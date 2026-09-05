-- Caja auxiliar para cambio de monedas/billetes entre cajas del mismo turno.

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS auxiliary_cashier_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auxiliary_caja_template_id uuid REFERENCES public.cash_register_templates(id) ON DELETE SET NULL;

ALTER TABLE public.cash_shift_users
  ADD COLUMN IF NOT EXISTS can_exchange_cash boolean NOT NULL DEFAULT false;

ALTER TABLE public.cash_register_openings
  DROP CONSTRAINT IF EXISTS cash_register_openings_register_role_check;

ALTER TABLE public.cash_register_openings
  ADD CONSTRAINT cash_register_openings_register_role_check
  CHECK (register_role IN ('standard', 'primary', 'secondary', 'auxiliary'));

CREATE TABLE IF NOT EXISTS public.cash_denomination_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  auxiliary_opening_id uuid NOT NULL REFERENCES public.cash_register_openings(id) ON DELETE RESTRICT,
  target_opening_id uuid NOT NULL REFERENCES public.cash_register_openings(id) ON DELETE RESTRICT,
  auxiliary_cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  given_detail jsonb NOT NULL,
  received_detail jsonb NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided', 'corrected')),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  voided_at timestamptz,
  void_reason text,
  correction_exchange_id uuid REFERENCES public.cash_denomination_exchanges(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_denomination_exchanges_shift
  ON public.cash_denomination_exchanges (shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_denomination_exchanges_auxiliary
  ON public.cash_denomination_exchanges (auxiliary_cashier_id, created_at DESC);

ALTER TABLE public.cash_denomination_exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auxiliary users can view their cash exchanges" ON public.cash_denomination_exchanges;
CREATE POLICY "Auxiliary users can view their cash exchanges"
ON public.cash_denomination_exchanges
FOR SELECT
TO authenticated
USING (
  auxiliary_cashier_id = auth.uid()
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
);

CREATE OR REPLACE FUNCTION public.internal_open_auxiliary_cash_register(
  p_shift_id uuid,
  p_branch_id uuid,
  p_cashier_id uuid,
  p_template_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2);
BEGIN
  INSERT INTO public.cash_register_openings (
    id, shift_id, branch_id, cashier_id, status, opened_at, initial_total, register_role
  )
  VALUES (
    v_opening_id, p_shift_id, p_branch_id, p_cashier_id, 'abierta', now(), 0, 'auxiliary'
  );

  INSERT INTO public.cash_shift_denoms (
    id, shift_id, cashier_id, opening_id, denomination_id, qty_initial, qty_current
  )
  SELECT
    gen_random_uuid(),
    p_shift_id,
    p_cashier_id,
    v_opening_id,
    d.id,
    GREATEST(0, COALESCE(crtd.qty, 0)),
    GREATEST(0, COALESCE(crtd.qty, 0))
  FROM public.denominations d
  LEFT JOIN public.cash_register_template_denoms crtd
    ON crtd.denomination_id = d.id
   AND crtd.template_id = p_template_id
  WHERE d.is_active = true;

  SELECT COALESCE(SUM(d.value * csd.qty_initial), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d ON d.id = csd.denomination_id
  WHERE csd.opening_id = v_opening_id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
  RETURN v_opening_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_auxiliary_cash_register(
  p_shift_id uuid,
  p_branch_id uuid,
  p_auxiliary_cashier_id uuid,
  p_auxiliary_template_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_cashier_id uuid;
  v_previous_template_id uuid;
  v_opening_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL
    OR p_auxiliary_cashier_id IS NULL OR p_auxiliary_template_id IS NULL
  THEN
    RAISE EXCEPTION 'Debe configurar responsable y plantilla para la caja auxiliar';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar la caja auxiliar';
  END IF;

  SELECT cs.auxiliary_cashier_id, cs.auxiliary_caja_template_id
  INTO v_previous_cashier_id, v_previous_template_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_auxiliary_cashier_id
      AND csu.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar debe estar habilitado en el turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = p_auxiliary_template_id
      AND crt.branch_id = p_branch_id
      AND crt.is_active = true
  ) THEN
    RAISE EXCEPTION 'La plantilla de la caja auxiliar no pertenece a la sucursal o está inactiva';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.user_id = p_auxiliary_cashier_id
      AND csu.can_use_caja = true
  ) OR EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.primary_cashier_id = p_auxiliary_cashier_id
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar no puede ser cajero del turno';
  END IF;

  IF v_previous_cashier_id IS DISTINCT FROM p_auxiliary_cashier_id
    AND EXISTS (
      SELECT 1
      FROM public.cash_denomination_exchanges cde
      WHERE cde.shift_id = p_shift_id
        AND cde.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'No se puede cambiar el responsable auxiliar mientras existan cambios activos';
  END IF;

  IF v_previous_cashier_id = p_auxiliary_cashier_id
    AND v_previous_template_id IS NOT NULL
    AND v_previous_template_id IS DISTINCT FROM p_auxiliary_template_id
    AND EXISTS (
      SELECT 1
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = p_shift_id
        AND cro.cashier_id = p_auxiliary_cashier_id
        AND cro.register_role = 'auxiliary'
    )
  THEN
    RAISE EXCEPTION 'La plantilla de la caja auxiliar no puede cambiarse después de su apertura';
  END IF;

  IF v_previous_cashier_id IS DISTINCT FROM p_auxiliary_cashier_id THEN
    UPDATE public.cash_register_openings
    SET status = 'cerrada',
        closed_at = COALESCE(closed_at, now()),
        notes = COALESCE(notes, 'Cierre por cambio de responsable auxiliar')
    WHERE shift_id = p_shift_id
      AND cashier_id = v_previous_cashier_id
      AND register_role = 'auxiliary'
      AND status = 'abierta';
  END IF;

  UPDATE public.cash_shift_users
  SET can_exchange_cash = false
  WHERE shift_id = p_shift_id;

  UPDATE public.cash_shift_users
  SET can_exchange_cash = true,
      can_use_caja = false,
      can_double_session = false
  WHERE shift_id = p_shift_id
    AND user_id = p_auxiliary_cashier_id;

  UPDATE public.cash_shifts
  SET auxiliary_cashier_id = p_auxiliary_cashier_id,
      auxiliary_caja_template_id = p_auxiliary_template_id
  WHERE id = p_shift_id;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_auxiliary_cashier_id
    AND cro.register_role = 'auxiliary'
    AND (
      v_previous_cashier_id = p_auxiliary_cashier_id
      OR cro.status = 'abierta'
    )
  ORDER BY cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    v_opening_id := public.internal_open_auxiliary_cash_register(
      p_shift_id,
      p_branch_id,
      p_auxiliary_cashier_id,
      p_auxiliary_template_id
    );
  END IF;

  RETURN v_opening_id;
END;
$$;

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
    (cs.auxiliary_cashier_id = auth.uid()),
    cro.id,
    cro.status
  FROM public.cash_shifts cs
  LEFT JOIN LATERAL (
    SELECT o.id, o.status
    FROM public.cash_register_openings o
    WHERE o.shift_id = cs.id
      AND o.cashier_id = auth.uid()
      AND o.register_role = 'auxiliary'
    ORDER BY o.created_at DESC
    LIMIT 1
  ) cro ON true
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  ORDER BY cs.opened_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.internal_apply_auxiliary_exchange_balances(
  p_auxiliary_opening_id uuid,
  p_target_opening_id uuid,
  p_given_detail jsonb,
  p_received_detail jsonb,
  p_multiplier integer DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_aux_cashier_id uuid;
  v_target_cashier_id uuid;
  v_given_total numeric(12,2);
  v_received_total numeric(12,2);
  v_line record;
  v_sign integer := CASE WHEN p_multiplier < 0 THEN -1 ELSE 1 END;
BEGIN
  IF p_auxiliary_opening_id IS NULL OR p_target_opening_id IS NULL
    OR p_auxiliary_opening_id = p_target_opening_id
  THEN
    RAISE EXCEPTION 'Las cajas de origen y destino no son válidas';
  END IF;

  SELECT a.shift_id, a.cashier_id, t.cashier_id
  INTO v_shift_id, v_aux_cashier_id, v_target_cashier_id
  FROM public.cash_register_openings a
  JOIN public.cash_register_openings t
    ON t.id = p_target_opening_id
   AND t.shift_id = a.shift_id
  WHERE a.id = p_auxiliary_opening_id
    AND a.status = 'abierta'
    AND a.register_role = 'auxiliary'
    AND t.status = 'abierta'
    AND t.register_role <> 'auxiliary'
  FOR UPDATE OF a, t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Las aperturas de caja no pertenecen al mismo turno';
  END IF;

  IF jsonb_typeof(COALESCE(p_given_detail, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_received_detail, '[]'::jsonb)) <> 'array'
  THEN
    RAISE EXCEPTION 'El detalle de denominaciones no es válido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_given_detail, '[]'::jsonb))
      AS x(denomination_id uuid, qty integer)
    LEFT JOIN public.denominations d ON d.id = x.denomination_id
    WHERE x.denomination_id IS NULL
      OR x.qty IS NULL
      OR x.qty <= 0
      OR d.id IS NULL
      OR (v_sign > 0 AND d.is_active <> true)
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_received_detail, '[]'::jsonb))
      AS x(denomination_id uuid, qty integer)
    LEFT JOIN public.denominations d ON d.id = x.denomination_id
    WHERE x.denomination_id IS NULL
      OR x.qty IS NULL
      OR x.qty <= 0
      OR d.id IS NULL
      OR (v_sign > 0 AND d.is_active <> true)
  ) THEN
    RAISE EXCEPTION 'El detalle contiene cantidades o denominaciones inválidas';
  END IF;

  SELECT COALESCE(SUM(d.value * x.qty), 0)
  INTO v_given_total
  FROM jsonb_to_recordset(COALESCE(p_given_detail, '[]'::jsonb))
    AS x(denomination_id uuid, qty integer)
  JOIN public.denominations d ON d.id = x.denomination_id;

  SELECT COALESCE(SUM(d.value * x.qty), 0)
  INTO v_received_total
  FROM jsonb_to_recordset(COALESCE(p_received_detail, '[]'::jsonb))
    AS x(denomination_id uuid, qty integer)
  JOIN public.denominations d ON d.id = x.denomination_id;

  IF v_given_total <= 0 OR ABS(v_given_total - v_received_total) > 0.009 THEN
    RAISE EXCEPTION 'El valor entregado y el valor recibido deben ser exactamente iguales';
  END IF;

  INSERT INTO public.cash_shift_denoms (
    id, shift_id, cashier_id, opening_id, denomination_id, qty_initial, qty_current
  )
  SELECT gen_random_uuid(), v_shift_id, v_aux_cashier_id, p_auxiliary_opening_id, ids.id, 0, 0
  FROM (
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_given_detail) AS x(denomination_id uuid, qty integer)
    UNION
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_received_detail) AS x(denomination_id uuid, qty integer)
  ) ids
  ON CONFLICT (opening_id, denomination_id) WHERE opening_id IS NOT NULL DO NOTHING;

  INSERT INTO public.cash_shift_denoms (
    id, shift_id, cashier_id, opening_id, denomination_id, qty_initial, qty_current
  )
  SELECT gen_random_uuid(), v_shift_id, v_target_cashier_id, p_target_opening_id, ids.id, 0, 0
  FROM (
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_given_detail) AS x(denomination_id uuid, qty integer)
    UNION
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_received_detail) AS x(denomination_id uuid, qty integer)
  ) ids
  ON CONFLICT (opening_id, denomination_id) WHERE opening_id IS NOT NULL DO NOTHING;

  PERFORM 1
  FROM public.cash_shift_denoms csd
  WHERE csd.opening_id IN (p_auxiliary_opening_id, p_target_opening_id)
  ORDER BY csd.opening_id, csd.denomination_id
  FOR UPDATE;

  FOR v_line IN
    SELECT x.denomination_id, SUM(x.qty)::integer AS qty
    FROM jsonb_to_recordset(p_given_detail) AS x(denomination_id uuid, qty integer)
    GROUP BY x.denomination_id
  LOOP
    UPDATE public.cash_shift_denoms
    SET qty_current = qty_current - (v_sign * v_line.qty)
    WHERE opening_id = p_auxiliary_opening_id
      AND denomination_id = v_line.denomination_id;

    UPDATE public.cash_shift_denoms
    SET qty_current = qty_current + (v_sign * v_line.qty)
    WHERE opening_id = p_target_opening_id
      AND denomination_id = v_line.denomination_id;
  END LOOP;

  FOR v_line IN
    SELECT x.denomination_id, SUM(x.qty)::integer AS qty
    FROM jsonb_to_recordset(p_received_detail) AS x(denomination_id uuid, qty integer)
    GROUP BY x.denomination_id
  LOOP
    UPDATE public.cash_shift_denoms
    SET qty_current = qty_current + (v_sign * v_line.qty)
    WHERE opening_id = p_auxiliary_opening_id
      AND denomination_id = v_line.denomination_id;

    UPDATE public.cash_shift_denoms
    SET qty_current = qty_current - (v_sign * v_line.qty)
    WHERE opening_id = p_target_opening_id
      AND denomination_id = v_line.denomination_id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shift_denoms
    WHERE opening_id IN (p_auxiliary_opening_id, p_target_opening_id)
      AND qty_current < 0
  ) THEN
    RAISE EXCEPTION 'No hay suficientes denominaciones en una de las cajas para completar la operación';
  END IF;

  RETURN ROUND(v_given_total, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_auxiliary_cash_exchange(
  p_shift_id uuid,
  p_branch_id uuid,
  p_target_opening_id uuid,
  p_given_detail jsonb,
  p_received_detail jsonb,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auxiliary_cashier_id uuid;
  v_auxiliary_opening_id uuid;
  v_target_cashier_id uuid;
  v_amount numeric(12,2);
  v_exchange_id uuid := gen_random_uuid();
  v_given_detail jsonb;
  v_received_detail jsonb;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Turno y sucursal son obligatorios';
  END IF;

  SELECT cs.auxiliary_cashier_id, cro.id
  INTO v_auxiliary_cashier_id, v_auxiliary_opening_id
  FROM public.cash_shifts cs
  JOIN public.cash_register_openings cro
    ON cro.shift_id = cs.id
   AND cro.cashier_id = cs.auxiliary_cashier_id
   AND cro.register_role = 'auxiliary'
   AND cro.status = 'abierta'
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  FOR UPDATE OF cs, cro;

  IF v_auxiliary_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una caja auxiliar abierta';
  END IF;

  SELECT cro.cashier_id
  INTO v_target_cashier_id
  FROM public.cash_register_openings cro
  WHERE cro.id = p_target_opening_id
    AND cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary';

  IF v_target_cashier_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona una caja de cajero abierta del turno';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'denomination_id', detail.denomination_id,
    'qty', detail.qty,
    'label', d.label,
    'value', d.value
  ) ORDER BY d.display_order, d.value), '[]'::jsonb)
  INTO v_given_detail
  FROM (
    SELECT x.denomination_id, SUM(x.qty)::integer AS qty
    FROM jsonb_to_recordset(COALESCE(p_given_detail, '[]'::jsonb))
      AS x(denomination_id uuid, qty integer)
    GROUP BY x.denomination_id
  ) detail
  JOIN public.denominations d ON d.id = detail.denomination_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'denomination_id', detail.denomination_id,
    'qty', detail.qty,
    'label', d.label,
    'value', d.value
  ) ORDER BY d.display_order, d.value), '[]'::jsonb)
  INTO v_received_detail
  FROM (
    SELECT x.denomination_id, SUM(x.qty)::integer AS qty
    FROM jsonb_to_recordset(COALESCE(p_received_detail, '[]'::jsonb))
      AS x(denomination_id uuid, qty integer)
    GROUP BY x.denomination_id
  ) detail
  JOIN public.denominations d ON d.id = detail.denomination_id;

  v_amount := public.internal_apply_auxiliary_exchange_balances(
    v_auxiliary_opening_id,
    p_target_opening_id,
    p_given_detail,
    p_received_detail,
    1
  );

  INSERT INTO public.cash_denomination_exchanges (
    id, shift_id, branch_id, auxiliary_opening_id, target_opening_id,
    auxiliary_cashier_id, target_cashier_id, amount, given_detail,
    received_detail, reason, created_by
  )
  VALUES (
    v_exchange_id, p_shift_id, p_branch_id, v_auxiliary_opening_id,
    p_target_opening_id, v_auxiliary_cashier_id, v_target_cashier_id,
    v_amount, v_given_detail, v_received_detail,
    NULLIF(btrim(COALESCE(p_reason, '')), ''), auth.uid()
  );

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, after_data)
  VALUES (
    auth.uid(), 'CREATE', 'cash_denomination_exchange', v_exchange_id::text,
    jsonb_build_object('amount', v_amount, 'target_cashier_id', v_target_cashier_id)
  );

  RETURN v_exchange_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_auxiliary_cash_exchange(
  p_exchange_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exchange public.cash_denomination_exchanges%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Ingresa un motivo de anulación de al menos 5 caracteres';
  END IF;

  SELECT *
  INTO v_exchange
  FROM public.cash_denomination_exchanges
  WHERE id = p_exchange_id
  FOR UPDATE;

  IF NOT FOUND OR v_exchange.status <> 'active' THEN
    RAISE EXCEPTION 'El cambio ya no está activo';
  END IF;

  IF NOT (
    v_exchange.auxiliary_cashier_id = auth.uid()
    OR public.can_manage_branch_admin(auth.uid(), v_exchange.branch_id)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para anular este cambio';
  END IF;

  PERFORM public.internal_apply_auxiliary_exchange_balances(
    v_exchange.auxiliary_opening_id,
    v_exchange.target_opening_id,
    v_exchange.given_detail,
    v_exchange.received_detail,
    -1
  );

  UPDATE public.cash_denomination_exchanges
  SET status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = v_reason
  WHERE id = p_exchange_id;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, before_data, after_data)
  VALUES (
    auth.uid(), 'VOID', 'cash_denomination_exchange', p_exchange_id::text,
    to_jsonb(v_exchange),
    jsonb_build_object('status', 'voided', 'reason', v_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_auxiliary_cash_exchange(
  p_exchange_id uuid,
  p_shift_id uuid,
  p_branch_id uuid,
  p_target_opening_id uuid,
  p_given_detail jsonb,
  p_received_detail jsonb,
  p_reason text,
  p_correction_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_exchange_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_denomination_exchanges cde
    WHERE cde.id = p_exchange_id
      AND cde.shift_id = p_shift_id
      AND cde.branch_id = p_branch_id
      AND cde.status = 'active'
  ) THEN
    RAISE EXCEPTION 'El cambio no pertenece al turno y sucursal indicados';
  END IF;

  PERFORM public.void_auxiliary_cash_exchange(p_exchange_id, p_correction_reason);

  v_new_exchange_id := public.register_auxiliary_cash_exchange(
    p_shift_id,
    p_branch_id,
    p_target_opening_id,
    p_given_detail,
    p_received_detail,
    p_reason
  );

  UPDATE public.cash_denomination_exchanges
  SET status = 'corrected',
      correction_exchange_id = v_new_exchange_id
  WHERE id = p_exchange_id;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, after_data)
  VALUES (
    auth.uid(), 'CORRECT', 'cash_denomination_exchange', p_exchange_id::text,
    jsonb_build_object('correction_exchange_id', v_new_exchange_id)
  );

  RETURN v_new_exchange_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_auxiliary_cash_register(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening_id uuid;
BEGIN
  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_shifts cs
  JOIN public.cash_register_openings cro
    ON cro.shift_id = cs.id
   AND cro.cashier_id = auth.uid()
   AND cro.register_role = 'auxiliary'
   AND cro.status = 'abierta'
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  FOR UPDATE OF cs, cro;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una caja auxiliar abierta para cerrar';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auxiliary_cash_context(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_opening public.cash_register_openings%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT *
  INTO v_shift
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift.id IS NULL OR NOT (
    v_shift.auxiliary_cashier_id = auth.uid()
    OR public.can_manage_branch_admin(auth.uid(), p_branch_id)
  ) THEN
    RAISE EXCEPTION 'No tienes acceso a la caja auxiliar de esta sucursal';
  END IF;

  SELECT *
  INTO v_opening
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = v_shift.id
    AND cro.cashier_id = v_shift.auxiliary_cashier_id
    AND cro.register_role = 'auxiliary'
  ORDER BY cro.created_at DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'shift_id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'auxiliary_cashier_id', v_shift.auxiliary_cashier_id,
    'opening_id', v_opening.id,
    'opening_status', v_opening.status,
    'denominations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'label', d.label,
        'value', d.value,
        'image_url', d.image_url,
        'display_order', d.display_order,
        'qty_current', COALESCE(csd.qty_current, 0)
      ) ORDER BY d.display_order, d.value)
      FROM public.denominations d
      LEFT JOIN public.cash_shift_denoms csd
        ON csd.denomination_id = d.id
       AND csd.opening_id = v_opening.id
      WHERE d.is_active = true
    ), '[]'::jsonb),
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'opening_id', cro.id,
        'cashier_id', cro.cashier_id,
        'cashier_name', COALESCE(NULLIF(p.alias, ''), NULLIF(p.full_name, ''), p.username),
        'register_role', cro.register_role,
        'denominations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'qty_current', COALESCE(csd.qty_current, 0)
          ))
          FROM public.denominations d
          LEFT JOIN public.cash_shift_denoms csd
            ON csd.denomination_id = d.id
           AND csd.opening_id = cro.id
          WHERE d.is_active = true
        ), '[]'::jsonb)
      ) ORDER BY cro.opened_at, cro.id)
      FROM public.cash_register_openings cro
      JOIN public.profiles p ON p.id = cro.cashier_id
      WHERE cro.shift_id = v_shift.id
        AND cro.status = 'abierta'
        AND cro.register_role <> 'auxiliary'
    ), '[]'::jsonb),
    'exchanges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cde.id,
        'target_opening_id', cde.target_opening_id,
        'target_cashier_id', cde.target_cashier_id,
        'target_cashier_name', COALESCE(NULLIF(tp.alias, ''), NULLIF(tp.full_name, ''), tp.username),
        'amount', cde.amount,
        'given_detail', cde.given_detail,
        'received_detail', cde.received_detail,
        'reason', cde.reason,
        'status', cde.status,
        'created_at', cde.created_at,
        'created_by_name', COALESCE(NULLIF(cp.alias, ''), NULLIF(cp.full_name, ''), cp.username),
        'voided_at', cde.voided_at,
        'void_reason', cde.void_reason,
        'correction_exchange_id', cde.correction_exchange_id
      ) ORDER BY cde.created_at DESC)
      FROM public.cash_denomination_exchanges cde
      JOIN public.profiles tp ON tp.id = cde.target_cashier_id
      JOIN public.profiles cp ON cp.id = cde.created_by
      WHERE cde.shift_id = v_shift.id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_auxiliary_user_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  SELECT COALESCE(o.cash_shift_id, cs.id)
  INTO v_shift_id
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT current_shift.id
    FROM public.cash_shifts current_shift
    WHERE current_shift.branch_id = o.branch_id
      AND current_shift.status = 'OPEN'
    ORDER BY current_shift.opened_at DESC
    LIMIT 1
  ) cs ON true
  WHERE o.id = NEW.order_id;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = v_shift_id
      AND csu.user_id = auth.uid()
      AND csu.is_enabled = true
      AND csu.can_exchange_cash = true
  ) THEN
    RAISE EXCEPTION 'El responsable de la caja auxiliar no puede registrar cobros';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_auxiliary_user_payments ON public.payments;
CREATE TRIGGER trg_block_auxiliary_user_payments
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.block_auxiliary_user_payments();

-- La caja auxiliar no puede cobrar; por eso no cuenta como "otra caja real"
-- al decidir si el último cajero puede cerrar mientras quedan órdenes pendientes.
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
  v_opening_id uuid;
  v_other_real_open int := 0;
  v_unpaid_count int := 0;
  v_unpaid_preview text := '';
  v_blockers jsonb;
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
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_cashier_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_cashier_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una apertura de caja activa para cerrar';
  END IF;

  SELECT COUNT(*)::int
  INTO v_other_real_open
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
    AND cro.id <> v_opening_id
    AND (
      NOT public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
      OR public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id)
    );

  IF v_other_real_open = 0 THEN
    v_blockers := public.get_branch_shift_closure_blockers(p_branch_id);
    v_unpaid_count := jsonb_array_length(COALESCE(v_blockers -> 'unpaid_orders', '[]'::jsonb));

    IF v_unpaid_count > 0 THEN
      SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
      INTO v_unpaid_preview
      FROM (
        SELECT r.order_ref, r.label
        FROM jsonb_to_recordset(v_blockers -> 'unpaid_orders')
          AS r(order_id uuid, order_ref text, label text, status text)
        ORDER BY r.order_ref
        LIMIT 20
      ) x;

      RAISE EXCEPTION
        'No puedes cerrar la caja porque es la última abierta y aún hay órdenes por cobrar.%s%s',
        E'\n\nÓrdenes sin pagar: ' || COALESCE(v_unpaid_preview, ''),
        CASE
          WHEN v_unpaid_count > 20 THEN E'\n… y ' || (v_unpaid_count - 20)::text || ' más'
          ELSE ''
        END;
    END IF;
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_open_auxiliary_cash_register(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_apply_auxiliary_exchange_balances(uuid, uuid, jsonb, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_auxiliary_cash_register(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_auxiliary_cash_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_auxiliary_cash_exchange(uuid, uuid, uuid, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_auxiliary_cash_exchange(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_auxiliary_cash_exchange(uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_auxiliary_cash_register(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auxiliary_cash_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON COLUMN public.cash_shift_users.can_exchange_cash IS
  'Responsable de caja auxiliar: puede cambiar denominaciones entre cajas, pero no cobrar.';
COMMENT ON COLUMN public.cash_register_openings.register_role IS
  'primary/secondary: caja de cobro; auxiliary: caja exclusiva para cambio de monedas y billetes.';

NOTIFY pgrst, 'reload schema';
