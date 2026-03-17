-- Keep profile human-readable user_code generation aligned with existing data.
-- This prevents auth signup/profile trigger failures when the profiles counter is stale.

WITH parsed_codes AS (
  SELECT
    regexp_replace(p.user_code, '^USR-', '')::bigint AS seq_value
  FROM public.profiles p
  WHERE p.user_code IS NOT NULL
    AND btrim(p.user_code) <> ''
    AND p.user_code ~ '^USR-[0-9]{6}$'
), max_profile_code AS (
  SELECT COALESCE(MAX(seq_value), 0) AS max_seq
  FROM parsed_codes
)
INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
SELECT
  'profiles',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '',
  max_seq,
  now()
FROM max_profile_code
ON CONFLICT (entity_key, branch_id, period_key)
DO UPDATE SET
  last_value = GREATEST(public.entity_counters.last_value, EXCLUDED.last_value),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.assign_profile_user_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_existing bigint;
  v_counter_value bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('profiles:user_code'));

  SELECT COALESCE(MAX(regexp_replace(p.user_code, '^USR-', '')::bigint), 0)
  INTO v_max_existing
  FROM public.profiles p
  WHERE p.user_code IS NOT NULL
    AND btrim(p.user_code) <> ''
    AND p.user_code ~ '^USR-[0-9]{6}$';

  IF NEW.user_code IS NULL OR btrim(NEW.user_code) = '' THEN
    NEW.user_code := 'USR-' || LPAD((v_max_existing + 1)::text, 6, '0');
  END IF;

  INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
  VALUES (
    'profiles',
    '00000000-0000-0000-0000-000000000000'::uuid,
    '',
    regexp_replace(NEW.user_code, '^USR-', '')::bigint,
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
