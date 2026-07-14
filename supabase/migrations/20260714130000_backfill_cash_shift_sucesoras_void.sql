-- Sucesoras legacy de anulación de pago sin cash_shift_id no aparecen en Caja.
-- Asocia las activas al turno OPEN de su sucursal.

UPDATE public.orders o
SET
  cash_shift_id = cs.id,
  updated_at = now()
FROM public.cash_shifts cs
WHERE o.cash_shift_id IS NULL
  AND o.branch_id = cs.branch_id
  AND cs.status = 'OPEN'
  AND o.status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED')
  AND (
    COALESCE(o.notes, '') ILIKE '%SUCCESSOR_OF_VOIDED_ORDER:%'
    OR COALESCE(o.notes, '') ILIKE '%VOIDED_PAYMENT_REOPEN:%'
  );
