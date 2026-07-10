-- =============================================================================
-- Token de promoción solo cuando hay oferta registrable (no solo campaña activa)
-- =============================================================================
-- Una campaña puede seguir marcada activa aunque todas sus ofertas hayan
-- vencido o cerrado. El QR del recibo debe usar la misma regla que
-- /promociones/registro (ofertaDisponibleParaRegistro).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hay_promocion_registrable()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campanas_promocionales c
    WHERE c.activa = true
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(c.cartelera_ofertas, '[]'::jsonb)) AS elem
        WHERE COALESCE(elem->>'resultado', 'PENDIENTE') NOT IN ('GANADA', 'PERDIDA')
          AND NULLIF(trim(elem->>'bloqueo_at'), '') IS NOT NULL
          AND (elem->>'bloqueo_at')::timestamptz >= now()
          AND (
            NULLIF(trim(elem->>'inicio_at'), '') IS NULL
            OR (elem->>'inicio_at')::timestamptz <= now()
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.orden_promocion_token_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.paid_at IS NOT NULL AND NEW.status <> 'CANCELLED' THEN
    IF public.hay_promocion_registrable() THEN
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
