-- =============================================================================
-- Visibilidad post cambio de turno: reetiquetar al turno OPEN actual
-- =============================================================================
-- Tras cerrar/abrir turno, borradores o envíos pueden quedar con cash_shift_id
-- del turno CERRADO (o NULL). Servir/Despacho filtran por turno OPEN → la orden
-- se ve en captura ("EN DESPACHO") pero no en las colas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assign_open_cash_shift_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_tagged_status text;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status::text, 'DRAFT') NOT IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID') THEN
    RETURN NEW;
  END IF;

  -- Si ya tiene turno, solo reasignar cuando ese turno ya está CERRADO
  IF NEW.cash_shift_id IS NOT NULL THEN
    SELECT cs.status::text
    INTO v_tagged_status
    FROM public.cash_shifts cs
    WHERE cs.id = NEW.cash_shift_id;

    IF v_tagged_status IS NULL OR v_tagged_status = 'OPEN' THEN
      RETURN NEW;
    END IF;
    -- Turno cerrado / inexistente: liberar para reasignar al OPEN actual
    NEW.cash_shift_id := NULL;
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
    WHERE cs.branch_id = o.branch_id
      AND cs.status = 'OPEN'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED', 'PAID')
      AND COALESCE(o.sent_to_kitchen_at, o.created_at) >= cs.opened_at
      AND (
        o.cash_shift_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.cash_shifts old
          WHERE old.id = o.cash_shift_id
            AND old.status = 'CLOSED'
        )
      )
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_count FROM repaired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_open_shift_order_cash_shift_ids(uuid) TO authenticated;

-- Reparación inmediata (órdenes ya huérfanas del turno cerrado)
SELECT public.repair_open_shift_order_cash_shift_ids(NULL);

NOTIFY pgrst, 'reload schema';
