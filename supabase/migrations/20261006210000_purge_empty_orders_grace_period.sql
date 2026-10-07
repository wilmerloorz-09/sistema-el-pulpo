-- =============================================================================
-- Purgas masivas de ordenes vacias: margen de 5 minutos
-- =============================================================================
-- Las purgas por mesa y por sucursal borraban borradores vacios recien creados
-- que alguien estaba usando (apertura de mesa en curso, otro dispositivo), y el
-- mesero recibia "Orden no encontrada." al agregar el primer producto.
-- purge_empty_order / purge_empty_dine_in_draft_order (al salir de la orden) no
-- cambian: siguen borrando de inmediato.
-- La purga por sucursal ahora solo recorre ordenes sin items (antes iteraba
-- todo el historial de TAKEOUT/EXPRESS/EXTRA en cada apertura de Mesas).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.purge_empty_dine_in_draft_orders_for_table(
  p_table_id uuid,
  p_keep_order_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF p_table_id IS NULL OR auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.table_id = p_table_id
      AND o.order_type = 'DINE_IN'
      AND o.table_id IS NOT NULL
      AND COALESCE(o.is_special, false) = false
      AND COALESCE(o.is_tray_order, false) = false
      AND o.status = 'DRAFT'
      AND o.sent_to_kitchen_at IS NULL
      AND o.ready_at IS NULL
      AND o.dispatched_at IS NULL
      AND (o.created_at IS NULL OR o.created_at < now() - interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
        LIMIT 1
      )
      AND (p_keep_order_id IS NULL OR o.id IS DISTINCT FROM p_keep_order_id)
    ORDER BY o.id
  LOOP
    IF public.purge_empty_dine_in_draft_order(r.id) IS NOT NULL THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_empty_dine_in_draft_orders_for_table(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_empty_dine_in_draft_orders_for_table(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_empty_orders_for_branch(
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND (
        (o.order_type = 'DINE_IN' AND o.status = 'DRAFT')
        OR
        (o.order_type IN ('TAKEOUT', 'EXPRESS', 'EXTRA'))
      )
      AND (o.created_at IS NULL OR o.created_at < now() - interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
        LIMIT 1
      )
  LOOP
    IF public.purge_empty_order(r.id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_empty_orders_for_branch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
