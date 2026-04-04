ALTER TABLE public.cash_shifts
ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.cash_shifts
ADD COLUMN IF NOT EXISTS closed_from_device text;

ALTER TABLE public.cash_shifts
ADD COLUMN IF NOT EXISTS closed_from_user_agent text;

DROP FUNCTION IF EXISTS public.close_cash_shift_with_tables(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL,
  p_closed_from_device text DEFAULT NULL,
  p_closed_from_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_status public.caja_status;
  v_pending_orders_count integer := 0;
  v_pending_orders_preview text := '';
  v_actor_id uuid := auth.uid();
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  IF NOT public.can_manage_branch_admin(v_actor_id, p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar turno en esta sucursal';
  END IF;

  SELECT caja_status
  INTO v_caja_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  IF v_caja_status = 'OPEN' THEN
    RAISE EXCEPTION 'No puedes cerrar el turno porque la caja esta abierta. Cierra la caja en el modulo Caja y vuelve a intentarlo.';
  END IF;

  PERFORM public.cancel_empty_draft_orders_for_branch(p_branch_id);

  SELECT COUNT(*)
  INTO v_pending_orders_count
  FROM public.list_branch_closure_blocking_orders(p_branch_id);

  IF v_pending_orders_count > 0 THEN
    SELECT COALESCE(string_agg(reference_label, ', '), '')
    INTO v_pending_orders_preview
    FROM (
      SELECT reference_label
      FROM public.list_branch_closure_blocking_orders(p_branch_id)
      LIMIT 5
    ) AS pending_refs;

    RAISE EXCEPTION
      'No puedes cerrar el turno porque aun existen ordenes o cobros pendientes. Finaliza o cobra esas ordenes primero.%s',
      CASE
        WHEN v_pending_orders_preview <> '' THEN ' Referencias: ' || v_pending_orders_preview
        ELSE ''
      END;
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes,
      closed_by = v_actor_id,
      closed_from_device = NULLIF(btrim(COALESCE(p_closed_from_device, '')), ''),
      closed_from_user_agent = NULLIF(btrim(COALESCE(p_closed_from_user_agent, '')), '')
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
