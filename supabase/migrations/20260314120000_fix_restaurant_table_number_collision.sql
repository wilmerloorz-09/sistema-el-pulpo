-- Make restaurant table numbering resilient to stale counters and concurrent inserts.

CREATE OR REPLACE FUNCTION public.assign_table_number_and_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_existing integer;
  v_branch_display text;
  v_counter_value bigint;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize table-number assignment per branch to avoid concurrent collisions.
  PERFORM pg_advisory_xact_lock(hashtext('restaurant_tables:' || NEW.branch_id::text));

  SELECT COALESCE(MAX(rt.table_number), 0)
  INTO v_max_existing
  FROM public.restaurant_tables rt
  WHERE rt.branch_id = NEW.branch_id;

  IF NEW.table_number IS NULL OR NEW.table_number <= v_max_existing THEN
    NEW.table_number := v_max_existing + 1;
  END IF;

  INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
  VALUES ('restaurant_tables', NEW.branch_id, '', NEW.table_number, now())
  ON CONFLICT (entity_key, branch_id, period_key)
  DO UPDATE SET
    last_value = GREATEST(public.entity_counters.last_value, EXCLUDED.last_value),
    updated_at = now()
  RETURNING last_value INTO v_counter_value;

  IF NEW.table_code IS NULL OR btrim(NEW.table_code) = '' THEN
    SELECT COALESCE(display_code, 'SUC-000') INTO v_branch_display
    FROM public.branches
    WHERE id = NEW.branch_id;

    NEW.table_code := v_branch_display || '-M' || LPAD(NEW.table_number::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$;
