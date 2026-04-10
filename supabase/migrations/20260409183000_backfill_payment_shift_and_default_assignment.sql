CREATE OR REPLACE FUNCTION public.resolve_payment_shift_id(
  p_order_id uuid,
  p_created_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_id uuid;
  v_match_count integer := 0;
BEGIN
  IF p_order_id IS NULL OR p_created_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.branch_id
  INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT candidate.id, COUNT(*) OVER ()
  INTO v_shift_id, v_match_count
  FROM (
    SELECT cs.id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = v_branch_id
      AND p_created_at >= cs.opened_at
      AND (
        cs.closed_at IS NULL
        OR p_created_at <= cs.closed_at
      )
    ORDER BY cs.opened_at DESC, cs.id DESC
  ) AS candidate
  LIMIT 1;

  IF COALESCE(v_match_count, 0) = 1 THEN
    RETURN v_shift_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_payment_shift_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift_id IS NULL THEN
    NEW.shift_id := public.resolve_payment_shift_id(
      NEW.order_id,
      COALESCE(NEW.created_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_payment_shift_if_missing ON public.payments;
CREATE TRIGGER trg_assign_payment_shift_if_missing
BEFORE INSERT OR UPDATE OF order_id, created_at, shift_id ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.assign_payment_shift_if_missing();

WITH resolved AS (
  SELECT
    p.id,
    public.resolve_payment_shift_id(p.order_id, p.created_at) AS resolved_shift_id
  FROM public.payments p
  WHERE p.shift_id IS NULL
)
UPDATE public.payments p
SET shift_id = resolved.resolved_shift_id
FROM resolved
WHERE p.id = resolved.id
  AND resolved.resolved_shift_id IS NOT NULL;

REVOKE ALL ON FUNCTION public.resolve_payment_shift_id(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_payment_shift_id(uuid, timestamptz) TO authenticated;
