
-- 1. Add branch_code to branches
ALTER TABLE public.branches ADD COLUMN branch_code VARCHAR(4) DEFAULT '' NOT NULL;

-- 2. Add order_code to orders
ALTER TABLE public.orders ADD COLUMN order_code TEXT;

-- 3. Create function to generate order_code on insert
CREATE OR REPLACE FUNCTION public.generate_order_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_code TEXT;
  v_date_part TEXT;
  v_seq INT;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
BEGIN
  -- Get branch code
  SELECT branch_code INTO v_branch_code
  FROM public.branches
  WHERE id = NEW.branch_id;

  IF v_branch_code IS NULL OR v_branch_code = '' THEN
    v_branch_code := 'XX';
  END IF;

  -- Format date as YYMMDD
  v_date_part := to_char(NOW() AT TIME ZONE 'America/Mexico_City', 'YYMMDD');

  -- Calculate day boundaries in Mexico City timezone
  v_day_start := (NOW() AT TIME ZONE 'America/Mexico_City')::date AT TIME ZONE 'America/Mexico_City';
  v_day_end := v_day_start + INTERVAL '1 day';

  -- Count existing orders for this branch today (lock for concurrency)
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.orders
  WHERE branch_id = NEW.branch_id
    AND created_at >= v_day_start
    AND created_at < v_day_end
    AND id != NEW.id;

  -- Set order_code
  NEW.order_code := v_branch_code || v_date_part || '-' || LPAD(v_seq::TEXT, 4, '0');

  RETURN NEW;
END;
$$;

-- 4. Create trigger
CREATE TRIGGER trg_generate_order_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_order_code();
