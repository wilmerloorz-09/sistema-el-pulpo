-- Chequeo rápido de transferencia duplicada sin RLS pesado sobre payments.
-- Usa la misma expresión del índice único idx_payments_transferencia_unica.

CREATE OR REPLACE FUNCTION public.existe_transferencia_duplicada(
  p_banco_id uuid,
  p_numero text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_numero text := NULLIF(TRIM(p_numero), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_banco_id IS NULL OR v_numero IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.banco_id = p_banco_id
      AND lower(trim(p.numero_transferencia)) = lower(v_numero)
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.existe_transferencia_duplicada(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.existe_transferencia_duplicada(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.existe_transferencia_duplicada(uuid, text) IS
  'Indica si ya existe un pago con el mismo banco y numero de transferencia (unicidad global).';
