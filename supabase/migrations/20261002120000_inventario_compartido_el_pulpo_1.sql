-- El Pulpo 1 - Tarde usa la misma bodega sucursal y nevera que El Pulpo 1 - Mañana.
-- branches.inventario_sucursal_id apunta a la sucursal dueña del inventario; NULL = inventario propio.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS inventario_sucursal_id uuid NULL
    REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_inventario_sucursal_distinta_chk;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_inventario_sucursal_distinta_chk
    CHECK (inventario_sucursal_id IS NULL OR inventario_sucursal_id <> id);

COMMENT ON COLUMN public.branches.inventario_sucursal_id IS
  'Sucursal cuyo inventario (bodega sucursal y nevera) usa esta sucursal. NULL = inventario propio.';

UPDATE public.branches
SET inventario_sucursal_id = '6a5b4ab4-6b3f-4eaf-9791-e5dbb0927b4c'
WHERE id = '4dbd05c4-ba93-45ef-a134-13ffbe55bdca';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventario_sucursal_efectiva(p_sucursal_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT b.inventario_sucursal_id FROM public.branches b WHERE b.id = p_sucursal_id),
    p_sucursal_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.inventario_sucursales_compartidas(p_sucursal_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT b.id
  FROM public.branches b
  WHERE COALESCE(b.inventario_sucursal_id, b.id) = public.inventario_sucursal_efectiva(p_sucursal_id)
  UNION
  SELECT p_sucursal_id
  WHERE p_sucursal_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_inventario_sucursales()
RETURNS TABLE(sucursal_id uuid, inventario_sucursal_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT b.id, COALESCE(b.inventario_sucursal_id, b.id)
  FROM public.branches b;
$function$;

REVOKE ALL ON FUNCTION public.inventario_sucursal_efectiva(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventario_sucursales_compartidas(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obtener_inventario_sucursales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventario_sucursal_efectiva(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventario_sucursales_compartidas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.obtener_inventario_sucursales() TO authenticated, service_role;

-- Toda fila nueva de inventario se guarda en la sucursal dueña del inventario.
CREATE OR REPLACE FUNCTION public.trg_inventario_redirigir_sucursal_efectiva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.sucursal_id := public.inventario_sucursal_efectiva(NEW.sucursal_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventario_productos_sucursal_efectiva ON public.inventario_productos;
CREATE TRIGGER trg_inventario_productos_sucursal_efectiva
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.inventario_productos
  FOR EACH ROW EXECUTE FUNCTION public.trg_inventario_redirigir_sucursal_efectiva();

DROP TRIGGER IF EXISTS trg_inventario_bodega_sucursal_sucursal_efectiva ON public.inventario_bodega_sucursal;
CREATE TRIGGER trg_inventario_bodega_sucursal_sucursal_efectiva
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.inventario_bodega_sucursal
  FOR EACH ROW EXECUTE FUNCTION public.trg_inventario_redirigir_sucursal_efectiva();

-- ---------------------------------------------------------------------------
-- Datos: se conserva el inventario de Mañana y se descarta el de Tarde.
-- ---------------------------------------------------------------------------

DELETE FROM public.inventario_productos
WHERE sucursal_id = '4dbd05c4-ba93-45ef-a134-13ffbe55bdca';

DELETE FROM public.inventario_bodega_sucursal
WHERE sucursal_id = '4dbd05c4-ba93-45ef-a134-13ffbe55bdca';

-- ---------------------------------------------------------------------------
-- Sincronización producto_sucursal <-> inventario_productos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_producto_sucursal_sync_inventario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inventario_sucursal_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(NEW.sucursal_id);

  -- Sucursal con inventario compartido: no puede pisar la cantidad de la sucursal dueña.
  IF v_inventario_sucursal_id IS DISTINCT FROM NEW.sucursal_id THEN
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      integra_con_ventas,
      activo
    )
    VALUES (NEW.producto_global_id, v_inventario_sucursal_id, 0, false, true)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

    SELECT ip.cantidad_disponible
    INTO NEW.cantidad_disponible
    FROM public.inventario_productos ip
    WHERE ip.producto_id = NEW.producto_global_id
      AND ip.sucursal_id = v_inventario_sucursal_id;

    NEW.cantidad_disponible := COALESCE(NEW.cantidad_disponible, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  INSERT INTO public.inventario_productos (
    producto_id,
    sucursal_id,
    cantidad_disponible,
    integra_con_ventas,
    activo
  )
  VALUES (
    NEW.producto_global_id,
    NEW.sucursal_id,
    NEW.cantidad_disponible,
    NEW.integra_con_ventas,
    NEW.activo
  )
  ON CONFLICT (producto_id, sucursal_id) DO UPDATE
  SET
    cantidad_disponible = EXCLUDED.cantidad_disponible,
    integra_con_ventas = EXCLUDED.integra_con_ventas,
    activo = EXCLUDED.activo,
    actualizado_en = now();

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_inventario_productos_sync_producto_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.producto_sucursal ps
  SET
    cantidad_disponible = NEW.cantidad_disponible,
    integra_con_ventas = NEW.integra_con_ventas,
    activo = NEW.activo,
    updated_at = now()
  WHERE ps.sucursal_id = NEW.sucursal_id
    AND ps.producto_global_id = NEW.producto_id
    AND (
      ps.cantidad_disponible IS DISTINCT FROM NEW.cantidad_disponible
      OR ps.integra_con_ventas IS DISTINCT FROM NEW.integra_con_ventas
      OR ps.activo IS DISTINCT FROM NEW.activo
    );

  UPDATE public.producto_sucursal ps
  SET
    cantidad_disponible = NEW.cantidad_disponible,
    updated_at = now()
  WHERE ps.sucursal_id IN (
      SELECT b.id FROM public.branches b WHERE b.inventario_sucursal_id = NEW.sucursal_id
    )
    AND ps.producto_global_id = NEW.producto_id
    AND ps.cantidad_disponible IS DISTINCT FROM NEW.cantidad_disponible;

  RETURN NEW;
END;
$function$;

UPDATE public.producto_sucursal ps
SET cantidad_disponible = COALESCE(ip.cantidad_disponible, 0)
FROM public.producto_sucursal ps2
LEFT JOIN public.inventario_productos ip
  ON ip.producto_id = ps2.producto_global_id
 AND ip.sucursal_id = '6a5b4ab4-6b3f-4eaf-9791-e5dbb0927b4c'
WHERE ps.id = ps2.id
  AND ps.sucursal_id = '4dbd05c4-ba93-45ef-a134-13ffbe55bdca'
  AND ps.cantidad_disponible IS DISTINCT FROM COALESCE(ip.cantidad_disponible, 0);

-- ---------------------------------------------------------------------------
-- RPCs de inventario: permisos sobre la sucursal recibida, datos en la sucursal dueña.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_integra_ventas_bodega_sucursal(p_producto_global_id uuid, p_sucursal_id uuid, p_integra_con_ventas boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_resultado boolean;
  v_inventario_sucursal_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_producto_global_id IS NULL OR p_sucursal_id IS NULL OR p_integra_con_ventas IS NULL THEN
    RAISE EXCEPTION 'Producto, sucursal e Integra ventas son obligatorios';
  END IF;

  IF NOT (
    public.is_global_admin(v_actor_id)
    OR public.can_manage_branch_admin(v_actor_id, p_sucursal_id)
    OR public.has_branch_permission(v_actor_id, p_sucursal_id, 'admin_sucursal'::text, 'MANAGE'::public.access_level)
    OR public.has_branch_permission(v_actor_id, p_sucursal_id, 'admin_global'::text, 'MANAGE'::public.access_level)
  ) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar Integra ventas en esta sucursal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.productos_globales WHERE id = p_producto_global_id) THEN
    RAISE EXCEPTION 'El producto no existe en el catálogo global';
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);

  INSERT INTO public.inventario_bodega_sucursal (
    producto_global_id,
    sucursal_id,
    cantidad_disponible,
    activo,
    integra_con_ventas
  )
  VALUES (p_producto_global_id, v_inventario_sucursal_id, 0, true, p_integra_con_ventas)
  ON CONFLICT (producto_global_id, sucursal_id) DO UPDATE
    SET integra_con_ventas = EXCLUDED.integra_con_ventas,
        actualizado_en = now()
  RETURNING integra_con_ventas INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

CREATE OR REPLACE FUNCTION public.inventario_debe_controlar_venta(p_sucursal_id uuid, p_producto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p_sucursal_id IS NOT NULL
    AND p_producto_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.inventario_bodega_sucursal ibs
      WHERE ibs.sucursal_id = public.inventario_sucursal_efectiva(p_sucursal_id)
        AND ibs.producto_global_id = p_producto_id
        AND ibs.integra_con_ventas = true
        AND ibs.activo = true
    );
$function$;

CREATE OR REPLACE FUNCTION public.inventario_movimiento_venta_internal(p_sucursal_id uuid, p_producto_id uuid, p_cantidad numeric, p_tipo_movimiento tipo_movimiento_inventario, p_order_id uuid, p_order_item_id uuid, p_origen_venta text, p_actor_id uuid, p_etiqueta_producto text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_motivo text;
  v_label text;
  v_inventario_sucursal_id uuid;
  v_pendiente_restaurar numeric(14, 3);
BEGIN
  IF NOT public.inventario_debe_controlar_venta(p_sucursal_id, p_producto_id) THEN
    RETURN;
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);
  IF v_cantidad <= 0 THEN
    RETURN;
  END IF;

  IF p_tipo_movimiento NOT IN ('INGRESO', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo de movimiento de venta no soportado: %', p_tipo_movimiento;
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);

  -- Una devolución solo repone lo que realmente se descontó de este inventario para la orden.
  IF p_tipo_movimiento = 'INGRESO' AND (p_order_item_id IS NOT NULL OR p_order_id IS NOT NULL) THEN
    SELECT COALESCE(SUM(
      CASE WHEN mi.tipo_movimiento = 'SALIDA' THEN mi.cantidad_movimiento ELSE -mi.cantidad_movimiento END
    ), 0)
    INTO v_pendiente_restaurar
    FROM public.movimientos_inventario mi
    WHERE mi.sucursal_id = v_inventario_sucursal_id
      AND mi.producto_id = p_producto_id
      AND mi.origen_venta IS NOT NULL
      AND mi.tipo_movimiento IN ('SALIDA', 'INGRESO')
      AND (mi.order_item_id = p_order_item_id OR mi.order_id = p_order_id);

    v_cantidad := LEAST(v_cantidad, GREATEST(COALESCE(v_pendiente_restaurar, 0), 0));
    IF v_cantidad <= 0 THEN
      RETURN;
    END IF;
  END IF;

  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta_producto), ''),
    NULLIF(btrim(p.description), ''),
    NULLIF(btrim(oi.description_snapshot), ''),
    'Producto'
  )
  INTO v_label
  FROM public.products p
  LEFT JOIN public.order_items oi ON oi.id = p_order_item_id
  WHERE p.id = p_producto_id;

  v_label := COALESCE(v_label, 'Producto');

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = v_inventario_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_anterior := 0;
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      integra_con_ventas,
      activo
    )
    VALUES (p_producto_id, v_inventario_sucursal_id, 0, true, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_label,
        trim(both from to_char(v_anterior, 'FM999999999990.999')),
        trim(both from to_char(v_cantidad, 'FM999999999990.999'));
    END IF;
    v_nueva := v_anterior - v_cantidad;
    v_motivo := format('Venta (%s)', COALESCE(p_origen_venta, 'SALIDA'));
  ELSE
    v_nueva := v_anterior + v_cantidad;
    v_motivo := format('Devolución venta (%s)', COALESCE(p_origen_venta, 'INGRESO'));
  END IF;

  UPDATE public.inventario_productos
  SET cantidad_disponible = v_nueva
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  v_registrado_nombre := COALESCE(v_registrado_nombre, 'Usuario');

  INSERT INTO public.movimientos_inventario (
    producto_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre,
    order_id,
    order_item_id,
    origen_venta
  )
  VALUES (
    p_producto_id,
    v_inventario_sucursal_id,
    p_tipo_movimiento,
    v_cantidad,
    v_anterior,
    v_nueva,
    v_motivo,
    COALESCE(p_actor_id, auth.uid()),
    v_registrado_nombre,
    p_order_id,
    p_order_item_id,
    p_origen_venta
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_bodega_sucursal(p_producto_global_id uuid, p_sucursal_id uuid, p_tipo_movimiento tipo_movimiento_inventario, p_cantidad numeric, p_motivo text DEFAULT NULL::text)
RETURNS TABLE(movimiento_id uuid, producto_global_id uuid, sucursal_id uuid, tipo_movimiento tipo_movimiento_inventario, cantidad_movimiento numeric, cantidad_anterior numeric, cantidad_nueva numeric, motivo text, registrado_por uuid, registrado_por_nombre text, creado_en timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_movimiento_id uuid;
  v_inventario_sucursal_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_producto_global_id IS NULL OR p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'producto_global_id y sucursal_id son obligatorios';
  END IF;

  IF p_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es obligatorio';
  END IF;

  IF NOT public.can_operate_bodega_sucursal(v_actor_id, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos en bodega de esta sucursal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.productos_globales pg
    WHERE pg.id = p_producto_global_id
  ) THEN
    RAISE EXCEPTION 'Producto global no encontrado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_sucursal_id) THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  IF v_motivo IS NULL AND p_tipo_movimiento <> 'INGRESO' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para el movimiento';
  END IF;

  IF v_motivo IS NULL THEN
    v_motivo := 'Ingreso';
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);

  IF p_tipo_movimiento IN ('INGRESO', 'SALIDA') AND v_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento debe ser mayor a 0';
  END IF;

  IF p_tipo_movimiento = 'AJUSTE' AND v_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad de ajuste no puede ser negativa';
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);

  SELECT ibs.id, ibs.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_bodega_sucursal ibs
  WHERE ibs.producto_global_id = p_producto_global_id
    AND ibs.sucursal_id = v_inventario_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.inventario_bodega_sucursal (
      producto_global_id,
      sucursal_id,
      cantidad_disponible,
      activo
    )
    VALUES (p_producto_global_id, v_inventario_sucursal_id, 0, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'INGRESO' THEN
    v_nueva := v_anterior + v_cantidad;
  ELSIF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en bodega sucursal. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
  ELSE
    v_nueva := v_cantidad;
  END IF;

  UPDATE public.inventario_bodega_sucursal
  SET cantidad_disponible = v_nueva,
      activo = true,
      actualizado_en = now()
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.movimientos_bodega_sucursal (
    producto_global_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_producto_global_id,
    v_inventario_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    COALESCE(v_registrado_nombre, 'Usuario')
  )
  RETURNING id INTO v_movimiento_id;

  RETURN QUERY
  SELECT
    v_movimiento_id,
    p_producto_global_id,
    v_inventario_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    COALESCE(v_registrado_nombre, 'Usuario'),
    now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(p_producto_id uuid, p_sucursal_id uuid, p_tipo_movimiento tipo_movimiento_inventario, p_cantidad numeric, p_motivo text DEFAULT NULL::text)
RETURNS TABLE(movimiento_id uuid, producto_id uuid, sucursal_id uuid, tipo_movimiento tipo_movimiento_inventario, cantidad_movimiento numeric, cantidad_anterior numeric, cantidad_nueva numeric, motivo text, registrado_por uuid, registrado_por_nombre text, creado_en timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_movimiento_id uuid;
  v_inventario_sucursal_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_producto_id IS NULL OR p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'producto_id y sucursal_id son obligatorios';
  END IF;

  IF p_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es obligatorio';
  END IF;

  IF v_motivo IS NULL AND p_tipo_movimiento <> 'INGRESO' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para el movimiento';
  END IF;

  IF v_motivo IS NULL THEN
    v_motivo := 'Ingreso';
  END IF;

  IF NOT public.can_operate_inventario_movimientos(v_actor_id, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos en esta sucursal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_producto_id) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_sucursal_id) THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  v_cantidad := round(COALESCE(p_cantidad, 0)::numeric, 3);

  IF p_tipo_movimiento IN ('INGRESO', 'SALIDA') AND v_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento debe ser mayor a 0';
  END IF;

  IF p_tipo_movimiento = 'AJUSTE' AND v_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad de ajuste no puede ser negativa';
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = v_inventario_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      activo
    )
    VALUES (p_producto_id, v_inventario_sucursal_id, 0, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'INGRESO' THEN
    v_nueva := v_anterior + v_cantidad;
  ELSIF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
  ELSE
    v_nueva := v_cantidad;
  END IF;

  UPDATE public.inventario_productos
  SET cantidad_disponible = v_nueva
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.movimientos_inventario (
    producto_id,
    sucursal_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_producto_id,
    v_inventario_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    v_registrado_nombre
  )
  RETURNING id INTO v_movimiento_id;

  RETURN QUERY
  SELECT
    v_movimiento_id,
    p_producto_id,
    v_inventario_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    v_registrado_nombre,
    now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_traslado_bodega_general(p_sucursal_destino_id uuid, p_fecha_traslado date, p_detalle jsonb, p_observaciones text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_nombre text := 'Usuario';
  v_observaciones text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_traslado_id uuid;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric(14, 3);
  v_inventario_id uuid;
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_sucursal_inv_id uuid;
  v_sucursal_anterior numeric(14, 3);
  v_motivo text;
  v_items int := 0;
  v_sucursal_nombre text;
  v_destino_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_bodega_general(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos a sucursal';
  END IF;

  IF p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar la sucursal destino';
  END IF;

  v_destino_id := public.inventario_sucursal_efectiva(p_sucursal_destino_id);

  SELECT b.name INTO v_sucursal_nombre
  FROM public.branches b
  WHERE b.id = v_destino_id AND b.is_active = true;

  IF v_sucursal_nombre IS NULL THEN
    RAISE EXCEPTION 'Sucursal destino no encontrada o inactiva';
  END IF;

  IF p_fecha_traslado IS NULL THEN
    RAISE EXCEPTION 'La fecha del traslado es obligatoria';
  END IF;

  IF p_detalle IS NULL OR jsonb_typeof(p_detalle) <> 'array' OR jsonb_array_length(p_detalle) = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.username), ''), 'Usuario')
  INTO v_actor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_actor_id;

  INSERT INTO public.traslados_bodega_general (
    sucursal_destino_id,
    fecha_traslado,
    observaciones,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    v_destino_id,
    p_fecha_traslado,
    v_observaciones,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_traslado_id;

  v_motivo := 'Envío a sucursal ' || v_sucursal_nombre;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_detalle)
  LOOP
    v_producto_id := NULLIF(v_item->>'producto_global_id', '')::uuid;
    v_cantidad := trunc(COALESCE((v_item->>'cantidad')::numeric, 0));

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'Producto inválido en el detalle del traslado';
    END IF;

    IF v_cantidad <= 0 OR v_cantidad <> trunc(v_cantidad) THEN
      RAISE EXCEPTION 'La cantidad debe ser un número entero mayor a 0';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.productos_globales pg WHERE pg.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto general no encontrado';
    END IF;

    v_items := v_items + 1;

    INSERT INTO public.traslados_bodega_general_detalle (
      traslado_id,
      producto_global_id,
      cantidad
    )
    VALUES (v_traslado_id, v_producto_id, v_cantidad);

    SELECT ibg.id, ibg.cantidad_disponible
    INTO v_inventario_id, v_anterior
    FROM public.inventario_bodega_general ibg
    WHERE ibg.producto_global_id = v_producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay stock en bodega general para uno de los productos';
    END IF;

    v_anterior := COALESCE(v_anterior, 0);
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en bodega general. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;

    v_nueva := v_anterior - v_cantidad;

    UPDATE public.inventario_bodega_general
    SET cantidad_disponible = v_nueva,
        actualizado_en = now()
    WHERE id = v_inventario_id;

    INSERT INTO public.movimientos_bodega_general (
      producto_global_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      sucursal_destino_id,
      registrado_por,
      registrado_por_nombre,
      traslado_id
    )
    VALUES (
      v_producto_id,
      'SALIDA',
      v_cantidad,
      v_anterior,
      v_nueva,
      v_motivo,
      v_destino_id,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario'),
      v_traslado_id
    );

    SELECT ibs.id, ibs.cantidad_disponible
    INTO v_sucursal_inv_id, v_sucursal_anterior
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.producto_global_id = v_producto_id
      AND ibs.sucursal_id = v_destino_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventario_bodega_sucursal (
        producto_global_id,
        sucursal_id,
        cantidad_disponible,
        activo
      )
      VALUES (v_producto_id, v_destino_id, v_cantidad, true)
      RETURNING id INTO v_sucursal_inv_id;
    ELSE
      UPDATE public.inventario_bodega_sucursal
      SET cantidad_disponible = COALESCE(v_sucursal_anterior, 0) + v_cantidad,
          activo = true,
          actualizado_en = now()
      WHERE id = v_sucursal_inv_id;
    END IF;
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  RETURN v_traslado_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_traslado_bodega_sucursal_nevera(p_sucursal_id uuid, p_fecha_traslado date, p_detalle jsonb, p_observaciones text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_nombre text := 'Usuario';
  v_observaciones text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_traslado_id uuid;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric(14, 3);
  v_bodega_inv_id uuid;
  v_bodega_anterior numeric(14, 3);
  v_bodega_nueva numeric(14, 3);
  v_nevera_inv_id uuid;
  v_nevera_anterior numeric(14, 3);
  v_nevera_nueva numeric(14, 3);
  v_integra boolean := false;
  v_motivo_salida text;
  v_motivo_ingreso text;
  v_items int := 0;
  v_sucursal_nombre text;
  v_inventario_sucursal_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'sucursal_id es obligatorio';
  END IF;

  IF NOT public.can_operate_bodega_sucursal(v_actor_id, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos a nevera en esta sucursal';
  END IF;

  SELECT b.name INTO v_sucursal_nombre
  FROM public.branches b
  WHERE b.id = p_sucursal_id AND b.is_active = true;

  IF v_sucursal_nombre IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada o inactiva';
  END IF;

  IF p_fecha_traslado IS NULL THEN
    RAISE EXCEPTION 'La fecha del traslado es obligatoria';
  END IF;

  IF p_detalle IS NULL OR jsonb_typeof(p_detalle) <> 'array' OR jsonb_array_length(p_detalle) = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  v_inventario_sucursal_id := public.inventario_sucursal_efectiva(p_sucursal_id);

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.username), ''), 'Usuario')
  INTO v_actor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_actor_id;

  INSERT INTO public.traslados_bodega_sucursal_nevera (
    sucursal_id,
    fecha_traslado,
    observaciones,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    v_inventario_sucursal_id,
    p_fecha_traslado,
    v_observaciones,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_traslado_id;

  v_motivo_salida := 'Envío a nevera';
  v_motivo_ingreso := 'Abastecimiento desde bodega sucursal';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_detalle)
  LOOP
    v_producto_id := NULLIF(v_item->>'producto_global_id', '')::uuid;
    v_cantidad := trunc(COALESCE((v_item->>'cantidad')::numeric, 0));

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'Producto inválido en el detalle del traslado';
    END IF;

    IF v_cantidad <= 0 OR v_cantidad <> trunc(v_cantidad) THEN
      RAISE EXCEPTION 'La cantidad debe ser un número entero mayor a 0';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.productos_globales pg WHERE pg.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto general no encontrado';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto no disponible en nevera (falta espejo en products)';
    END IF;

    v_items := v_items + 1;

    INSERT INTO public.traslados_bodega_sucursal_nevera_detalle (
      traslado_id,
      producto_global_id,
      cantidad
    )
    VALUES (v_traslado_id, v_producto_id, v_cantidad);

    -- Salida de bodega sucursal
    SELECT ibs.id, ibs.cantidad_disponible, ibs.integra_con_ventas
    INTO v_bodega_inv_id, v_bodega_anterior, v_integra
    FROM public.inventario_bodega_sucursal ibs
    WHERE ibs.producto_global_id = v_producto_id
      AND ibs.sucursal_id = v_inventario_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay stock en bodega sucursal para uno de los productos';
    END IF;

    v_bodega_anterior := COALESCE(v_bodega_anterior, 0);
    IF v_bodega_anterior < v_cantidad THEN
      RAISE EXCEPTION
        'Stock insuficiente en bodega sucursal. Disponible: %, solicitado: %',
        v_bodega_anterior,
        v_cantidad;
    END IF;

    v_bodega_nueva := v_bodega_anterior - v_cantidad;

    UPDATE public.inventario_bodega_sucursal
    SET cantidad_disponible = v_bodega_nueva,
        actualizado_en = now()
    WHERE id = v_bodega_inv_id;

    INSERT INTO public.movimientos_bodega_sucursal (
      producto_global_id,
      sucursal_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      registrado_por,
      registrado_por_nombre,
      traslado_nevera_id
    )
    VALUES (
      v_producto_id,
      v_inventario_sucursal_id,
      'SALIDA',
      v_cantidad,
      v_bodega_anterior,
      v_bodega_nueva,
      v_motivo_salida,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario'),
      v_traslado_id
    );

    -- Ingreso a nevera (inventario_productos; producto_id = producto_global_id)
    SELECT ip.id, ip.cantidad_disponible
    INTO v_nevera_inv_id, v_nevera_anterior
    FROM public.inventario_productos ip
    WHERE ip.producto_id = v_producto_id
      AND ip.sucursal_id = v_inventario_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventario_productos (
        producto_id,
        sucursal_id,
        cantidad_disponible,
        integra_con_ventas,
        activo
      )
      VALUES (
        v_producto_id,
        v_inventario_sucursal_id,
        v_cantidad,
        COALESCE(v_integra, false),
        true
      )
      RETURNING id INTO v_nevera_inv_id;
      v_nevera_anterior := 0;
      v_nevera_nueva := v_cantidad;
    ELSE
      v_nevera_anterior := COALESCE(v_nevera_anterior, 0);
      v_nevera_nueva := v_nevera_anterior + v_cantidad;
      UPDATE public.inventario_productos
      SET cantidad_disponible = v_nevera_nueva,
          activo = true,
          actualizado_en = now()
      WHERE id = v_nevera_inv_id;
    END IF;

    INSERT INTO public.movimientos_inventario (
      producto_id,
      sucursal_id,
      tipo_movimiento,
      cantidad_movimiento,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      registrado_por,
      registrado_por_nombre
    )
    VALUES (
      v_producto_id,
      v_inventario_sucursal_id,
      'INGRESO',
      v_cantidad,
      v_nevera_anterior,
      v_nevera_nueva,
      v_motivo_ingreso,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario')
    );
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al traslado';
  END IF;

  RETURN v_traslado_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- RLS: el permiso en cualquier sucursal que comparte el inventario da acceso a él.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Inventario select por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario select por sucursal"
ON public.inventario_productos
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_productos.sucursal_id) AS s(id)
    WHERE public.has_branch_permission(auth.uid(), s.id, 'admin_sucursal'::text, 'VIEW'::public.access_level)
      OR public.has_branch_permission(auth.uid(), s.id, 'admin_global'::text, 'VIEW'::public.access_level)
      OR public.can_manage_branch_admin(auth.uid(), s.id)
      OR public.can_operate_inventario_movimientos(auth.uid(), s.id)
      OR public.has_branch_permission(auth.uid(), s.id, 'inventario_movimientos'::text, 'VIEW'::public.access_level)
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.active_branch_id = s.id
      )
  )
);

DROP POLICY IF EXISTS "Inventario insert por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario insert por sucursal"
ON public.inventario_productos
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_productos.sucursal_id) AS s(id)
    WHERE public.can_manage_branch_admin(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS "Inventario update por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario update por sucursal"
ON public.inventario_productos
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_productos.sucursal_id) AS s(id)
    WHERE public.can_manage_branch_admin(auth.uid(), s.id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_productos.sucursal_id) AS s(id)
    WHERE public.can_manage_branch_admin(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS "Inventario delete por sucursal" ON public.inventario_productos;
CREATE POLICY "Inventario delete por sucursal"
ON public.inventario_productos
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_productos.sucursal_id) AS s(id)
    WHERE public.can_manage_branch_admin(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS inventario_bodega_sucursal_select ON public.inventario_bodega_sucursal;
CREATE POLICY inventario_bodega_sucursal_select
ON public.inventario_bodega_sucursal
FOR SELECT
TO authenticated
USING (
  public.can_operate_bodega_general(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(inventario_bodega_sucursal.sucursal_id) AS s(id)
    WHERE public.can_operate_bodega_sucursal(auth.uid(), s.id)
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.active_branch_id = s.id
      )
  )
);

DROP POLICY IF EXISTS movimientos_bodega_sucursal_select ON public.movimientos_bodega_sucursal;
CREATE POLICY movimientos_bodega_sucursal_select
ON public.movimientos_bodega_sucursal
FOR SELECT
TO authenticated
USING (
  public.can_operate_bodega_general(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(movimientos_bodega_sucursal.sucursal_id) AS s(id)
    WHERE public.can_operate_bodega_sucursal(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS "Movimientos inventario select por sucursal" ON public.movimientos_inventario;
CREATE POLICY "Movimientos inventario select por sucursal"
ON public.movimientos_inventario
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(movimientos_inventario.sucursal_id) AS s(id)
    WHERE public.can_view_inventario_movimientos(auth.uid(), s.id)
      OR public.has_branch_permission(auth.uid(), s.id, 'admin_sucursal'::text, 'VIEW'::public.access_level)
      OR public.has_branch_permission(auth.uid(), s.id, 'admin_global'::text, 'VIEW'::public.access_level)
  )
);

DROP POLICY IF EXISTS traslados_bodega_sucursal_nevera_select ON public.traslados_bodega_sucursal_nevera;
CREATE POLICY traslados_bodega_sucursal_nevera_select
ON public.traslados_bodega_sucursal_nevera
FOR SELECT
TO authenticated
USING (
  public.can_operate_bodega_general(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(traslados_bodega_sucursal_nevera.sucursal_id) AS s(id)
    WHERE public.can_operate_bodega_sucursal(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS traslados_bodega_sucursal_nevera_detalle_select ON public.traslados_bodega_sucursal_nevera_detalle;
CREATE POLICY traslados_bodega_sucursal_nevera_detalle_select
ON public.traslados_bodega_sucursal_nevera_detalle
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.traslados_bodega_sucursal_nevera t
    WHERE t.id = traslados_bodega_sucursal_nevera_detalle.traslado_id
      AND (
        public.can_operate_bodega_general(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.inventario_sucursales_compartidas(t.sucursal_id) AS s(id)
          WHERE public.can_operate_bodega_sucursal(auth.uid(), s.id)
        )
      )
  )
);
