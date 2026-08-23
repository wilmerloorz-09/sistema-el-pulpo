CREATE OR REPLACE FUNCTION public.generar_tokens_qr_mesas_sucursal(
  p_sucursal_id uuid,
  p_limite integer DEFAULT 20
)
RETURNS TABLE (
  token_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  token_seguro text,
  creado boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_limite integer := GREATEST(1, LEAST(COALESCE(p_limite, 20), 100));
  v_peers uuid[];
  v_peer uuid;
  v_mesa record;
  v_token text;
  v_existing record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'sucursal_id es obligatorio';
  END IF;

  IF NOT (
    public.is_global_admin(v_actor)
    OR public.can_manage_branch_admin(v_actor, p_sucursal_id)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para generar códigos QR de mesas.';
  END IF;

  v_peers := public.qr_shared_peer_branch_ids(p_sucursal_id);

  FOREACH v_peer IN ARRAY v_peers
  LOOP
    PERFORM public.ensure_branch_table_capacity(v_peer, v_limite);
  END LOOP;

  FOR v_mesa IN
    SELECT rt.id, rt.name, rt.visual_order
    FROM public.restaurant_tables rt
    WHERE rt.branch_id = p_sucursal_id
    ORDER BY rt.visual_order ASC, rt.name ASC
    LIMIT v_limite
  LOOP
    SELECT
      t.id,
      t.token_seguro,
      t.sucursal_id,
      t.mesa_id
    INTO v_existing
    FROM public.tokens_qr_mesas t
    INNER JOIN public.restaurant_tables rt
      ON rt.id = t.mesa_id
    WHERE t.sucursal_id = ANY (v_peers)
      AND rt.visual_order = v_mesa.visual_order
      AND t.activo = true
    ORDER BY
      CASE WHEN t.sucursal_id = p_sucursal_id THEN 0 ELSE 1 END,
      t.creado_en ASC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.tokens_qr_mesas
      SET activo = true,
          actualizado_en = now()
      WHERE id = v_existing.id;

      token_id := v_existing.id;
      mesa_id := v_mesa.id;
      mesa_nombre := v_mesa.name;
      mesa_visual_order := v_mesa.visual_order;
      token_seguro := v_existing.token_seguro;
      creado := false;
      RETURN NEXT;
    ELSE
      v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

      INSERT INTO public.tokens_qr_mesas (
        sucursal_id, mesa_id, token_seguro, activo
      ) VALUES (
        p_sucursal_id, v_mesa.id, v_token, true
      )
      RETURNING id INTO token_id;

      mesa_id := v_mesa.id;
      mesa_nombre := v_mesa.name;
      mesa_visual_order := v_mesa.visual_order;
      token_seguro := v_token;
      creado := true;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.generar_tokens_qr_mesas_sucursal(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generar_tokens_qr_mesas_sucursal(uuid, integer) TO authenticated;
