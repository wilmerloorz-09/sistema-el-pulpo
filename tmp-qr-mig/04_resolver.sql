CREATE OR REPLACE FUNCTION public.resolver_contexto_token_qr_mesa(p_token_seguro text)
RETURNS TABLE (
  token_id uuid,
  sucursal_id uuid,
  sucursal_nombre text,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  turno_id uuid,
  turno_abierto boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ctx record;
BEGIN
  SELECT *
  INTO v_ctx
  FROM public.token_qr_mesa_activo(p_token_seguro);

  IF v_ctx.token_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      WHERE t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
        AND t.activo = true
    ) THEN
      RAISE EXCEPTION 'No hay un turno abierto para este código QR. El autopedido no está disponible.';
    END IF;
    RAISE EXCEPTION 'Código QR inválido o inactivo.';
  END IF;

  RETURN QUERY
  SELECT
    v_ctx.token_id,
    v_ctx.sucursal_id,
    b.name::text AS sucursal_nombre,
    v_ctx.mesa_id,
    v_ctx.mesa_nombre,
    v_ctx.mesa_visual_order,
    v_ctx.turno_id,
    true AS turno_abierto
  FROM public.branches b
  WHERE b.id = v_ctx.sucursal_id;
END;
$fn$;
