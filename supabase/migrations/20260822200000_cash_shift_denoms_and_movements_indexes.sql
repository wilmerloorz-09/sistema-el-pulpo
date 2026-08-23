-- Índices de lectura para consultas frecuentes:
--   cash_shift_denoms  → filtro por shift_id (caja, reportes, RPC de turno)
--   cash_movements     → filtro por payment_id (cobros, anulaciones, reporte de caja)
--
-- Solo CREATE INDEX. Sin cambios en tablas, datos, RPC, RLS ni lógica del POS.

CREATE INDEX IF NOT EXISTS idx_cash_shift_denoms_shift_id
  ON public.cash_shift_denoms (shift_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_payment_id
  ON public.cash_movements (payment_id)
  WHERE payment_id IS NOT NULL;
