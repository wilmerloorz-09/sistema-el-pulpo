CREATE OR REPLACE FUNCTION public.extra_acceso_branch_is_open(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  );
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_inventario_visible(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE (
      COALESCE(b.inventario_sucursal_id, b.id) = p_sucursal_id
      OR b.id = p_sucursal_id
    )
    AND public.extra_acceso_branch_is_open(b.id)
  );
$$;

REVOKE ALL ON FUNCTION public.extra_acceso_branch_is_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_inventario_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extra_acceso_branch_is_open(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_inventario_visible(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS menu_nodes_select_extra_acceso_anon ON public.menu_nodes;
CREATE POLICY menu_nodes_select_extra_acceso_anon
ON public.menu_nodes
FOR SELECT
TO anon
USING (
  is_active IS TRUE
  AND menu_scope = 'TABLE'
  AND public.extra_acceso_branch_is_open(branch_id)
);

DROP POLICY IF EXISTS extra_frequent_products_select_extra_acceso_anon ON public.extra_frequent_products;
CREATE POLICY extra_frequent_products_select_extra_acceso_anon
ON public.extra_frequent_products
FOR SELECT
TO anon
USING (public.extra_acceso_branch_is_open(branch_id));

DROP POLICY IF EXISTS inventario_bodega_sucursal_select_extra_acceso_anon ON public.inventario_bodega_sucursal;
CREATE POLICY inventario_bodega_sucursal_select_extra_acceso_anon
ON public.inventario_bodega_sucursal
FOR SELECT
TO anon
USING (public.extra_acceso_inventario_visible(sucursal_id));

DROP POLICY IF EXISTS productos_globales_select_extra_acceso_anon ON public.productos_globales;
CREATE POLICY productos_globales_select_extra_acceso_anon
ON public.productos_globales
FOR SELECT
TO anon
USING (COALESCE(activo, true) IS TRUE);
