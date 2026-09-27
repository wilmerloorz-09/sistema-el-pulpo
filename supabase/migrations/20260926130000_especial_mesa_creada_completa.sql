-- Orden especial de mesa: el RPC guarda la mesa de origen y el nombre al crear.
-- Mismas reglas de permiso; la mesa de una especial no se ocupa ni se valida como ocupada.

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

      -- Solo el turno abierto puede ocupar la mesa operativamente.
      -- Ordenes PAID/SENT_TO_KITCHEN de turnos cerrados no bloquean apertura en turno nuevo.
      IF EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.table_id = p_table_id
          AND o.order_type = 'DINE_IN'
          AND o.cash_shift_id = v_shift_id
          AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID')
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
