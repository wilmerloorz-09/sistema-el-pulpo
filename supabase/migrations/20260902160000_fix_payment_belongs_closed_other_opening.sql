-- No atribuir cobros de un cajero a otra caja si ese cajero tuvo su propia
-- apertura (abierta o ya cerrada) que cubría el momento del pago.
-- Antes solo se miraba status='abierta', y al cerrar Jhon sus cobros
-- "pasaban" al resumen de ely y generaban falso descuadre.

CREATE OR REPLACE FUNCTION public.payment_belongs_to_register_opening(
  p_payment_id uuid,
  p_opening_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    JOIN public.payments p ON p.id = p_payment_id
    WHERE cro.id = p_opening_id
      AND p.created_at >= cro.opened_at
      AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
      AND COALESCE(p.status, '') NOT IN ('voided', 'reversed')
      AND (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = cro.shift_id
        )
        OR p.shift_id = cro.shift_id
        OR EXISTS (
          SELECT 1
          FROM public.cash_movements cm
          WHERE cm.payment_id = p.id
            AND cm.shift_id = cro.shift_id
        )
      )
      AND (
        p.created_by = cro.cashier_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.cash_register_openings cro_other
          WHERE cro_other.shift_id = cro.shift_id
            AND cro_other.cashier_id = p.created_by
            AND cro_other.id <> cro.id
            AND cro_other.status IN ('abierta', 'cerrada')
            AND p.created_at >= cro_other.opened_at
            AND (
              cro_other.closed_at IS NULL
              OR p.created_at <= cro_other.closed_at
            )
        )
      )
  );
$$;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
