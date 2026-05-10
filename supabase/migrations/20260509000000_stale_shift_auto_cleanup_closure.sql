
-- Función para realizar limpieza automática y cierre de turnos expirados (stale)
-- Implementa la lógica solicitada:
-- 1. Ordenes Borrador: eliminar
-- 2. Ordenes en caja: eliminar
-- 3. Ordenes pagadas sin despachar: despachar y cerrar
-- 4. Ordenes despachadas: cerrar
-- 5. Caja abierta: cerrar automáticamente

CREATE OR REPLACE FUNCTION public.cleanup_and_close_stale_shift(
  p_shift_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT 'Cierre automático de turno expirado (Limpieza de sistema)'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id y branch_id son obligatorios';
  END IF;

  -- Validar que el turno existe y está abierto
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_shifts 
    WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontró un turno abierto válido para cerrar';
  END IF;

  -- 1. & 2. Ordenes Borrador y Ordenes en caja: eliminar
  -- Consideramos "Borrador" y "En caja" a las que están en status DRAFT
  -- Primero eliminamos los items para evitar errores de FK
  DELETE FROM public.order_items 
  WHERE order_id IN (
    SELECT id FROM public.orders 
    WHERE branch_id = p_branch_id 
      AND status = 'DRAFT'
  );
  
  -- Eliminamos pagos asociados a borradores si existieran (limpieza profunda)
  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders 
    WHERE branch_id = p_branch_id 
      AND status = 'DRAFT'
  );

  DELETE FROM public.orders 
  WHERE branch_id = p_branch_id 
    AND status = 'DRAFT';

  -- 3. Ordenes pagadas sin despachar: despachar y cerrar
  -- (status = 'PAID' y dispatched_at IS NULL)
  UPDATE public.orders
  SET dispatched_at = COALESCE(dispatched_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status = 'PAID'
    AND dispatched_at IS NULL;

  -- 4. Ordenes despachadas (y cualquier otra orden pendiente de flujo: SENT_TO_KITCHEN, READY): cerrar
  -- Pasamos a status PAID todas las que quedaron en el limbo operativo
  UPDATE public.orders
  SET status = 'PAID',
      paid_at = COALESCE(paid_at, v_now),
      closed_at = COALESCE(closed_at, v_now),
      updated_at = v_now
  WHERE branch_id = p_branch_id
    AND status IN ('SENT_TO_KITCHEN', 'READY', 'KITCHEN_DISPATCHED');

  -- 5. Caja abierta: cerrar automáticamente
  UPDATE public.cash_shifts
  SET caja_status = 'CLOSED'
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND caja_status = 'OPEN';

  -- 6. Finalmente, cerrar el turno
  UPDATE public.cash_shifts
  SET status = 'CLOSED',
      closed_at = v_now,
      notes = p_notes,
      closed_by = v_actor_id
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND status = 'OPEN';

  -- Desactivar mesas
  UPDATE public.restaurant_tables
  SET is_active = false
  WHERE branch_id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_and_close_stale_shift(uuid, uuid, text) TO authenticated;
