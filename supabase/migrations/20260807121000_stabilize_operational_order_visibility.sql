-- Estabiliza la visibilidad operativa evitando ordenes activas sin cash_shift_id.
-- Las listas de Caja/Despacho/Servir filtran por el turno abierto actual; una
-- orden sin cash_shift_id puede quedar invisible aunque su fecha pertenezca al
-- turno. Este trigger solo completa el campo cuando esta NULL.

CREATE OR REPLACE FUNCTION public.assign_open_cash_shift_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF NEW.cash_shift_id IS NOT NULL OR NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status::text, 'DRAFT') NOT IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID') THEN
    RETURN NEW;
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = NEW.branch_id
    AND cs.status = 'OPEN'
    AND COALESCE(NEW.sent_to_kitchen_at, NEW.created_at, now()) >= cs.opened_at
  ORDER BY cs.opened_at DESC, cs.id DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    NEW.cash_shift_id := v_shift_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_open_cash_shift_to_order ON public.orders;
CREATE TRIGGER trg_assign_open_cash_shift_to_order
BEFORE INSERT OR UPDATE OF status, branch_id, sent_to_kitchen_at, cash_shift_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.assign_open_cash_shift_to_order();

CREATE OR REPLACE FUNCTION public.repair_open_shift_order_cash_shift_ids(p_branch_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH repaired AS (
    UPDATE public.orders o
    SET
      cash_shift_id = cs.id,
      updated_at = now()
    FROM public.cash_shifts cs
    WHERE o.cash_shift_id IS NULL
      AND o.branch_id = cs.branch_id
      AND cs.status = 'OPEN'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID')
      AND COALESCE(o.sent_to_kitchen_at, o.created_at) >= cs.opened_at
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_count FROM repaired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) TO authenticated;

SELECT public.repair_open_shift_order_cash_shift_ids(NULL);

NOTIFY pgrst, 'reload schema';
