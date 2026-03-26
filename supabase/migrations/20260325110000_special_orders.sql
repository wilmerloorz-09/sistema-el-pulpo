ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_special boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_total_manual numeric(10,2),
  ADD COLUMN IF NOT EXISTS special_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS special_marked_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS special_origin_table_id uuid REFERENCES public.restaurant_tables(id),
  ADD COLUMN IF NOT EXISTS special_origin_split_id uuid REFERENCES public.table_splits(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_special_total_manual_non_negative'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_special_total_manual_non_negative
      CHECK (special_total_manual IS NULL OR special_total_manual >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_branch_special_status
  ON public.orders(branch_id, is_special, status);

CREATE OR REPLACE FUNCTION public.convert_order_to_special(
  p_order_id uuid,
  p_special_total_manual numeric DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  is_special boolean,
  special_total_manual numeric,
  source_table_id uuid,
  source_split_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_source_table_id uuid;
  v_source_split_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF p_special_total_manual IS NOT NULL AND p_special_total_manual < 0 THEN
    RAISE EXCEPTION 'El total especial no puede ser negativo';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden convertir a especial las ordenes de mesa';
  END IF;

  IF v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'La orden ya no esta asociada a una mesa activa';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede convertir una orden pagada o cancelada';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para convertir esta orden';
  END IF;

  v_source_table_id := v_order.table_id;
  v_source_split_id := v_order.split_id;

  UPDATE public.orders
  SET
    is_special = true,
    special_total_manual = COALESCE(p_special_total_manual, special_total_manual),
    special_marked_at = now(),
    special_marked_by = v_actor_id,
    special_origin_table_id = COALESCE(special_origin_table_id, v_order.table_id),
    special_origin_split_id = COALESCE(special_origin_split_id, v_order.split_id),
    table_id = NULL,
    split_id = NULL,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_source_split_id IS NOT NULL THEN
    UPDATE public.table_splits
    SET is_active = false
    WHERE id = v_source_split_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.split_id = v_source_split_id
          AND o.id <> p_order_id
          AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
      );
  END IF;

  PERFORM public.normalize_single_remaining_split_for_table(v_source_table_id);

  RETURN QUERY
  SELECT
    o.id,
    o.is_special,
    o.special_total_manual,
    v_source_table_id,
    v_source_split_id
  FROM public.orders o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_order_to_special(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_order_to_special(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
