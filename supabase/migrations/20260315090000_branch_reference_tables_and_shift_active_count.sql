ALTER TABLE public.branches
ADD COLUMN IF NOT EXISTS reference_table_count integer NOT NULL DEFAULT 0;

UPDATE public.branches b
SET reference_table_count = src.table_count
FROM (
  SELECT rt.branch_id, COUNT(*)::integer AS table_count
  FROM public.restaurant_tables rt
  GROUP BY rt.branch_id
) AS src
WHERE src.branch_id = b.id
  AND COALESCE(b.reference_table_count, 0) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branches_reference_table_count_check'
  ) THEN
    ALTER TABLE public.branches
    ADD CONSTRAINT branches_reference_table_count_check
    CHECK (reference_table_count >= 0);
  END IF;
END $$;

ALTER TABLE public.cash_shifts
ADD COLUMN IF NOT EXISTS active_tables_count integer NOT NULL DEFAULT 0;

UPDATE public.cash_shifts cs
SET active_tables_count = COALESCE(b.reference_table_count, 0)
FROM public.branches b
WHERE b.id = cs.branch_id
  AND COALESCE(cs.active_tables_count, 0) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shifts_active_tables_count_check'
  ) THEN
    ALTER TABLE public.cash_shifts
    ADD CONSTRAINT cash_shifts_active_tables_count_check
    CHECK (active_tables_count >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_branch_table_capacity(
  p_branch_id uuid,
  p_requested_count integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer := GREATEST(COALESCE(p_requested_count, 0), 0);
  v_current_visual_max integer := 0;
  v_index integer;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  SELECT COALESCE(MAX(rt.visual_order), 0)
  INTO v_current_visual_max
  FROM public.restaurant_tables rt
  WHERE rt.branch_id = p_branch_id;

  IF v_current_visual_max >= v_requested THEN
    RETURN v_current_visual_max;
  END IF;

  FOR v_index IN (v_current_visual_max + 1)..v_requested LOOP
    INSERT INTO public.restaurant_tables (
      branch_id,
      name,
      visual_order,
      is_active,
      table_number
    )
    VALUES (
      p_branch_id,
      'Mesa ' || v_index::text,
      v_index,
      false,
      v_index
    );
  END LOOP;

  RETURN v_requested;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_branch_reference_table_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_branch_table_capacity(NEW.id, NEW.reference_table_count);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_branch_reference_table_capacity ON public.branches;
CREATE TRIGGER trg_sync_branch_reference_table_capacity
AFTER INSERT OR UPDATE OF reference_table_count
ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.sync_branch_reference_table_capacity();

CREATE OR REPLACE FUNCTION public.configure_shift_active_tables(
  p_branch_id uuid,
  p_shift_id uuid,
  p_active_tables_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer := GREATEST(COALESCE(p_active_tables_count, 0), 0);
  v_conflicting_tables integer := 0;
BEGIN
  IF p_branch_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'branch_id y shift_id son obligatorios';
  END IF;

  SELECT COUNT(DISTINCT rt.id)
  INTO v_conflicting_tables
  FROM public.orders o
  JOIN public.restaurant_tables rt ON rt.id = o.table_id
  WHERE o.branch_id = p_branch_id
    AND o.table_id IS NOT NULL
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
    AND rt.visual_order > v_requested;

  IF v_conflicting_tables > 0 THEN
    RAISE EXCEPTION 'No puedes activar menos mesas que las que ya tienen ordenes abiertas';
  END IF;

  PERFORM public.ensure_branch_table_capacity(p_branch_id, v_requested);

  UPDATE public.cash_shifts
  SET active_tables_count = v_requested
  WHERE id = p_shift_id
    AND branch_id = p_branch_id;

  UPDATE public.restaurant_tables
  SET is_active = (visual_order <= v_requested)
  WHERE branch_id = p_branch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_shift_with_tables(
  p_cashier_id uuid,
  p_branch_id uuid,
  p_active_tables_count integer,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
BEGIN
  IF p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'cashier_id y branch_id son obligatorios';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto en la sucursal activa';
  END IF;

  INSERT INTO public.cash_shifts (
    id,
    cashier_id,
    branch_id,
    active_tables_count,
    status,
    opened_at
  )
  VALUES (
    v_shift_id,
    p_cashier_id,
    p_branch_id,
    GREATEST(COALESCE(p_active_tables_count, 0), 0),
    'OPEN',
    v_now
  );

  PERFORM public.configure_shift_active_tables(
    p_branch_id,
    v_shift_id,
    p_active_tables_count
  );

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
  LOOP
    v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
    v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

    IF v_denomination_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    VALUES (
      gen_random_uuid(),
      v_shift_id,
      v_denomination_id,
      v_qty,
      v_qty
    );

    IF v_qty > 0 THEN
      INSERT INTO public.cash_movements (
        id,
        shift_id,
        denomination_id,
        movement_type,
        qty_delta,
        created_at
      )
      VALUES (
        gen_random_uuid(),
        v_shift_id,
        v_denomination_id,
        'OPENING',
        v_qty,
        v_now
      );
    END IF;
  END LOOP;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_shift_with_tables(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = now(),
      notes = p_notes
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar';
  END IF;

  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_branch_table_capacity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_shift_active_tables(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift_with_tables(uuid, uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_with_tables(uuid, uuid, text) TO authenticated;
