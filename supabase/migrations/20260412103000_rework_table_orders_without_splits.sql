ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS table_order_position integer;

COMMENT ON COLUMN public.orders.table_order_position IS
'Posicion visible y operativa de la orden dentro de una mesa activa. Se usa para mostrar Orden 1, Orden 2, etc.';

CREATE OR REPLACE FUNCTION public.next_table_order_position(
  p_table_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer := 1;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN 1;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('next_table_order_position:' || p_table_id::text));

  SELECT COALESCE(MAX(o.table_order_position), 0) + 1
  INTO v_next
  FROM public.orders o
  WHERE o.table_id = p_table_id
    AND o.order_type = 'DINE_IN'
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  RETURN GREATEST(COALESCE(v_next, 1), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.next_table_order_position(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_table_order_position(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.compact_table_order_positions(
  p_table_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  WITH ordered AS (
    SELECT
      o.id,
      ROW_NUMBER() OVER (
        ORDER BY
          COALESCE(o.table_order_position, 2147483647),
          o.created_at,
          COALESCE(o.order_number, 2147483647),
          o.id
      )::int AS next_position
    FROM public.orders o
    WHERE o.table_id = p_table_id
      AND o.order_type = 'DINE_IN'
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  )
  UPDATE public.orders o
  SET table_order_position = ordered.next_position,
      updated_at = now()
  FROM ordered
  WHERE ordered.id = o.id
    AND o.table_order_position IS DISTINCT FROM ordered.next_position;
END;
$$;

REVOKE ALL ON FUNCTION public.compact_table_order_positions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compact_table_order_positions(uuid) TO authenticated;

WITH ranked AS (
  SELECT
    o.id,
    ROW_NUMBER() OVER (
      PARTITION BY o.table_id
      ORDER BY
        o.created_at,
        COALESCE(o.order_number, 2147483647),
        o.id
    )::int AS next_position
  FROM public.orders o
  WHERE o.table_id IS NOT NULL
    AND o.order_type = 'DINE_IN'
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
)
UPDATE public.orders o
SET table_order_position = ranked.next_position
FROM ranked
WHERE ranked.id = o.id
  AND o.table_order_position IS DISTINCT FROM ranked.next_position;

UPDATE public.orders
SET table_order_position = NULL
WHERE table_id IS NULL
   OR order_type <> 'DINE_IN'
   OR status IN ('PAID', 'CANCELLED');

CREATE OR REPLACE FUNCTION public.create_dine_in_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid DEFAULT NULL,
  p_is_special boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shift_id uuid;
  v_order_id uuid;
  v_user_enabled boolean := false;
  v_can_serve_tables boolean := false;
  v_is_supervisor boolean := false;
  v_has_operate_permission boolean := false;
  v_table_branch_id uuid;
  v_table_is_active boolean := false;
  v_table_order_position integer := NULL;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'created_by es obligatorio';
  END IF;

  IF v_actor_id IS NULL OR v_actor_id <> p_created_by THEN
    RAISE EXCEPTION 'Usuario no autenticado o inconsistente';
  END IF;

  IF COALESCE(p_is_special, false) IS NOT TRUE AND p_table_id IS NULL THEN
    RAISE EXCEPTION 'La mesa es obligatoria para abrir una orden de mesa';
  END IF;

  SELECT
    cs.id,
    COALESCE(csu.is_enabled, false),
    COALESCE(csu.can_serve_tables, false),
    COALESCE(csu.is_supervisor, false)
  INTO
    v_shift_id,
    v_user_enabled,
    v_can_serve_tables,
    v_is_supervisor
  FROM public.cash_shifts cs
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = cs.id
   AND csu.user_id = v_actor_id
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, p_branch_id)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor, false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para abrir ordenes de mesa en este turno.';
  END IF;

  IF p_table_id IS NOT NULL THEN
    SELECT rt.branch_id, rt.is_active
    INTO v_table_branch_id, v_table_is_active
    FROM public.restaurant_tables rt
    WHERE rt.id = p_table_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La mesa no existe.';
    END IF;

    IF v_table_branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'La mesa no pertenece a la sucursal activa.';
    END IF;

    IF v_table_is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'La mesa no esta habilitada en el turno actual.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id = p_table_id
        AND o.order_type = 'DINE_IN'
        AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    ) THEN
      RAISE EXCEPTION 'La mesa ya tiene una orden activa.';
    END IF;

    v_table_order_position := public.next_table_order_position(p_table_id);
  END IF;

  INSERT INTO public.orders (
    branch_id,
    table_id,
    table_order_position,
    order_type,
    menu_scope,
    status,
    is_special,
    special_marked_at,
    special_marked_by,
    created_by
  )
  VALUES (
    p_branch_id,
    CASE WHEN COALESCE(p_is_special, false) THEN NULL ELSE p_table_id END,
    CASE WHEN COALESCE(p_is_special, false) THEN NULL ELSE v_table_order_position END,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    COALESCE(p_is_special, false),
    CASE WHEN COALESCE(p_is_special, false) THEN now() ELSE NULL END,
    CASE WHEN COALESCE(p_is_special, false) THEN v_actor_id ELSE NULL END,
    v_actor_id
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_dine_in_order(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dine_in_order(uuid, uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_additional_dine_in_order(
  p_source_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_order public.orders%ROWTYPE;
  v_new_order_id uuid;
  v_has_permission boolean := false;
  v_next_position integer := 1;
BEGIN
  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden origen es obligatoria';
  END IF;

  SELECT o.*
  INTO v_source_order
  FROM public.orders o
  WHERE o.id = p_source_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden origen';
  END IF;

  IF v_source_order.order_type <> 'DINE_IN'
    OR v_source_order.table_id IS NULL
    OR COALESCE(v_source_order.is_special, false)
  THEN
    RAISE EXCEPTION 'Solo puedes crear ordenes adicionales desde una orden de mesa activa';
  END IF;

  IF v_source_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'La orden origen ya no admite nuevas ordenes hermanas';
  END IF;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_source_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_source_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'No tienes permisos para crear una nueva orden en esta mesa';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_source_order.table_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  ) THEN
    RAISE EXCEPTION 'Todas las ordenes activas de la mesa deben tener al menos un item antes de crear otra';
  END IF;

  v_next_position := public.next_table_order_position(v_source_order.table_id);

  INSERT INTO public.orders (
    branch_id,
    table_id,
    table_order_position,
    order_type,
    menu_scope,
    status,
    is_special,
    created_by
  )
  VALUES (
    v_source_order.branch_id,
    v_source_order.table_id,
    v_next_position,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    false,
    auth.uid()
  )
  RETURNING id INTO v_new_order_id;

  RETURN v_new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_additional_dine_in_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_additional_dine_in_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_dine_in_table_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next_order_id uuid;
  v_has_permission boolean := false;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden es obligatoria';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Solo puedes eliminar ordenes activas de mesa';
  END IF;

  IF v_order.status <> 'DRAFT'
    OR v_order.sent_to_kitchen_at IS NOT NULL
    OR v_order.ready_at IS NOT NULL
    OR v_order.dispatched_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Solo puedes eliminar una orden borrador que aun no haya sido enviada';
  END IF;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar esta orden';
  END IF;

  DELETE FROM public.order_item_modifiers oim
  USING public.order_items oi
  WHERE oi.id = oim.order_item_id
    AND oi.order_id = p_order_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_order.table_id);

  SELECT o.id
  INTO v_next_order_id
  FROM public.orders o
  WHERE o.table_id = v_order.table_id
    AND o.order_type = 'DINE_IN'
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  ORDER BY
    COALESCE(o.table_order_position, 2147483647),
    o.created_at,
    COALESCE(o.order_number, 2147483647),
    o.id
  LIMIT 1;

  RETURN v_next_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_dine_in_table_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_dine_in_table_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_dine_in_order_for_payment(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_name text := 'Mesa';
  v_now timestamptz := now();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'La orden es obligatoria';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden';
  END IF;

  IF v_order.order_type <> 'DINE_IN' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Solo puedes cerrar ordenes activas de mesa';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'La orden ya no puede cerrarse';
  END IF;

  SELECT rt.name
  INTO v_table_name
  FROM public.restaurant_tables rt
  WHERE rt.id = v_order.table_id;

  UPDATE public.orders
  SET table_name_snapshot = COALESCE(NULLIF(trim(v_table_name), ''), 'Mesa'),
      table_id = NULL,
      table_order_position = NULL,
      split_id = NULL,
      status = 'KITCHEN_DISPATCHED',
      dispatched_at = COALESCE(v_order.dispatched_at, v_now),
      updated_at = v_now
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_order.table_id);
END;
$$;

REVOKE ALL ON FUNCTION public.close_dine_in_order_for_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_dine_in_order_for_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_dine_in_order_to_table(
  p_order_id uuid,
  p_destination_table_id uuid
)
RETURNS TABLE (
  order_id uuid,
  table_id uuid,
  split_id uuid,
  split_code text,
  destination_was_occupied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_destination_table public.restaurant_tables%ROWTYPE;
  v_source_table_id uuid;
  v_destination_occupied boolean := false;
  v_has_permission boolean := false;
  v_lock_key_a text;
  v_lock_key_b text;
  v_placeholder_order record;
  v_destination_position integer := 1;
BEGIN
  IF p_order_id IS NULL OR p_destination_table_id IS NULL THEN
    RAISE EXCEPTION 'order_id y destination_table_id son obligatorios';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la orden a mover';
  END IF;

  IF v_order.order_type <> 'DINE_IN' THEN
    RAISE EXCEPTION 'Solo se pueden cambiar mesas para ordenes DINE_IN';
  END IF;

  IF v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'La orden no tiene una mesa origen asociada';
  END IF;

  IF v_order.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'No se puede cambiar de mesa una orden pagada o cancelada';
  END IF;

  IF v_order.table_id = p_destination_table_id THEN
    RAISE EXCEPTION 'La mesa destino debe ser distinta de la mesa origen';
  END IF;

  SELECT rt.*
  INTO v_destination_table
  FROM public.restaurant_tables rt
  WHERE rt.id = p_destination_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro la mesa destino';
  END IF;

  IF v_destination_table.branch_id <> v_order.branch_id THEN
    RAISE EXCEPTION 'La mesa destino no pertenece a la misma sucursal de la orden';
  END IF;

  IF NOT COALESCE(v_destination_table.is_active, false) THEN
    RAISE EXCEPTION 'La mesa destino no esta habilitada en el turno actual';
  END IF;

  v_has_permission := (
    public.can_manage_branch_admin(auth.uid(), v_order.branch_id)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'mesas', 'OPERATE'::public.access_level)
    OR public.has_branch_permission(auth.uid(), v_order.branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'No tienes permisos para cambiar esta orden de mesa';
  END IF;

  v_lock_key_a := LEAST(v_order.table_id::text, p_destination_table_id::text);
  v_lock_key_b := GREATEST(v_order.table_id::text, p_destination_table_id::text);

  PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_a));
  IF v_lock_key_b <> v_lock_key_a THEN
    PERFORM pg_advisory_xact_lock(hashtext('move_dine_in_order_to_table:' || v_lock_key_b));
  END IF;

  v_source_table_id := v_order.table_id;

  FOR v_placeholder_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.order_type = 'DINE_IN'
      AND o.status = 'DRAFT'
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      )
  LOOP
    DELETE FROM public.orders
    WHERE id = v_placeholder_order.id;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_destination_table_id
      AND o.id <> p_order_id
      AND o.order_type = 'DINE_IN'
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  )
  INTO v_destination_occupied;

  v_destination_position := public.next_table_order_position(p_destination_table_id);

  UPDATE public.orders
  SET table_id = p_destination_table_id,
      table_order_position = v_destination_position,
      split_id = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.compact_table_order_positions(v_source_table_id);
  PERFORM public.compact_table_order_positions(p_destination_table_id);

  RETURN QUERY
  SELECT
    v_order.id,
    p_destination_table_id,
    NULL::uuid,
    NULL::text,
    v_destination_occupied;
END;
$$;

REVOKE ALL ON FUNCTION public.move_dine_in_order_to_table(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_dine_in_order_to_table(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_voided_dine_in_order_to_table(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.order_type <> 'DINE_IN'
    OR v_order.table_id IS NULL
    OR v_order.status NOT IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  THEN
    RETURN;
  END IF;

  IF v_order.table_order_position IS NULL THEN
    UPDATE public.orders
    SET table_order_position = public.next_table_order_position(v_order.table_id),
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  PERFORM public.compact_table_order_positions(v_order.table_id);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_voided_dine_in_order_to_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_voided_dine_in_order_to_table(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_branch_tables_overview(
  p_branch_id uuid
)
RETURNS TABLE (
  table_id uuid,
  table_name text,
  visual_order integer,
  table_is_active boolean,
  status text,
  active_order_id uuid,
  active_order_status text,
  split_count integer,
  total_due numeric,
  split_totals jsonb,
  item_count integer,
  elapsed_minutes integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_shift AS (
    SELECT GREATEST(COALESCE(cs.active_tables_count, 0), 0)::int AS active_tables_count
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ),
  visible_tables AS (
    SELECT
      rt.id,
      rt.name,
      rt.visual_order,
      rt.is_active
    FROM public.restaurant_tables rt
    WHERE rt.branch_id = p_branch_id
    ORDER BY rt.visual_order ASC, rt.name ASC
    LIMIT GREATEST(0, COALESCE((SELECT active_tables_count FROM open_shift), 0))
  ),
  table_orders AS (
    SELECT
      o.id,
      o.table_id,
      o.table_order_position,
      o.status::text AS status,
      o.created_at,
      o.updated_at,
      COUNT(oi.id)::int AS total_items
    FROM public.orders o
    JOIN visible_tables vt
      ON vt.id = o.table_id
    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id
    WHERE o.branch_id = p_branch_id
      AND o.table_id IS NOT NULL
      AND o.order_type = 'DINE_IN'
      AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    GROUP BY o.id, o.table_id, o.table_order_position, o.status, o.created_at, o.updated_at
  ),
  visible_orders AS (
    SELECT *
    FROM table_orders
    WHERE status <> 'DRAFT' OR total_items > 0
  ),
  empty_drafts AS (
    SELECT DISTINCT ON (to1.table_id)
      to1.table_id,
      to1.id AS draft_order_id,
      to1.created_at AS draft_created_at
    FROM table_orders to1
    WHERE to1.status = 'DRAFT'
      AND to1.total_items = 0
    ORDER BY
      to1.table_id,
      COALESCE(to1.table_order_position, 2147483647),
      COALESCE(to1.updated_at, to1.created_at) DESC,
      to1.created_at DESC
  ),
  order_snapshots AS (
    SELECT
      vo.id AS order_id,
      snapshot.order_item_id,
      snapshot.quantity_ordered,
      snapshot.quantity_paid,
      snapshot.quantity_cancelled_total,
      snapshot.unit_price
    FROM visible_orders vo
    LEFT JOIN LATERAL public.get_order_operational_snapshot(vo.id) snapshot
      ON TRUE
  ),
  order_totals AS (
    SELECT
      vo.id AS order_id,
      vo.table_id,
      vo.table_order_position,
      vo.status,
      vo.created_at,
      vo.updated_at,
      vo.total_items,
      ROUND(
        COALESCE(
          SUM(
            GREATEST(
              0,
              GREATEST(COALESCE(os.quantity_ordered, 0) - COALESCE(os.quantity_cancelled_total, 0), 0)
              - LEAST(
                  GREATEST(COALESCE(os.quantity_ordered, 0) - COALESCE(os.quantity_cancelled_total, 0), 0),
                  COALESCE(os.quantity_paid, 0)
                )
            )::numeric * COALESCE(os.unit_price, 0)
          ),
          0
        ),
        2
      ) AS total_due
    FROM visible_orders vo
    LEFT JOIN order_snapshots os
      ON os.order_id = vo.id
    GROUP BY vo.id, vo.table_id, vo.table_order_position, vo.status, vo.created_at, vo.updated_at, vo.total_items
  ),
  representative_orders AS (
    SELECT DISTINCT ON (ot.table_id)
      ot.table_id,
      ot.order_id,
      ot.status AS order_status,
      ot.created_at
    FROM order_totals ot
    ORDER BY
      ot.table_id,
      CASE WHEN ot.status = 'DRAFT' THEN 1 ELSE 0 END,
      COALESCE(ot.table_order_position, 2147483647),
      COALESCE(ot.updated_at, ot.created_at) DESC,
      ot.created_at DESC,
      ot.order_id
  ),
  order_rollups AS (
    SELECT
      ot.table_id,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'split_id', ot.order_id,
          'split_code', 'Orden ' || COALESCE(ot.table_order_position::text, '?'),
          'total_due', ot.total_due
        )
        ORDER BY COALESCE(ot.table_order_position, 2147483647), ot.created_at, ot.order_id
      ) FILTER (WHERE ot.total_due > 0) AS split_totals
    FROM order_totals ot
    GROUP BY ot.table_id
  )
  SELECT
    vt.id AS table_id,
    vt.name AS table_name,
    vt.visual_order,
    vt.is_active AS table_is_active,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM order_totals ot
        WHERE ot.table_id = vt.id
          AND ot.status = 'KITCHEN_DISPATCHED'
      ) THEN 'to_pay'
      WHEN EXISTS (
        SELECT 1
        FROM table_orders to2
        WHERE to2.table_id = vt.id
      ) THEN 'occupied'
      ELSE 'free'
    END AS status,
    COALESCE(ro.order_id, ed.draft_order_id) AS active_order_id,
    COALESCE(ro.order_status, CASE WHEN ed.draft_order_id IS NOT NULL THEN 'DRAFT' ELSE NULL END) AS active_order_status,
    COALESCE((
      SELECT COUNT(*)
      FROM table_orders to3
      WHERE to3.table_id = vt.id
    ), 0)::int AS split_count,
    ROUND(COALESCE((
      SELECT SUM(ot.total_due)
      FROM order_totals ot
      WHERE ot.table_id = vt.id
    ), 0), 2) AS total_due,
    COALESCE(orw.split_totals, '[]'::jsonb) AS split_totals,
    COALESCE((
      SELECT SUM(to4.total_items)
      FROM table_orders to4
      WHERE to4.table_id = vt.id
    ), 0)::int AS item_count,
    CASE
      WHEN COALESCE(ro.created_at, ed.draft_created_at) IS NULL THEN 0
      ELSE GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ro.created_at, ed.draft_created_at))) / 60)
      )::int
    END AS elapsed_minutes
  FROM visible_tables vt
  LEFT JOIN representative_orders ro
    ON ro.table_id = vt.id
  LEFT JOIN empty_drafts ed
    ON ed.table_id = vt.id
  LEFT JOIN order_rollups orw
    ON orw.table_id = vt.id
  ORDER BY vt.visual_order ASC, vt.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_branch_tables_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_tables_overview(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
