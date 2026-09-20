-- Caja auxiliar permanente por sucursal:
-- - El inventario vive en la sucursal (no se reinicia por turno).
-- - Al abrir/configurar turno solo se asigna el responsable de cambios.

CREATE TABLE IF NOT EXISTS public.branch_auxiliary_cash (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.branch_auxiliary_cash_denoms (
  branch_id uuid NOT NULL REFERENCES public.branch_auxiliary_cash(branch_id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.denominations(id) ON DELETE RESTRICT,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, denomination_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_auxiliary_cash_denoms_enabled
  ON public.branch_auxiliary_cash_denoms (branch_id)
  WHERE is_enabled = true;

COMMENT ON TABLE public.branch_auxiliary_cash IS
  'Caja auxiliar permanente de la sucursal (inventario de cambio de monedas/billetes).';
COMMENT ON TABLE public.branch_auxiliary_cash_denoms IS
  'Stock persistente de la caja auxiliar; no se reinicia al abrir/cerrar turno.';

ALTER TABLE public.cash_denomination_exchanges
  ALTER COLUMN auxiliary_opening_id DROP NOT NULL;

-- Sembrar caja permanente desde aperturas auxiliares recientes o plantillas.
INSERT INTO public.branch_auxiliary_cash (branch_id)
SELECT DISTINCT cro.branch_id
FROM public.cash_register_openings cro
WHERE cro.register_role = 'auxiliary'
ON CONFLICT (branch_id) DO NOTHING;

INSERT INTO public.branch_auxiliary_cash (branch_id)
SELECT DISTINCT t.branch_id
FROM public.cash_register_templates t
WHERE t.is_auxiliary = true
ON CONFLICT (branch_id) DO NOTHING;

WITH latest_opening AS (
  SELECT DISTINCT ON (cro.branch_id)
    cro.branch_id,
    cro.id AS opening_id
  FROM public.cash_register_openings cro
  WHERE cro.register_role = 'auxiliary'
  ORDER BY cro.branch_id, cro.opened_at DESC NULLS LAST, cro.created_at DESC
)
INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
SELECT
  lo.branch_id,
  csd.denomination_id,
  GREATEST(0, COALESCE(csd.qty_current, 0)),
  true
FROM latest_opening lo
JOIN public.cash_shift_denoms csd ON csd.opening_id = lo.opening_id
ON CONFLICT (branch_id, denomination_id) DO UPDATE
SET qty = EXCLUDED.qty,
    updated_at = now();

INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
SELECT
  t.branch_id,
  crtd.denomination_id,
  GREATEST(0, COALESCE(crtd.qty, 0)),
  COALESCE(crtd.is_enabled, true)
FROM public.cash_register_templates t
JOIN public.cash_register_template_denoms crtd ON crtd.template_id = t.id
WHERE t.is_auxiliary = true
ON CONFLICT (branch_id, denomination_id) DO NOTHING;

INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
SELECT
  bac.branch_id,
  d.id,
  0,
  true
FROM public.branch_auxiliary_cash bac
CROSS JOIN public.denominations d
WHERE d.is_active = true
ON CONFLICT (branch_id, denomination_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_branch_auxiliary_cash(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  INSERT INTO public.branch_auxiliary_cash (branch_id)
  VALUES (p_branch_id)
  ON CONFLICT (branch_id) DO NOTHING;

  INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
  SELECT p_branch_id, d.id, 0, true
  FROM public.denominations d
  WHERE d.is_active = true
  ON CONFLICT (branch_id, denomination_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_auxiliary_cash_register(
  p_shift_id uuid,
  p_branch_id uuid,
  p_auxiliary_cashier_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_cashier_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Turno y sucursal son obligatorios';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar la caja auxiliar';
  END IF;

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  SELECT cs.auxiliary_cashier_id
  INTO v_previous_cashier_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido';
  END IF;

  -- Limpiar asignación.
  IF p_auxiliary_cashier_id IS NULL THEN
    UPDATE public.cash_shift_users
    SET can_exchange_cash = false
    WHERE shift_id = p_shift_id;

    UPDATE public.cash_shifts
    SET auxiliary_cashier_id = NULL
    WHERE id = p_shift_id;

    RETURN;
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

  -- Cerrar aperturas auxiliares legacy del turno (ya no se usan).
  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = COALESCE(closed_at, now()),
      notes = COALESCE(notes, 'Cierre: caja auxiliar ahora es permanente por sucursal')
  WHERE shift_id = p_shift_id
    AND register_role = 'auxiliary'
    AND status = 'abierta';

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
  SET auxiliary_cashier_id = p_auxiliary_cashier_id
  WHERE id = p_shift_id;
END;
$$;

-- Firma antigua (4 args) ya no aplica.
DROP FUNCTION IF EXISTS public.configure_auxiliary_cash_register(uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_my_auxiliary_cash_assignment(p_branch_id uuid)
RETURNS TABLE (
  shift_id uuid,
  is_assigned boolean,
  opening_id uuid,
  opening_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  RETURN QUERY
  SELECT
    v_shift_id,
    true,
    NULL::uuid,
    'abierta'::text;
END;
$$;

DROP FUNCTION IF EXISTS public.internal_apply_auxiliary_exchange_balances(uuid, uuid, jsonb, jsonb, integer);

CREATE OR REPLACE FUNCTION public.internal_apply_auxiliary_exchange_balances(
  p_branch_id uuid,
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
  v_target_cashier_id uuid;
  v_given_total numeric(12,2);
  v_received_total numeric(12,2);
  v_line record;
  v_sign integer := CASE WHEN p_multiplier < 0 THEN -1 ELSE 1 END;
BEGIN
  IF p_branch_id IS NULL OR p_target_opening_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal y caja destino son obligatorias';
  END IF;

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  SELECT cro.shift_id, cro.cashier_id
  INTO v_shift_id, v_target_cashier_id
  FROM public.cash_register_openings cro
  WHERE cro.id = p_target_opening_id
    AND cro.branch_id = p_branch_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecciona una caja de cajero abierta del turno';
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
    LEFT JOIN public.branch_auxiliary_cash_denoms bacd
      ON bacd.branch_id = p_branch_id
     AND bacd.denomination_id = x.denomination_id
    WHERE x.denomination_id IS NULL
      OR x.qty IS NULL
      OR x.qty <= 0
      OR d.id IS NULL
      OR (v_sign > 0 AND d.is_active <> true)
      OR (v_sign > 0 AND COALESCE(bacd.is_enabled, false) <> true)
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_received_detail, '[]'::jsonb))
      AS x(denomination_id uuid, qty integer)
    LEFT JOIN public.denominations d ON d.id = x.denomination_id
    LEFT JOIN public.branch_auxiliary_cash_denoms bacd
      ON bacd.branch_id = p_branch_id
     AND bacd.denomination_id = x.denomination_id
    WHERE x.denomination_id IS NULL
      OR x.qty IS NULL
      OR x.qty <= 0
      OR d.id IS NULL
      OR (v_sign > 0 AND d.is_active <> true)
      OR (v_sign > 0 AND COALESCE(bacd.is_enabled, false) <> true)
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

  INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
  SELECT p_branch_id, ids.id, 0, true
  FROM (
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_given_detail) AS x(denomination_id uuid, qty integer)
    UNION
    SELECT DISTINCT x.denomination_id AS id
    FROM jsonb_to_recordset(p_received_detail) AS x(denomination_id uuid, qty integer)
  ) ids
  ON CONFLICT (branch_id, denomination_id) DO NOTHING;

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
  FROM public.branch_auxiliary_cash_denoms bacd
  WHERE bacd.branch_id = p_branch_id
  ORDER BY bacd.denomination_id
  FOR UPDATE;

  PERFORM 1
  FROM public.cash_shift_denoms csd
  WHERE csd.opening_id = p_target_opening_id
  ORDER BY csd.denomination_id
  FOR UPDATE;

  FOR v_line IN
    SELECT x.denomination_id, SUM(x.qty)::integer AS qty
    FROM jsonb_to_recordset(p_given_detail) AS x(denomination_id uuid, qty integer)
    GROUP BY x.denomination_id
  LOOP
    UPDATE public.branch_auxiliary_cash_denoms
    SET qty = qty - (v_sign * v_line.qty),
        updated_at = now()
    WHERE branch_id = p_branch_id
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
    UPDATE public.branch_auxiliary_cash_denoms
    SET qty = qty + (v_sign * v_line.qty),
        updated_at = now()
    WHERE branch_id = p_branch_id
      AND denomination_id = v_line.denomination_id;

    UPDATE public.cash_shift_denoms
    SET qty_current = qty_current - (v_sign * v_line.qty)
    WHERE opening_id = p_target_opening_id
      AND denomination_id = v_line.denomination_id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.branch_auxiliary_cash_denoms
    WHERE branch_id = p_branch_id
      AND qty < 0
  ) OR EXISTS (
    SELECT 1
    FROM public.cash_shift_denoms
    WHERE opening_id = p_target_opening_id
      AND qty_current < 0
  ) THEN
    RAISE EXCEPTION 'No hay suficientes denominaciones en una de las cajas para completar la operación';
  END IF;

  UPDATE public.branch_auxiliary_cash
  SET updated_at = now(),
      updated_by = auth.uid()
  WHERE branch_id = p_branch_id;

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
  v_target_cashier_id uuid;
  v_amount numeric(12,2);
  v_exchange_id uuid := gen_random_uuid();
  v_given_detail jsonb;
  v_received_detail jsonb;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Turno y sucursal son obligatorios';
  END IF;

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  SELECT cs.auxiliary_cashier_id
  INTO v_auxiliary_cashier_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id
    AND cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
    AND cs.auxiliary_cashier_id = auth.uid()
  FOR UPDATE;

  IF v_auxiliary_cashier_id IS NULL THEN
    RAISE EXCEPTION 'No eres el responsable de la caja auxiliar en este turno';
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
    p_branch_id,
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
    v_exchange_id, p_shift_id, p_branch_id, NULL,
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
    v_exchange.branch_id,
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

CREATE OR REPLACE FUNCTION public.get_auxiliary_cash_context(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
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

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  SELECT jsonb_build_object(
    'shift_id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'auxiliary_cashier_id', v_shift.auxiliary_cashier_id,
    'opening_id', NULL,
    'opening_status', 'abierta',
    'denominations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'label', d.label,
        'value', d.value,
        'image_url', d.image_url,
        'display_order', d.display_order,
        'qty_current', COALESCE(bacd.qty, 0)
      ) ORDER BY d.display_order, d.value)
      FROM public.denominations d
      JOIN public.branch_auxiliary_cash_denoms bacd
        ON bacd.denomination_id = d.id
       AND bacd.branch_id = p_branch_id
      WHERE d.is_active = true
        AND bacd.is_enabled = true
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
          JOIN public.branch_auxiliary_cash_denoms bacd
            ON bacd.denomination_id = d.id
           AND bacd.branch_id = p_branch_id
           AND bacd.is_enabled = true
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

-- Ya no se cierra: la caja es permanente. Función no-op segura para clientes viejos.
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
BEGIN
  RAISE EXCEPTION 'La caja auxiliar es permanente por sucursal y no se cierra por turno';
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_branch_auxiliary_cash(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_auxiliary_cash_register(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_auxiliary_cash_assignment(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.internal_apply_auxiliary_exchange_balances(uuid, uuid, jsonb, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_auxiliary_cash_exchange(uuid, uuid, uuid, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_auxiliary_cash_exchange(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auxiliary_cash_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_auxiliary_cash_register(uuid, uuid, text) TO authenticated;

ALTER TABLE public.branch_auxiliary_cash ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_auxiliary_cash_denoms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_auxiliary_cash_select" ON public.branch_auxiliary_cash;
CREATE POLICY "branch_auxiliary_cash_select"
ON public.branch_auxiliary_cash
FOR SELECT
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = branch_auxiliary_cash.branch_id
      AND cs.status = 'OPEN'
      AND cs.auxiliary_cashier_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "branch_auxiliary_cash_manage" ON public.branch_auxiliary_cash;
CREATE POLICY "branch_auxiliary_cash_manage"
ON public.branch_auxiliary_cash
FOR ALL
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "branch_auxiliary_cash_denoms_select" ON public.branch_auxiliary_cash_denoms;
CREATE POLICY "branch_auxiliary_cash_denoms_select"
ON public.branch_auxiliary_cash_denoms
FOR SELECT
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), branch_id)
  OR EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = branch_auxiliary_cash_denoms.branch_id
      AND cs.status = 'OPEN'
      AND cs.auxiliary_cashier_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "branch_auxiliary_cash_denoms_manage" ON public.branch_auxiliary_cash_denoms;
CREATE POLICY "branch_auxiliary_cash_denoms_manage"
ON public.branch_auxiliary_cash_denoms
FOR ALL
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

NOTIFY pgrst, 'reload schema';
