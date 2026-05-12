-- Cobro en lote: antes se ejecutaba sync_order_payment_state_internal una vez POR FILA
-- en payment_items (muy lento). Sincronizar una sola vez por sentencia INSERT/UPDATE/DELETE.

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM inserted_rows AS ir
    INNER JOIN public.payments p ON p.id = ir.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM deleted_rows AS dr
    INNER JOIN public.payments p ON p.id = dr.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_payment_state_payment_items_after_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.order_id AS oid
    FROM (
      SELECT payment_id FROM old_rows
      UNION
      SELECT payment_id FROM new_rows
    ) s
    INNER JOIN public.payments p ON p.id = s.payment_id
  LOOP
    PERFORM public.sync_order_payment_state_internal(r.oid);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_payment_state_payment_items_after_insert_stmt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_payment_state_payment_items_after_delete_stmt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_payment_state_payment_items_after_update_stmt() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_order_payment_state_on_payment_items ON public.payment_items;
DROP TRIGGER IF EXISTS trg_sync_order_payment_state_payment_items_ins_stmt ON public.payment_items;
DROP TRIGGER IF EXISTS trg_sync_order_payment_state_payment_items_del_stmt ON public.payment_items;
DROP TRIGGER IF EXISTS trg_sync_order_payment_state_payment_items_upd_stmt ON public.payment_items;

CREATE TRIGGER trg_sync_order_payment_state_payment_items_ins_stmt
AFTER INSERT ON public.payment_items
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payment_items_after_insert_stmt();

CREATE TRIGGER trg_sync_order_payment_state_payment_items_del_stmt
AFTER DELETE ON public.payment_items
REFERENCING OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payment_items_after_delete_stmt();

CREATE TRIGGER trg_sync_order_payment_state_payment_items_upd_stmt
AFTER UPDATE ON public.payment_items
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_order_payment_state_payment_items_after_update_stmt();

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
