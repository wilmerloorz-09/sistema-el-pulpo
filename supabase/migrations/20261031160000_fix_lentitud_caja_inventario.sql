-- Mitiga lentitud operativa:
-- 1) list_cash_register_openings: payment_count hacía COUNT sobre todos los payments
--    con payment_belongs_to_register_opening (5–14 s). Pasa a set-based sobre pagos del turno (~0.2–0.3 s).
-- 2) RLS de inventario_productos / bodega: permisos por fila (12–20 s / 200 filas).
--    Helper STABLE + policy simple + RPC de stock para Órdenes.

-- ---------------------------------------------------------------------------
-- 1) Historial de aperturas de caja
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  RETURN QUERY
  WITH openings AS (
    SELECT cro.*
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
  ),
  shift_payments AS (
    SELECT p.id, p.created_at, p.created_by
    FROM public.payments p
    WHERE COALESCE(p.status, '') NOT IN ('voided', 'reversed')
      AND (
        p.shift_id = p_shift_id
        OR EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = p.order_id
            AND o.cash_shift_id = p_shift_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.cash_movements cm
          WHERE cm.payment_id = p.id
            AND cm.shift_id = p_shift_id
        )
      )
  )
  SELECT
    o.id,
    o.shift_id,
    o.status,
    o.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    o.opened_at,
    o.closed_at,
    o.initial_total,
    o.notes,
    o.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    o.anulada_at,
    o.motivo_anulacion,
    (o.cashier_id = auth.uid() AND o.status = 'abierta') AS is_current,
    (
      SELECT COUNT(*)::integer
      FROM shift_payments p
      WHERE p.created_at >= o.opened_at
        AND (o.closed_at IS NULL OR p.created_at <= o.closed_at)
        AND (
          p.created_by = o.cashier_id
          OR NOT EXISTS (
            SELECT 1
            FROM openings o2
            WHERE o2.cashier_id = p.created_by
              AND o2.id <> o.id
              AND o2.status IN ('abierta', 'cerrada')
              AND p.created_at >= o2.opened_at
              AND (o2.closed_at IS NULL OR p.created_at <= o2.closed_at)
          )
        )
    ) AS payment_count
  FROM openings o
  JOIN public.profiles cashier
    ON cashier.id = o.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = o.anulada_por
  ORDER BY o.opened_at DESC, o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_cash_register_openings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_cash_register_openings(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Lectura de inventario: un chequeo STABLE por sucursal (no por fila)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_inventario_productos_sucursal(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_sucursal_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      -- Camino caliente (meseros / caja): sucursal activa comparte inventario
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active_branch_id IN (
            SELECT s.id FROM public.inventario_sucursales_compartidas(p_sucursal_id) AS s(id)
          )
      )
      OR public.is_global_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.inventario_sucursales_compartidas(p_sucursal_id) AS s(id)
        WHERE public.has_branch_permission(auth.uid(), s.id, 'admin_sucursal'::text, 'VIEW'::public.access_level)
          OR public.has_branch_permission(auth.uid(), s.id, 'admin_global'::text, 'VIEW'::public.access_level)
          OR public.can_manage_branch_admin(auth.uid(), s.id)
          OR public.can_operate_inventario_movimientos(auth.uid(), s.id)
          OR public.has_branch_permission(auth.uid(), s.id, 'inventario_movimientos'::text, 'VIEW'::public.access_level)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_inventario_bodega_sucursal(p_sucursal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_sucursal_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.can_operate_bodega_general(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active_branch_id IN (
            SELECT s.id FROM public.inventario_sucursales_compartidas(p_sucursal_id) AS s(id)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.inventario_sucursales_compartidas(p_sucursal_id) AS s(id)
        WHERE public.can_operate_bodega_sucursal(auth.uid(), s.id)
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_inventario_productos_sucursal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_inventario_bodega_sucursal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_inventario_productos_sucursal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_inventario_bodega_sucursal(uuid) TO authenticated;

DROP POLICY IF EXISTS "Inventario select por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario select por sucursal"
ON public.inventario_productos
FOR SELECT
TO authenticated
USING (public.can_read_inventario_productos_sucursal(sucursal_id));

DROP POLICY IF EXISTS inventario_bodega_sucursal_select ON public.inventario_bodega_sucursal;
CREATE POLICY inventario_bodega_sucursal_select
ON public.inventario_bodega_sucursal
FOR SELECT
TO authenticated
USING (public.can_read_inventario_bodega_sucursal(sucursal_id));

-- ---------------------------------------------------------------------------
-- 3) RPC de stock vendible (1 round-trip, sin RLS por fila)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inventario_stock_vendible_map(p_branch_id uuid)
RETURNS TABLE (
  producto_id uuid,
  inventario_id uuid,
  cantidad_disponible numeric,
  integra_con_ventas boolean,
  limite_stock numeric,
  tipo_producto text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id uuid;
  v_solo_nevera boolean;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_inv_id := public.inventario_sucursal_efectiva(p_branch_id);

  IF NOT public.can_read_inventario_productos_sucursal(v_inv_id) THEN
    RAISE EXCEPTION 'Sin permiso para leer inventario de esta sucursal';
  END IF;

  SELECT COALESCE(b.name, '') ~* '^el pulpo 1\b'
  INTO v_solo_nevera
  FROM public.branches b
  WHERE b.id = v_inv_id;

  v_solo_nevera := COALESCE(v_solo_nevera, false);

  RETURN QUERY
  WITH nevera AS (
    SELECT
      ip.id AS inventario_id,
      ip.producto_id,
      ip.cantidad_disponible::numeric AS qty_nevera,
      COALESCE(ip.limite_stock, 0)::numeric AS limite_stock,
      COALESCE(p.tipo_producto::text, pg.tipo_producto::text, 'COMPRADO') AS tipo_producto,
      COALESCE(p.is_active, true) AS is_active
    FROM public.inventario_productos ip
    LEFT JOIN public.products p ON p.id = ip.producto_id
    LEFT JOIN public.productos_globales pg ON pg.id = ip.producto_id
    WHERE ip.sucursal_id = v_inv_id
  ),
  bodega AS (
    SELECT
      ibs.producto_global_id AS producto_id,
      ibs.cantidad_disponible::numeric AS qty_bodega,
      COALESCE(ibs.integra_con_ventas, false) AS integra_con_ventas
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.sucursal_id = v_inv_id
  ),
  merged AS (
    SELECT
      COALESCE(n.producto_id, b.producto_id) AS producto_id,
      n.inventario_id,
      CASE
        WHEN v_solo_nevera THEN COALESCE(n.qty_nevera, 0)
        WHEN COALESCE(b.integra_con_ventas, false) THEN COALESCE(n.qty_nevera, 0) + COALESCE(b.qty_bodega, 0)
        ELSE COALESCE(n.qty_nevera, 0)
      END AS cantidad_disponible,
      COALESCE(b.integra_con_ventas, false) AS integra_con_ventas,
      COALESCE(n.limite_stock, 0) AS limite_stock,
      COALESCE(n.tipo_producto, pg.tipo_producto::text, 'COMPRADO') AS tipo_producto,
      COALESCE(n.is_active, true) AS is_active
    FROM nevera n
    FULL OUTER JOIN bodega b ON b.producto_id = n.producto_id
    LEFT JOIN public.productos_globales pg
      ON pg.id = COALESCE(n.producto_id, b.producto_id)
    WHERE n.producto_id IS NOT NULL
       OR COALESCE(b.integra_con_ventas, false)
  )
  SELECT
    m.producto_id,
    m.inventario_id,
    m.cantidad_disponible,
    m.integra_con_ventas,
    m.limite_stock,
    m.tipo_producto,
    m.is_active
  FROM merged m;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventario_stock_vendible_map(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inventario_stock_vendible_map(uuid) TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
