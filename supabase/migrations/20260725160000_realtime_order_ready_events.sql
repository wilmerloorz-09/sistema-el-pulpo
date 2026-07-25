-- =============================================================================
-- Realtime para alertas de "orden lista" del mesero
-- =============================================================================
-- Antes cada tablet llamaba get_mesero_ready_alerts cada 2 segundos (millones de
-- ejecuciones acumuladas). Con la tabla publicada en Realtime, la base avisa al
-- insertarse el evento y el sondeo queda solo como respaldo lento.
--
-- La politica RLS de SELECT sobre order_ready_events ya existe
-- (20260311100000_operational_ready_dispatch_quantities.sql), asi que Realtime
-- respeta los mismos permisos que la consulta directa.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'order_ready_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_ready_events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
