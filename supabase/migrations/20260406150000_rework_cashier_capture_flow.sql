WITH ranked_cashier_users AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY shift_id
      ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.cash_shift_users
  WHERE is_enabled = true
    AND can_use_caja = true
)
UPDATE public.cash_shift_users csu
SET can_use_caja = false,
    updated_at = now()
FROM ranked_cashier_users ranked
WHERE ranked.id = csu.id
  AND ranked.rn > 1;

DROP INDEX IF EXISTS public.ux_cash_shift_users_one_enabled_cashier_per_shift;
CREATE UNIQUE INDEX ux_cash_shift_users_one_enabled_cashier_per_shift
ON public.cash_shift_users (shift_id)
WHERE is_enabled = true
  AND can_use_caja = true;

UPDATE public.cash_shifts
SET capture_user_id = cashier_id,
    capture_device_label = NULL
WHERE cashier_id IS NOT NULL
  AND (
    capture_user_id IS DISTINCT FROM cashier_id
    OR capture_device_label IS NOT NULL
  );

DROP FUNCTION IF EXISTS public.open_cash_register(uuid, uuid, uuid, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.open_cash_register(uuid, uuid, uuid, jsonb);

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
  v_enabled_cashier_count integer := 0;
  v_configured_cashier_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  SELECT
    COUNT(*),
    MAX(user_id)
  INTO v_enabled_cashier_count, v_configured_cashier_id
  FROM public.cash_shift_users
  WHERE shift_id = p_shift_id
    AND is_enabled = true
    AND can_use_caja = true;

  IF v_enabled_cashier_count = 0 THEN
    RAISE EXCEPTION 'Debes habilitar un usuario con permiso de Caja en este turno antes de abrir caja';
  END IF;

  IF v_enabled_cashier_count > 1 THEN
    RAISE EXCEPTION 'Solo puede haber un usuario con permiso de Caja habilitado en este turno';
  END IF;

  IF v_configured_cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'Solo el usuario habilitado para Caja en este turno puede abrir caja';
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
  SET caja_status = 'OPEN',
      cashier_id = p_cashier_id,
      capture_user_id = p_cashier_id,
      capture_device_label = NULL
  WHERE id = p_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;

DROP POLICY IF EXISTS "Users can insert payment capture requests" ON public.payment_capture_requests;
CREATE POLICY "Users can insert payment capture requests"
ON public.payment_capture_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND (
    public.can_operate_cash_branch(auth.uid(), branch_id)
    OR public.can_manage_branch_admin(auth.uid(), branch_id)
  )
  AND EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.payments p ON p.id = payment_capture_requests.payment_id
    JOIN public.orders o ON o.id = p.order_id
    WHERE cs.id = payment_capture_requests.cash_session_id
      AND cs.branch_id = payment_capture_requests.branch_id
      AND cs.status = 'OPEN'
      AND cs.cashier_id = payment_capture_requests.assigned_capture_user_id
      AND o.branch_id = payment_capture_requests.branch_id
      AND p.created_by = auth.uid()
  )
);

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
