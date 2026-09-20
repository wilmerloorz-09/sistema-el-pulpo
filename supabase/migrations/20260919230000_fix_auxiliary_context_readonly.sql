-- get_auxiliary_cash_context es de lectura: no debe INSERT (fallaba en transacción read-only).

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
  v_has_stock boolean := false;
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

  v_has_stock := EXISTS (
    SELECT 1
    FROM public.branch_auxiliary_cash_denoms bacd
    WHERE bacd.branch_id = p_branch_id
  );

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
      LEFT JOIN public.branch_auxiliary_cash_denoms bacd
        ON bacd.denomination_id = d.id
       AND bacd.branch_id = p_branch_id
      WHERE d.is_active = true
        AND (
          NOT v_has_stock
          OR COALESCE(bacd.is_enabled, false) = true
        )
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
          LEFT JOIN public.branch_auxiliary_cash_denoms bacd
            ON bacd.denomination_id = d.id
           AND bacd.branch_id = p_branch_id
          LEFT JOIN public.cash_shift_denoms csd
            ON csd.denomination_id = d.id
           AND csd.opening_id = cro.id
          WHERE d.is_active = true
            AND (
              NOT v_has_stock
              OR COALESCE(bacd.is_enabled, false) = true
            )
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

GRANT EXECUTE ON FUNCTION public.get_auxiliary_cash_context(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
