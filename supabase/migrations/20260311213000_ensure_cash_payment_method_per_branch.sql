-- Garantiza que cada sucursal tenga el metodo de pago Efectivo activo
INSERT INTO public.payment_methods (id, branch_id, name, is_active, created_at)
SELECT gen_random_uuid(), b.id, 'Efectivo', true, now()
FROM public.branches b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payment_methods pm
  WHERE pm.branch_id = b.id
    AND lower(trim(pm.name)) = 'efectivo'
);

CREATE OR REPLACE FUNCTION public.ensure_cash_payment_method_for_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_methods pm
    WHERE pm.branch_id = NEW.id
      AND lower(trim(pm.name)) = 'efectivo'
  ) THEN
    INSERT INTO public.payment_methods (id, branch_id, name, is_active, created_at)
    VALUES (gen_random_uuid(), NEW.id, 'Efectivo', true, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_cash_payment_method_for_branch ON public.branches;
CREATE TRIGGER trg_ensure_cash_payment_method_for_branch
AFTER INSERT ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.ensure_cash_payment_method_for_branch();
