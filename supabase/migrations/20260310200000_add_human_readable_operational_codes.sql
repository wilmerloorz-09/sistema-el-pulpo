-- Human-readable operational identifiers while keeping UUID as internal PK
-- Safe additive migration (no PK/FK changes)

-- 1) Counter infrastructure for deterministic, concurrency-safe numbering
CREATE TABLE IF NOT EXISTS public.entity_counters (
  entity_key text NOT NULL,
  branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  period_key text NOT NULL DEFAULT '',
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_key, branch_id, period_key)
);

CREATE OR REPLACE FUNCTION public.next_human_sequence(
  p_entity_key text,
  p_branch_id uuid DEFAULT NULL,
  p_period_key text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid := COALESCE(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_period text := COALESCE(p_period_key, '');
  v_next bigint;
BEGIN
  INSERT INTO public.entity_counters (entity_key, branch_id, period_key, last_value, updated_at)
  VALUES (p_entity_key, v_branch, v_period, 1, now())
  ON CONFLICT (entity_key, branch_id, period_key)
  DO UPDATE SET
    last_value = public.entity_counters.last_value + 1,
    updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN v_next;
END;
$$;

-- 2) Branch visible code (keep existing branch_code for backward compatibility)
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS display_code text;

WITH ordered AS (
  SELECT b.id,
         'SUC-' || LPAD(ROW_NUMBER() OVER (ORDER BY b.created_at, b.id)::text, 3, '0') AS generated_code
  FROM public.branches b
  WHERE b.display_code IS NULL OR b.display_code = ''
)
UPDATE public.branches b
SET display_code = o.generated_code
FROM ordered o
WHERE b.id = o.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_display_code
ON public.branches (display_code)
WHERE display_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_branch_display_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  IF NEW.display_code IS NULL OR btrim(NEW.display_code) = '' THEN
    v_seq := public.next_human_sequence('branches', NULL, NULL);
    NEW.display_code := 'SUC-' || LPAD(v_seq::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_branch_display_code ON public.branches;
CREATE TRIGGER trg_assign_branch_display_code
BEFORE INSERT ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.assign_branch_display_code();

-- 3) User visible code
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_code text;

WITH ordered AS (
  SELECT p.id,
         'USR-' || LPAD(ROW_NUMBER() OVER (ORDER BY p.created_at, p.id)::text, 6, '0') AS generated_code
  FROM public.profiles p
  WHERE p.user_code IS NULL OR p.user_code = ''
)
UPDATE public.profiles p
SET user_code = o.generated_code
FROM ordered o
WHERE p.id = o.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_user_code
ON public.profiles (user_code)
WHERE user_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_profile_user_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  IF NEW.user_code IS NULL OR btrim(NEW.user_code) = '' THEN
    v_seq := public.next_human_sequence('profiles', NULL, NULL);
    NEW.user_code := 'USR-' || LPAD(v_seq::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_profile_user_code ON public.profiles;
CREATE TRIGGER trg_assign_profile_user_code
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.assign_profile_user_code();

-- 4) Restaurant tables readable numbering per branch
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS table_number integer,
  ADD COLUMN IF NOT EXISTS table_code text;

WITH numbered AS (
  SELECT rt.id,
         rt.branch_id,
         ROW_NUMBER() OVER (
           PARTITION BY rt.branch_id
           ORDER BY COALESCE(rt.visual_order, 0), rt.created_at, rt.id
         )::int AS generated_number
  FROM public.restaurant_tables rt
  WHERE rt.table_number IS NULL
)
UPDATE public.restaurant_tables rt
SET table_number = n.generated_number
FROM numbered n
WHERE rt.id = n.id;

UPDATE public.restaurant_tables rt
SET table_code = COALESCE(b.display_code, 'SUC-000') || '-M' || LPAD(rt.table_number::text, 3, '0')
FROM public.branches b
WHERE rt.branch_id = b.id
  AND (rt.table_code IS NULL OR rt.table_code = '')
  AND rt.table_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_branch_table_number
ON public.restaurant_tables (branch_id, table_number)
WHERE table_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_branch_table_code
ON public.restaurant_tables (branch_id, table_code)
WHERE table_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_table_number_and_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_branch_display text;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.table_number IS NULL THEN
    v_seq := public.next_human_sequence('restaurant_tables', NEW.branch_id, NULL);
    NEW.table_number := v_seq::int;
  END IF;

  IF NEW.table_code IS NULL OR btrim(NEW.table_code) = '' THEN
    SELECT COALESCE(display_code, 'SUC-000') INTO v_branch_display
    FROM public.branches
    WHERE id = NEW.branch_id;

    NEW.table_code := v_branch_display || '-M' || LPAD(NEW.table_number::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_table_number_and_code ON public.restaurant_tables;
CREATE TRIGGER trg_assign_table_number_and_code
BEFORE INSERT ON public.restaurant_tables
FOR EACH ROW
EXECUTE FUNCTION public.assign_table_number_and_code();

-- 5) Orders: ensure human-readable order_code and modernize generator
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
BEGIN
  IF NEW.order_code IS NOT NULL AND btrim(NEW.order_code) <> '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(replace(display_code, '-', ''), branch_code, 'SUC000')
    INTO v_branch_token
  FROM public.branches
  WHERE id = NEW.branch_id;

  v_date_part := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/Guayaquil', 'YYMMDD');
  v_seq := public.next_human_sequence('orders_daily', NEW.branch_id, v_date_part);

  NEW.order_code := v_branch_token || v_date_part || '-' || LPAD(v_seq::text, 4, '0');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_order_code ON public.orders;
CREATE TRIGGER trg_generate_order_code
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.generate_order_code();

WITH ordered AS (
  SELECT o.id,
         o.branch_id,
         to_char(COALESCE(o.created_at, now()) AT TIME ZONE 'America/Guayaquil', 'YYMMDD') AS day_key,
         ROW_NUMBER() OVER (
           PARTITION BY o.branch_id, (COALESCE(o.created_at, now()) AT TIME ZONE 'America/Guayaquil')::date
           ORDER BY o.created_at, o.id
         ) AS seq
  FROM public.orders o
  WHERE o.order_code IS NULL OR btrim(o.order_code) = ''
)
UPDATE public.orders o
SET order_code = COALESCE(replace(b.display_code, '-', ''), b.branch_code, 'SUC000')
                 || od.day_key
                 || '-'
                 || LPAD(od.seq::text, 4, '0')
FROM ordered od
JOIN public.branches b ON b.id = od.branch_id
WHERE o.id = od.id;

-- Repair duplicates before creating unique index
WITH duplicated_codes AS (
  SELECT order_code
  FROM public.orders
  WHERE order_code IS NOT NULL
    AND btrim(order_code) <> ''
  GROUP BY order_code
  HAVING COUNT(*) > 1
),
ranked_dupes AS (
  SELECT o.id,
         o.branch_id,
         to_char(COALESCE(o.created_at, now()) AT TIME ZONE 'America/Guayaquil', 'YYMMDD') AS day_key,
         ROW_NUMBER() OVER (PARTITION BY o.order_code ORDER BY o.created_at, o.id) AS rn
  FROM public.orders o
  JOIN duplicated_codes d ON d.order_code = o.order_code
),
rows_to_fix AS (
  SELECT id, branch_id, day_key
  FROM ranked_dupes
  WHERE rn > 1
)
UPDATE public.orders o
SET order_code = 'PED'
                || f.day_key
                || '-'
                || LPAD(public.next_human_sequence('orders_repair', f.branch_id, f.day_key)::text, 6, '0')
FROM rows_to_fix f
WHERE o.id = f.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_code
ON public.orders (order_code)
WHERE order_code IS NOT NULL AND btrim(order_code) <> '';

-- 6) Cash shifts readable code
ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS shift_number integer,
  ADD COLUMN IF NOT EXISTS shift_code text;

WITH numbered AS (
  SELECT cs.id,
         cs.branch_id,
         ROW_NUMBER() OVER (
           PARTITION BY cs.branch_id
           ORDER BY cs.opened_at, cs.id
         )::int AS generated_number
  FROM public.cash_shifts cs
  WHERE cs.shift_number IS NULL
)
UPDATE public.cash_shifts cs
SET shift_number = n.generated_number
FROM numbered n
WHERE cs.id = n.id;

UPDATE public.cash_shifts cs
SET shift_code = COALESCE(b.display_code, 'SUC-000') || '-CAJ-' || LPAD(cs.shift_number::text, 5, '0')
FROM public.branches b
WHERE cs.branch_id = b.id
  AND (cs.shift_code IS NULL OR cs.shift_code = '')
  AND cs.shift_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_branch_shift_number
ON public.cash_shifts (branch_id, shift_number)
WHERE shift_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_shift_code
ON public.cash_shifts (shift_code)
WHERE shift_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_shift_number_and_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_branch_display text;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.shift_number IS NULL THEN
    v_seq := public.next_human_sequence('cash_shifts', NEW.branch_id, NULL);
    NEW.shift_number := v_seq::int;
  END IF;

  IF NEW.shift_code IS NULL OR btrim(NEW.shift_code) = '' THEN
    SELECT COALESCE(display_code, 'SUC-000') INTO v_branch_display
    FROM public.branches
    WHERE id = NEW.branch_id;

    NEW.shift_code := v_branch_display || '-CAJ-' || LPAD(NEW.shift_number::text, 5, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_shift_number_and_code ON public.cash_shifts;
CREATE TRIGGER trg_assign_shift_number_and_code
BEFORE INSERT ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.assign_shift_number_and_code();

-- 7) Cash movements readable code
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS movement_number bigint,
  ADD COLUMN IF NOT EXISTS movement_code text;

WITH numbered AS (
  SELECT cm.id,
         ROW_NUMBER() OVER (ORDER BY cm.created_at, cm.id)::bigint AS generated_number
  FROM public.cash_movements cm
  WHERE cm.movement_number IS NULL
)
UPDATE public.cash_movements cm
SET movement_number = n.generated_number
FROM numbered n
WHERE cm.id = n.id;

UPDATE public.cash_movements cm
SET movement_code = 'MOV-' || LPAD(cm.movement_number::text, 7, '0')
WHERE (cm.movement_code IS NULL OR cm.movement_code = '')
  AND cm.movement_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_movement_number
ON public.cash_movements (movement_number)
WHERE movement_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_movement_code
ON public.cash_movements (movement_code)
WHERE movement_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_movement_number_and_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  IF NEW.movement_number IS NULL THEN
    v_seq := public.next_human_sequence('cash_movements', NULL, NULL);
    NEW.movement_number := v_seq;
  END IF;

  IF NEW.movement_code IS NULL OR btrim(NEW.movement_code) = '' THEN
    NEW.movement_code := 'MOV-' || LPAD(NEW.movement_number::text, 7, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_movement_number_and_code ON public.cash_movements;
CREATE TRIGGER trg_assign_movement_number_and_code
BEFORE INSERT ON public.cash_movements
FOR EACH ROW
EXECUTE FUNCTION public.assign_movement_number_and_code();

-- 8) Payments readable code
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_number bigint,
  ADD COLUMN IF NOT EXISTS payment_code text;

WITH numbered AS (
  SELECT p.id,
         ROW_NUMBER() OVER (ORDER BY p.created_at, p.id)::bigint AS generated_number
  FROM public.payments p
  WHERE p.payment_number IS NULL
)
UPDATE public.payments p
SET payment_number = n.generated_number
FROM numbered n
WHERE p.id = n.id;

UPDATE public.payments p
SET payment_code = 'PAG-' || LPAD(p.payment_number::text, 7, '0')
WHERE (p.payment_code IS NULL OR p.payment_code = '')
  AND p.payment_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_payment_number
ON public.payments (payment_number)
WHERE payment_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_payment_code
ON public.payments (payment_code)
WHERE payment_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_payment_number_and_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  IF NEW.payment_number IS NULL THEN
    v_seq := public.next_human_sequence('payments', NULL, NULL);
    NEW.payment_number := v_seq;
  END IF;

  IF NEW.payment_code IS NULL OR btrim(NEW.payment_code) = '' THEN
    NEW.payment_code := 'PAG-' || LPAD(NEW.payment_number::text, 7, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_payment_number_and_code ON public.payments;
CREATE TRIGGER trg_assign_payment_number_and_code
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.assign_payment_number_and_code();

-- 9) Grants
GRANT EXECUTE ON FUNCTION public.next_human_sequence(text, uuid, text) TO authenticated;

