-- Cobro rápido: el trigger en payments también era FOR EACH ROW (igual que payment_items antes).
-- Al insertar N pagos en lote (dbInsertMany), sync_order_payment_state_internal
-- se ejecutaba N veces innecesariamente. Ahora ejecuta una sola vez por sentencia.

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM inserted_rows
    WHERE order_id IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM deleted_rows
    WHERE order_id IS NOT NULL
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payments_after_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT order_id AS oid
    FROM (
      SELECT order_id FROM old_rows WHERE order_id IS NOT NULL
      UNION
      SELECT order_id FROM new_rows WHERE order_id IS NOT NULL
    ) s
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_payments_after_insert_stmt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_payment_state_payments_after_delete_stmt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_payment_state_payments_after_update_stmt() FROM PUBLIC;

-- Reemplazar el trigger FOR EACH ROW por tres FOR EACH STATEMENT
DROP TRIGGER IF EXISTS trg_sync_order_payment_state_on_payments ON public.payments;

CREATE TRIGGER trg_sync_order_payment_state_payments_ins_stmt
AFTER INSERT ON public.payments
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payments_after_insert_stmt();

CREATE TRIGGER trg_sync_order_payment_state_payments_del_stmt
AFTER DELETE ON public.payments
REFERENCING OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payments_after_delete_stmt();

CREATE TRIGGER trg_sync_order_payment_state_payments_upd_stmt
AFTER UPDATE ON public.payments
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payments_after_update_stmt();

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
