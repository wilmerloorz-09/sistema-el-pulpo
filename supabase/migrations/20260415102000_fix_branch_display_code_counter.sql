-- Keep branch display_code generation aligned with existing data.
-- This prevents new branches from colliding with existing SUC-xxx codes
-- when the entity counter was never backfilled or falls behind.

WITH parsed_codes AS (
  SELECT
    regexp_replace(b.display_code, '^SUC-', '')::bigint AS seq_value
  FROM public.branches b
  WHERE b.display_code IS NOT NULL
    AND btrim(b.display_code) <> ''
    AND b.display_code ~ '^SUC-[0-9]+$'
), max_branch_code AS (
  SELECT COALESCE(MAX(seq_value), 0) AS max_seq
  FROM parsed_codes
)
INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
SELECT
  'branches',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '',
  max_seq,
  now()
FROM max_branch_code
ON CONFLICT (entity_key, branch_id, period_key)
DO UPDATE SET
  last_value = GREATEST(public.entity_counters.last_value, EXCLUDED.last_value),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.assign_branch_display_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_existing bigint;
  v_counter_value bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('branches:display_code'));

  SELECT COALESCE(MAX(regexp_replace(b.display_code, '^SUC-', '')::bigint), 0)
  INTO v_max_existing
  FROM public.branches b
  WHERE b.display_code IS NOT NULL
    AND btrim(b.display_code) <> ''
    AND b.display_code ~ '^SUC-[0-9]+$';

  IF NEW.display_code IS NULL OR btrim(NEW.display_code) = '' THEN
    NEW.display_code := 'SUC-' || LPAD((v_max_existing + 1)::text, 3, '0');
  END IF;

  INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
  VALUES (
    'branches',
    '00000000-0000-0000-0000-000000000000'::uuid,
    '',
    regexp_replace(NEW.display_code, '^SUC-', '')::bigint,
    now()
  )
  ON CONFLICT (entity_key, branch_id, period_key)
  DO UPDATE SET
    last_value = GREATEST(public.entity_counters.last_value, EXCLUDED.last_value),
    updated_at = now()
  RETURNING last_value INTO v_counter_value;

  RETURN NEW;
END;
$$;
