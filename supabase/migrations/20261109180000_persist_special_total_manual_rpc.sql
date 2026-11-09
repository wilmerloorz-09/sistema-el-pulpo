-- Persiste Total Manual de orden especial (incluido $0) vía RPC SECURITY DEFINER
-- y lo aplica también al enviar a cocina, para no depender del UPDATE directo (RLS/silent no-op).

CREATE OR REPLACE FUNCTION public.actualizar_total_manual_especial(
  p_order_id uuid,
  p_special_total_manual numeric
)
RETURNS TABLE (
  order_id uuid,
  is_special boolean,
  special_total_manual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_total numeric;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  IF p_special_total_manual IS NULL THEN
    RAISE EXCEPTION 'El total manual es obligatorio (puede ser 0)';
  END IF;

  IF p_special_total_manual < 0 THEN
    RAISE EXCEPTION 'El total manual no puede ser negativo';
  END IF;

  v_total := ROUND(p_special_total_manual, 2);

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF COALESCE(v_order.is_special, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo se puede definir total manual en ordenes especiales';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede editar el total de una orden cerrada';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para actualizar el total manual';
  END IF;

  UPDATE public.orders AS o
  SET
    special_total_manual = v_total,
    updated_at = now()
  WHERE o.id = p_order_id;

  RETURN QUERY
  SELECT o.id, o.is_special, o.special_total_manual
  FROM public.orders AS o
  WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_total_manual_especial(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_total_manual_especial(uuid, numeric) TO authenticated;

-- Reemplaza la firma de 1 arg por una con total manual opcional.
DROP FUNCTION IF EXISTS public.submit_order_draft_items(uuid);
DROP FUNCTION IF EXISTS public.submit_order_draft_items(uuid, numeric);

CREATE OR REPLACE FUNCTION public.submit_order_draft_items(
  p_order_id uuid,
  p_special_total_manual numeric DEFAULT NULL
)
RETURNS TABLE(order_id uuid, order_status order_status, submitted_item_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_has_operate_permission boolean := false;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_can_access_orders boolean := false;
  v_is_supervisor boolean := false;
  v_draft_count integer := 0;
  v_next_status public.order_status;
  v_new_order_number integer;
  v_new_order_code text;
  v_especial_cero boolean := false;
  v_autopagar_al_enviar boolean := false;
  v_reabrir_despachada boolean := false;
  v_manual numeric := NULL;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es obligatorio';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede enviar una orden cerrada.';
  END IF;

  v_reabrir_despachada := v_order.status = 'KITCHEN_DISPATCHED';

  SELECT
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_user_enabled,
    v_can_serve_tables,
    v_can_access_orders,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = v_order.branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, v_order.branch_id)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_can_access_orders, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos operativos para enviar esta orden.';
  END IF;

  -- Especial no mixta: exigir y persistir Total Manual (incluye $0) al enviar.
  IF COALESCE(v_order.is_special, false)
     AND v_order.special_group_total IS NULL THEN
    v_manual := COALESCE(p_special_total_manual, v_order.special_total_manual);
    IF v_manual IS NULL THEN
      RAISE EXCEPTION 'Ingresa el total manual antes de enviar';
    END IF;
    IF v_manual < 0 THEN
      RAISE EXCEPTION 'El total manual no puede ser negativo';
    END IF;
    v_manual := ROUND(v_manual, 2);

    UPDATE public.orders o
    SET
      special_total_manual = v_manual,
      updated_at = v_now
    WHERE o.id = p_order_id;

    v_order.special_total_manual := v_manual;
  ELSIF p_special_total_manual IS NOT NULL THEN
    IF p_special_total_manual < 0 THEN
      RAISE EXCEPTION 'El total manual no puede ser negativo';
    END IF;
    v_manual := ROUND(p_special_total_manual, 2);
    UPDATE public.orders o
    SET
      special_total_manual = v_manual,
      updated_at = v_now
    WHERE o.id = p_order_id;
    v_order.special_total_manual := v_manual;
  END IF;

  SELECT COUNT(*)
  INTO v_draft_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_draft_count <= 0 THEN
    RAISE EXCEPTION 'No hay items pendientes por enviar.';
  END IF;

  PERFORM public.inventario_descontar_draft_orden(p_order_id, v_order.branch_id, v_actor_id);

  UPDATE public.order_items oi
  SET
    status = 'SENT',
    sent_to_kitchen_at = COALESCE(oi.sent_to_kitchen_at, v_now)
  WHERE oi.order_id = p_order_id
    AND oi.status = 'DRAFT'
    AND COALESCE(oi.quantity, 0) > 0;

  -- Autopago al enviar permanece desactivado (se hace al despachar/servir).
  v_especial_cero := false;
  v_autopagar_al_enviar := false;

  v_next_status := CASE
    WHEN v_autopagar_al_enviar THEN 'PAID'::public.order_status
    ELSE 'SENT_TO_KITCHEN'::public.order_status
  END;

  v_new_order_number := v_order.order_number;
  v_new_order_code := v_order.order_code;

  IF v_new_order_code IS NULL OR btrim(v_new_order_code) = '' THEN
    SELECT a.out_order_code, a.out_order_number
      INTO v_new_order_code, v_new_order_number
    FROM public.allocate_order_numbering(
      v_order.branch_id,
      v_order.order_type,
      COALESCE(v_order.created_at, v_now),
      NULL
    ) a;
  ELSIF v_new_order_number IS NULL THEN
    v_new_order_number := public.order_number_from_order_code(v_new_order_code);
  END IF;

  UPDATE public.orders o
  SET
    status = v_next_status,
    order_number = v_new_order_number,
    order_code = v_new_order_code,
    sent_to_kitchen_at = COALESCE(o.sent_to_kitchen_at, v_now),
    paid_at = CASE
      WHEN v_autopagar_al_enviar THEN v_now
      WHEN v_reabrir_despachada THEN o.paid_at
      ELSE NULL
    END,
    dispatched_at = CASE
      WHEN v_reabrir_despachada THEN o.dispatched_at
      ELSE NULL
    END,
    updated_at = v_now
  WHERE o.id = p_order_id;

  IF v_autopagar_al_enviar THEN
    PERFORM public.autopagar_orden_especial_cero_interna(p_order_id, v_actor_id);
    SELECT o.status INTO v_next_status FROM public.orders o WHERE o.id = p_order_id;
  END IF;

  RETURN QUERY
  SELECT
    v_order.id,
    v_next_status,
    v_draft_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_order_draft_items(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_draft_items(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
