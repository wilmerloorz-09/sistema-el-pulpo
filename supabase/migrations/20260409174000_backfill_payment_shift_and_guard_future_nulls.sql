CREATE OR REPLACE FUNCTION public.infer_payment_shift_id(
  p_order_id uuid,
  p_created_at timestamptz DEFAULT now(),
  p_require_open boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_id uuid;
  v_matches integer := 0;
  v_payment_at timestamptz := COALESCE(p_created_at, now());
BEGIN
  IF p_order_id IS NULL THEN
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
  INTO v_shift_id, v_matches
  FROM (
    SELECT cs.id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = v_branch_id
      AND cs.opened_at <= v_payment_at
      AND COALESCE(cs.closed_at, 'infinity'::timestamptz) >= v_payment_at
      AND (
        NOT p_require_open
        OR (
          cs.status = 'OPEN'
          AND COALESCE(cs.caja_status, 'OPEN') = 'OPEN'
        )
      )
    ORDER BY cs.opened_at DESC, cs.id DESC
  ) AS candidate
  LIMIT 1;

  IF COALESCE(v_matches, 0) <> 1 THEN
    RETURN NULL;
  END IF;

  RETURN v_shift_id;
END;
$$;

COMMENT ON FUNCTION public.infer_payment_shift_id(uuid, timestamptz, boolean) IS
  'Infers the cash shift for a payment using order branch and payment timestamp. Returns NULL if ambiguous.';

UPDATE public.payments p
SET shift_id = public.infer_payment_shift_id(p.order_id, p.created_at, false)
WHERE p.shift_id IS NULL
  AND public.infer_payment_shift_id(p.order_id, p.created_at, false) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_payment_shift_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift_id IS NULL THEN
    NEW.shift_id := public.infer_payment_shift_id(
      NEW.order_id,
      COALESCE(NEW.created_at, now()),
      true
    );
  END IF;

  IF NEW.shift_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el turno del pago. Abre caja e intenta nuevamente';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_payment_shift_id ON public.payments;

CREATE TRIGGER trg_ensure_payment_shift_id
BEFORE INSERT OR UPDATE OF order_id, created_at, shift_id
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.ensure_payment_shift_id();

CREATE INDEX IF NOT EXISTS idx_payments_shift_id_created_at
  ON public.payments(shift_id, created_at DESC);
