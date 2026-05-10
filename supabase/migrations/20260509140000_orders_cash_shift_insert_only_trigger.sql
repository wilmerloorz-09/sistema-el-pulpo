-- El trigger de cash_shift_id no debe ejecutarse en UPDATE de status (u otros campos operativos):
-- si cash_shift_id es NULL y el turno cambia, antes se re-etiquetaba la orden al turno abierto
-- y reaparecia en Mesas/Cocina/Caja del turno nuevo. Solo se fija el turno en INSERT.

DROP TRIGGER IF EXISTS trg_orders_default_cash_shift_id ON public.orders;

CREATE TRIGGER trg_orders_default_cash_shift_id
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_default_cash_shift_id();

NOTIFY pgrst, 'reload schema';
