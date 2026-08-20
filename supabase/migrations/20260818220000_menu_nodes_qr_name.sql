-- Nombre visible en el menú QR del cliente (productos).
-- Si está vacío, el QR sigue mostrando menu_nodes.name.

ALTER TABLE public.menu_nodes
  ADD COLUMN IF NOT EXISTS qr_name text;

COMMENT ON COLUMN public.menu_nodes.qr_name IS
  'Nombre mostrado al cliente en autopedido QR. NULL/vacío = usar name.';

DROP FUNCTION IF EXISTS public.obtener_menu_autopedido_qr(text);

CREATE FUNCTION public.obtener_menu_autopedido_qr(p_token_seguro text)
RETURNS TABLE (
  id uuid,
  branch_id uuid,
  parent_id uuid,
  name text,
  qr_name text,
  node_type text,
  menu_scope text,
  display_order integer,
  depth integer,
  price numeric,
  image_url text,
  icon text,
  is_active boolean,
  legacy_product_id uuid,
  manual_price_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  RETURN QUERY
  SELECT
    mn.id,
    mn.branch_id,
    mn.parent_id,
    mn.name,
    NULLIF(btrim(COALESCE(mn.qr_name, '')), '') AS qr_name,
    mn.node_type::text,
    mn.menu_scope::text,
    mn.display_order,
    mn.depth,
    mn.price,
    mn.image_url,
    mn.icon,
    mn.is_active,
    mn.legacy_product_id,
    COALESCE(mn.manual_price_enabled, false) AS manual_price_enabled
  FROM public.menu_nodes mn
  WHERE mn.branch_id = v_ctx.sucursal_id
    AND mn.menu_scope = 'TABLE'
    AND mn.is_active = true
    AND COALESCE(mn.is_tray_category, false) = false
  ORDER BY mn.depth, mn.display_order, mn.name;
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_menu_autopedido_qr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_menu_autopedido_qr(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
