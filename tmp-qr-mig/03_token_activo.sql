CREATE OR REPLACE FUNCTION public.token_qr_mesa_activo(p_token_seguro text)
RETURNS TABLE (
  token_id uuid,
  sucursal_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  turno_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_token record;
  v_peers uuid[];
  v_shift record;
  v_mesa record;
BEGIN
  SELECT
    t.id,
    t.sucursal_id,
    t.mesa_id,
    rt.visual_order AS mesa_visual_order
  INTO v_token
  FROM public.tokens_qr_mesas t
  INNER JOIN public.restaurant_tables rt
    ON rt.id = t.mesa_id
  WHERE t.activo = true
    AND t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
  LIMIT 1;

  IF v_token.id IS NULL THEN
    RETURN;
  END IF;

  v_peers := public.qr_shared_peer_branch_ids(v_token.sucursal_id);

  SELECT cs.id, cs.branch_id, cs.opened_at
  INTO v_shift
  FROM public.cash_shifts cs
  WHERE cs.branch_id = ANY (v_peers)
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN;
  END IF;

  SELECT rt.id, rt.name, rt.visual_order
  INTO v_mesa
  FROM public.restaurant_tables rt
  WHERE rt.branch_id = v_shift.branch_id
    AND rt.visual_order = v_token.mesa_visual_order
    AND COALESCE(rt.is_active, true) = true
  ORDER BY rt.name ASC
  LIMIT 1;

  IF v_mesa.id IS NULL AND v_token.sucursal_id = v_shift.branch_id THEN
    SELECT rt.id, rt.name, rt.visual_order
    INTO v_mesa
    FROM public.restaurant_tables rt
    WHERE rt.id = v_token.mesa_id
      AND COALESCE(rt.is_active, true) = true
    LIMIT 1;
  END IF;

  IF v_mesa.id IS NULL THEN
    RETURN;
  END IF;

  token_id := v_token.id;
  sucursal_id := v_shift.branch_id;
  mesa_id := v_mesa.id;
  mesa_nombre := v_mesa.name;
  mesa_visual_order := v_mesa.visual_order;
  turno_id := v_shift.id;
  RETURN NEXT;
END;
$fn$;
