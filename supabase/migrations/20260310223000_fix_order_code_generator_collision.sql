-- Fix duplicate order_code on new order creation
-- 1) Sync orders_daily counters with existing order_code values
-- 2) Harden generator to skip any existing code and self-heal if counters were behind

WITH parsed_codes AS (
  SELECT
    COALESCE(o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS branch_id,
    right(split_part(o.order_code, '-', 1), 6) AS day_key,
    split_part(o.order_code, '-', 2)::bigint AS seq_value
  FROM public.orders o
  WHERE o.order_code IS NOT NULL
    AND btrim(o.order_code) <> ''
    AND o.order_code ~ '^[A-Z0-9]+[0-9]{6}-[0-9]{4}$'
), max_by_day AS (
  SELECT branch_id, day_key, MAX(seq_value) AS max_seq
  FROM parsed_codes
  GROUP BY branch_id, day_key
)
INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
SELECT 'orders_daily', branch_id, day_key, max_seq, now()
FROM max_by_day
ON CONFLICT (entity_key, branch_id, period_key)
DO UPDATE SET
  last_value = GREATEST(public.entity_counters.last_value, EXCLUDED.last_value),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.generate_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_token text;
  v_date_part text;
  v_seq bigint;
  v_candidate text;
  v_try int := 0;
BEGIN
  IF NEW.order_code IS NOT NULL AND btrim(NEW.order_code) <> '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
    INTO v_branch_token
  FROM public.branches
  WHERE id = NEW.branch_id;

  v_date_part := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');

  LOOP
    v_try := v_try + 1;
    v_seq := public.next_human_sequence('orders_daily', NEW.branch_id, v_date_part);
    v_candidate := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.order_code = v_candidate
    );

    IF v_try >= 50 THEN
      RAISE EXCEPTION 'No se pudo generar order_code unico para sucursal % y fecha %', NEW.branch_id, v_date_part;
    END IF;
  END LOOP;

  NEW.order_code := v_candidate;
  RETURN NEW;
END;
$$;
