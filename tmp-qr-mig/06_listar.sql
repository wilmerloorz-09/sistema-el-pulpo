CREATE OR REPLACE FUNCTION public.listar_tokens_qr_mesas_sucursal(p_sucursal_id uuid)
RETURNS TABLE (
  token_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  token_seguro text,
  activo boolean,
  compartido boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_peers uuid[];
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
    OR public.can_view_branch_admin(v_actor, p_sucursal_id)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver códigos QR de mesas.';
  END IF;

  v_peers := public.qr_shared_peer_branch_ids(p_sucursal_id);

  RETURN QUERY
  SELECT DISTINCT ON (local_rt.visual_order)
    t.id AS token_id,
    local_rt.id AS mesa_id,
    local_rt.name::text AS mesa_nombre,
    local_rt.visual_order AS mesa_visual_order,
    t.token_seguro,
    t.activo,
    (cardinality(v_peers) > 1) AS compartido
  FROM public.restaurant_tables local_rt
  INNER JOIN public.restaurant_tables peer_rt
    ON peer_rt.visual_order = local_rt.visual_order
   AND peer_rt.branch_id = ANY (v_peers)
  INNER JOIN public.tokens_qr_mesas t
    ON t.mesa_id = peer_rt.id
   AND t.sucursal_id = ANY (v_peers)
   AND t.activo = true
  WHERE local_rt.branch_id = p_sucursal_id
  ORDER BY local_rt.visual_order ASC, t.creado_en ASC;
END;
$fn$;

REVOKE ALL ON FUNCTION public.listar_tokens_qr_mesas_sucursal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_tokens_qr_mesas_sucursal(uuid) TO authenticated;
