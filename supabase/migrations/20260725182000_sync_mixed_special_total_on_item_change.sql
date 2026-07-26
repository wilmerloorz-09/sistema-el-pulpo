-- Mantiene special_total_manual al dia en ordenes especiales MIXTAS
-- (special_group_total + suma real de unidades no especiales).

CREATE OR REPLACE FUNCTION public.sincronizar_total_especial_mixta(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group numeric;
  v_rest numeric := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.special_group_total
  INTO v_group
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.is_special = true
    AND o.special_group_total IS NOT NULL;

  IF NOT FOUND OR v_group IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(GREATEST(oi.quantity - oi.cantidad_especial, 0) * oi.unit_price), 0)
  INTO v_rest
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id
    AND oi.status <> 'CANCELLED';

  UPDATE public.orders AS o
  SET
    special_total_manual = ROUND(v_group + v_rest, 2),
    updated_at = now()
  WHERE o.id = p_order_id
    AND (
      o.special_total_manual IS DISTINCT FROM ROUND(v_group + v_rest, 2)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_total_especial_mixta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  PERFORM public.sincronizar_total_especial_mixta(v_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS order_items_sync_mixed_special_total ON public.order_items;
CREATE TRIGGER order_items_sync_mixed_special_total
AFTER INSERT OR DELETE OR UPDATE OF quantity, unit_price, cantidad_especial, status, tray_container_cost
ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sincronizar_total_especial_mixta();

-- Backfill de ordenes mixtas ya existentes con total desfasado.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders AS o
    WHERE o.is_special = true
      AND o.special_group_total IS NOT NULL
      AND o.status NOT IN ('PAID', 'CANCELLED')
  LOOP
    PERFORM public.sincronizar_total_especial_mixta(r.id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.sincronizar_total_especial_mixta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_total_especial_mixta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_total_especial_mixta(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
