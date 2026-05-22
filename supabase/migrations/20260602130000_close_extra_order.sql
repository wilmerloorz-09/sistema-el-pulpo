-- Cerrar orden Extra despachada (desde tarjeta en modulo Extra).

CREATE OR REPLACE FUNCTION public.close_extra_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.order_type::text, '') <> 'EXTRA'
     OR COALESCE(v_order.is_special, false)
     OR COALESCE(v_order.is_tray_order, false) THEN
    RAISE EXCEPTION 'La orden no es Extra';
  END IF;

  IF v_order.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Solo el creador puede cerrar esta orden Extra';
  END IF;

  IF v_order.closed_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_order.status::text, '') <> 'KITCHEN_DISPATCHED' THEN
    RAISE EXCEPTION 'Solo puedes cerrar ordenes Extra despachadas';
  END IF;

  UPDATE public.orders
  SET
    closed_at = v_now,
    locked_for_editing = true,
    updated_at = v_now
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_extra_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_extra_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
