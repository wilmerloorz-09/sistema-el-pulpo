-- =============================================================================
-- CAUSA RAÍZ: Mesas atrapadas por órdenes KITCHEN_DISPATCHED con table_id ≠ NULL
-- =============================================================================
--
-- Contexto:
--   El RPC close_dine_in_order_for_payment (encargado del despacho normal)
--   limpia table_id → NULL al mover una orden a KITCHEN_DISPATCHED.
--   Sin embargo, existen rutas alternativas (sync de pagos, anulaciones, etc.)
--   que ponen una orden en KITCHEN_DISPATCHED sin limpiar table_id.
--   Resultado: create_dine_in_order ve esa orden y lanza
--   "La mesa ya tiene una orden activa.", bloqueando silenciosamente la apertura.
--
-- Fix en dos capas:
--   1. BACKFILL: limpiar table_id/table_order_position de todas las órdenes
--      KITCHEN_DISPATCHED que todavía tienen table_id asignado.
--   2. GUARD: ajustar el check en create_dine_in_order para que
--      KITCHEN_DISPATCHED no bloquee nuevas órdenes (una orden despachada
--      ya no ocupa operativamente una mesa, independientemente del table_id).

-- ─── 1. BACKFILL: liberar table_id de órdenes ya despachadas ─────────────────
UPDATE public.orders
SET
  table_id             = NULL,
  table_order_position = NULL,
  split_id             = NULL,
  updated_at           = NOW()
WHERE status   = 'KITCHEN_DISPATCHED'
  AND table_id IS NOT NULL;

-- ─── 2. FIX: create_dine_in_order — el check de "mesa ocupada"
--      ya no incluye KITCHEN_DISPATCHED ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_dine_in_order(
  p_branch_id   uuid,
  p_created_by  uuid,
  p_table_id    uuid    DEFAULT NULL,
  p_is_special  boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_table_order_position   integer := NULL;
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

    -- Solo bloquear si hay órdenes ACTIVAS (no despachadas) en la mesa.
    -- KITCHEN_DISPATCHED se excluye: una orden despachada ya no ocupa
    -- la mesa operativamente, aunque tenga table_id por datos históricos.
    IF EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id    = p_table_id
        AND o.order_type  = 'DINE_IN'
        AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID')
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

NOTIFY pgrst, 'reload schema';
