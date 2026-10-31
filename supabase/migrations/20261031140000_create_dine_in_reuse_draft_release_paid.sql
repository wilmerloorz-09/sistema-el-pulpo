-- =============================================================================
-- Evitar "La mesa ya tiene una orden activa" al reabrir mesas "libres":
-- 1) Reutilizar borrador vacío del turno (sin gracia de 5 min).
-- 2) Liberar table_id de órdenes PAID (o KD ya cobradas con paid_at) pegadas.
-- =============================================================================

-- Backfill: PAID / KD cobradas no deben seguir ocupando mesa.
UPDATE public.orders o
SET
  table_id = NULL,
  table_order_position = NULL,
  split_id = NULL,
  updated_at = now()
WHERE o.order_type = 'DINE_IN'
  AND o.table_id IS NOT NULL
  AND (
    o.status = 'PAID'
    OR (o.status = 'KITCHEN_DISPATCHED' AND o.paid_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.create_dine_in_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid DEFAULT NULL::uuid,
  p_is_special boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id               uuid    := auth.uid();
  v_shift_id               uuid;
  v_order_id               uuid;
  v_reuse_id               uuid;
  v_user_enabled           boolean := false;
  v_can_serve_tables       boolean := false;
  v_is_supervisor          boolean := false;
  v_has_operate_permission boolean := false;
  v_table_branch_id        uuid;
  v_table_is_active        boolean := false;
  v_table_name             text;
  v_table_order_position   integer := NULL;
  v_is_special             boolean := COALESCE(p_is_special, false);
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

  IF v_is_special IS NOT TRUE AND p_table_id IS NULL THEN
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
   AND csu.user_id  = v_actor_id
  WHERE cs.branch_id = p_branch_id
    AND cs.status    = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno abierto para esta sucursal.';
  END IF;

  v_has_operate_permission := (
    public.can_manage_branch_admin(v_actor_id, p_branch_id)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'mesas',   'OPERATE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_branch_id, 'ordenes', 'OPERATE'::public.access_level)
  );

  IF (
    COALESCE(v_user_enabled, false) IS NOT TRUE
    OR (
      COALESCE(v_can_serve_tables, false) IS NOT TRUE
      AND COALESCE(v_is_supervisor,   false) IS NOT TRUE
    )
  ) AND v_has_operate_permission IS NOT TRUE THEN
    RAISE EXCEPTION 'No tienes permisos para abrir ordenes de mesa en este turno.';
  END IF;

  IF p_table_id IS NOT NULL THEN
    SELECT rt.branch_id, rt.is_active, rt.name
    INTO v_table_branch_id, v_table_is_active, v_table_name
    FROM public.restaurant_tables rt
    WHERE rt.id = p_table_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La mesa no existe.';
    END IF;

    IF v_table_branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'La mesa no pertenece a la sucursal activa.';
    END IF;

    IF v_is_special IS NOT TRUE THEN
      IF v_table_is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'La mesa no esta habilitada en el turno actual.';
      END IF;

      -- Liberar ocupación fantasma: PAID / KD ya cobrada siguen con table_id.
      UPDATE public.orders o
      SET
        table_id = NULL,
        table_order_position = NULL,
        split_id = NULL,
        updated_at = now()
      WHERE o.table_id = p_table_id
        AND o.order_type = 'DINE_IN'
        AND o.cash_shift_id = v_shift_id
        AND (
          o.status = 'PAID'
          OR (o.status = 'KITCHEN_DISPATCHED' AND o.paid_at IS NOT NULL)
        );

      -- Reutilizar borrador vacío del turno (evita el error por DRAFT fantasma).
      SELECT o.id
      INTO v_reuse_id
      FROM public.orders o
      WHERE o.table_id = p_table_id
        AND o.order_type = 'DINE_IN'
        AND o.cash_shift_id = v_shift_id
        AND o.status = 'DRAFT'
        AND COALESCE(o.is_special, false) = false
        AND COALESCE(o.is_tray_order, false) = false
        AND o.sent_to_kitchen_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id LIMIT 1
        )
      ORDER BY COALESCE(o.updated_at, o.created_at) DESC, o.created_at DESC
      LIMIT 1;

      IF v_reuse_id IS NOT NULL THEN
        RETURN v_reuse_id;
      END IF;

      -- Solo bloquea órdenes realmente activas (con ítems o ya enviadas/pagadas).
      IF EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.table_id = p_table_id
          AND o.order_type = 'DINE_IN'
          AND o.cash_shift_id = v_shift_id
          AND (
            o.status IN ('SENT_TO_KITCHEN', 'READY', 'PAID')
            OR (
              o.status = 'DRAFT'
              AND EXISTS (
                SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id LIMIT 1
              )
            )
          )
      ) THEN
        RAISE EXCEPTION 'La mesa ya tiene una orden activa.';
      END IF;

      SELECT COALESCE(MAX(o.table_order_position), 0) + 1
      INTO v_table_order_position
      FROM public.orders o
      WHERE o.table_id = p_table_id
        AND o.order_type = 'DINE_IN'
        AND o.cash_shift_id = v_shift_id
        AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID', 'KITCHEN_DISPATCHED');
    END IF;
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
    special_origin_table_id,
    table_name_snapshot,
    created_by,
    cash_shift_id
  )
  VALUES (
    p_branch_id,
    CASE WHEN v_is_special THEN NULL ELSE p_table_id END,
    CASE WHEN v_is_special THEN NULL ELSE v_table_order_position END,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    v_is_special,
    CASE WHEN v_is_special THEN now() ELSE NULL END,
    CASE WHEN v_is_special THEN v_actor_id ELSE NULL END,
    CASE WHEN v_is_special THEN p_table_id ELSE NULL END,
    CASE WHEN v_is_special THEN NULLIF(btrim(COALESCE(v_table_name, '')), '') ELSE NULL END,
    v_actor_id,
    v_shift_id
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
