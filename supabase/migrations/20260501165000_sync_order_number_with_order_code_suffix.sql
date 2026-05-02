CREATE OR REPLACE FUNCTION public.sync_order_number_from_order_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_suffix text;
BEGIN
  IF NEW.order_code IS NULL OR btrim(NEW.order_code) = '' THEN
    RETURN NEW;
  END IF;

  v_suffix := split_part(NEW.order_code, '-', 2);
  IF v_suffix ~ '^[0-9]+$' THEN
    NEW.order_number := v_suffix::integer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_number_from_order_code ON public.orders;
CREATE TRIGGER trg_sync_order_number_from_order_code
BEFORE INSERT OR UPDATE OF order_code, order_number
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_number_from_order_code();

UPDATE public.orders
SET order_number = split_part(order_code, '-', 2)::integer
WHERE order_code IS NOT NULL
  AND btrim(order_code) <> ''
  AND split_part(order_code, '-', 2) ~ '^[0-9]+$'
  AND order_number IS DISTINCT FROM split_part(order_code, '-', 2)::integer;

NOTIFY pgrst, 'reload schema';
