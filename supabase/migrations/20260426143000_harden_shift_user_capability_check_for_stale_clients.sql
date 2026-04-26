CREATE OR REPLACE FUNCTION public.normalize_cash_shift_user_capabilities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_capability boolean;
BEGIN
  NEW.can_serve_tables := COALESCE(NEW.can_serve_tables, false);
  NEW.can_access_orders := COALESCE(NEW.can_access_orders, false);
  NEW.can_edit_orders := COALESCE(NEW.can_edit_orders, false);
  NEW.can_dispatch_orders := COALESCE(NEW.can_dispatch_orders, false);
  NEW.can_manage_products := COALESCE(NEW.can_manage_products, false);
  NEW.can_use_caja := COALESCE(NEW.can_use_caja, false);
  NEW.can_authorize_order_cancel := COALESCE(NEW.can_authorize_order_cancel, false);
  NEW.can_double_session := COALESCE(NEW.can_double_session, false) AND NEW.can_use_caja;
  NEW.is_supervisor := COALESCE(NEW.is_supervisor, false);

  IF NEW.can_serve_tables THEN
    NEW.can_access_orders := true;
  END IF;

  IF NEW.can_dispatch_orders THEN
    NEW.can_manage_products := true;
  END IF;

  v_has_capability :=
    NEW.can_serve_tables OR
    NEW.can_access_orders OR
    NEW.can_edit_orders OR
    NEW.can_dispatch_orders OR
    NEW.can_manage_products OR
    NEW.can_use_caja OR
    NEW.can_authorize_order_cancel OR
    NEW.is_supervisor;

  IF COALESCE(NEW.is_enabled, false) AND NOT v_has_capability THEN
    NEW.is_enabled := false;
    NEW.can_double_session := false;
    NEW.last_session_id := NULL;
    NEW.secondary_session_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_cash_shift_user_capabilities ON public.cash_shift_users;
CREATE TRIGGER trg_normalize_cash_shift_user_capabilities
BEFORE INSERT OR UPDATE ON public.cash_shift_users
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cash_shift_user_capabilities();

UPDATE public.cash_shift_users
SET
  is_enabled = false,
  can_double_session = false,
  last_session_id = NULL,
  secondary_session_id = NULL
WHERE COALESCE(is_enabled, false) = true
  AND NOT (
    COALESCE(can_serve_tables, false) OR
    COALESCE(can_access_orders, false) OR
    COALESCE(can_edit_orders, false) OR
    COALESCE(can_dispatch_orders, false) OR
    COALESCE(can_manage_products, false) OR
    COALESCE(can_use_caja, false) OR
    COALESCE(can_authorize_order_cancel, false) OR
    COALESCE(is_supervisor, false)
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shift_users_has_capability_chk'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
    DROP CONSTRAINT cash_shift_users_has_capability_chk;
  END IF;
END;
$$;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  is_enabled = false OR
  can_serve_tables = true OR
  can_access_orders = true OR
  can_edit_orders = true OR
  can_dispatch_orders = true OR
  can_manage_products = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true
);

NOTIFY pgrst, 'reload schema';
