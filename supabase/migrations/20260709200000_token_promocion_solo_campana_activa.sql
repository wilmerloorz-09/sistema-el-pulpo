-- =============================================================================
-- Token de promoción solo cuando hay al menos una campaña activa
-- =============================================================================
-- Antes: toda orden pagada recibía token_promocion aunque no hubiera campaña.
-- El recibo imprimía el QR igual porque solo miraba si existía el token.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.orden_promocion_token_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.paid_at IS NOT NULL AND NEW.status <> 'CANCELLED' THEN
    IF EXISTS (SELECT 1 FROM public.campanas_promocionales WHERE activa = true) THEN
      IF NEW.token_promocion IS NULL THEN
        NEW.token_promocion := public.generar_token_promocion_unico();
      END IF;
    ELSE
      NEW.token_promocion := NULL;
    END IF;
  ELSIF NEW.paid_at IS NULL OR NEW.status = 'CANCELLED' THEN
    NEW.token_promocion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
