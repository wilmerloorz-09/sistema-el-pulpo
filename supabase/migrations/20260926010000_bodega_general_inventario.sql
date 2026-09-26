-- Bodega general: inventario central + movimientos (ingreso/salida/ajuste).
-- Nombres en español. No toca nevera ni bodega de sucursal.

CREATE TABLE IF NOT EXISTS public.inventario_bodega_general (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_global_id uuid NOT NULL REFERENCES public.productos_globales(id) ON DELETE CASCADE,
  cantidad_disponible numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT inventario_bodega_general_cantidad_chk CHECK (cantidad_disponible >= 0),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventario_bodega_general_producto_uniq UNIQUE (producto_global_id)
);

COMMENT ON TABLE public.inventario_bodega_general IS
  'Stock de la bodega general (central). Un registro por producto del catálogo global.';
COMMENT ON COLUMN public.inventario_bodega_general.cantidad_disponible IS
  'Cantidad disponible en bodega general.';

CREATE INDEX IF NOT EXISTS idx_inventario_bodega_general_activo
  ON public.inventario_bodega_general (activo);

CREATE INDEX IF NOT EXISTS idx_inventario_bodega_general_cantidad
  ON public.inventario_bodega_general (cantidad_disponible);

CREATE TABLE IF NOT EXISTS public.movimientos_bodega_general (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_global_id uuid NOT NULL REFERENCES public.productos_globales(id) ON DELETE CASCADE,
  tipo_movimiento public.tipo_movimiento_inventario NOT NULL,
  cantidad_movimiento numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_bodega_general_cantidad_movimiento_chk CHECK (cantidad_movimiento >= 0),
  cantidad_anterior numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_bodega_general_cantidad_anterior_chk CHECK (cantidad_anterior >= 0),
  cantidad_nueva numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_bodega_general_cantidad_nueva_chk CHECK (cantidad_nueva >= 0),
  motivo text NOT NULL,
  sucursal_destino_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  registrado_por_nombre text NOT NULL DEFAULT 'Usuario',
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.movimientos_bodega_general IS
  'Historial append-only de movimientos de la bodega general.';
COMMENT ON COLUMN public.movimientos_bodega_general.cantidad_movimiento IS
  'INGRESO/SALIDA: unidades movidas. AJUSTE: cantidad final fijada.';
COMMENT ON COLUMN public.movimientos_bodega_general.sucursal_destino_id IS
  'Opcional: sucursal destino cuando la salida alimenta una bodega de sucursal.';

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_general_creado
  ON public.movimientos_bodega_general (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_general_producto_creado
  ON public.movimientos_bodega_general (producto_global_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_general_registrado_por
  ON public.movimientos_bodega_general (registrado_por);

-- Semilla: fila de stock 0 para productos globales activos existentes.
INSERT INTO public.inventario_bodega_general (producto_global_id, cantidad_disponible, activo)
SELECT pg.id, 0, true
FROM public.productos_globales pg
WHERE pg.activo = true
ON CONFLICT (producto_global_id) DO NOTHING;

-- Mantener fila de inventario al crear producto global activo.
CREATE OR REPLACE FUNCTION public.trg_productos_globales_ensure_bodega_general()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.activo IS TRUE THEN
    INSERT INTO public.inventario_bodega_general (producto_global_id, cantidad_disponible, activo)
    VALUES (NEW.id, 0, true)
    ON CONFLICT (producto_global_id) DO UPDATE
      SET activo = true,
          actualizado_en = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_globales_ensure_bodega_general ON public.productos_globales;
CREATE TRIGGER trg_productos_globales_ensure_bodega_general
AFTER INSERT OR UPDATE OF activo
ON public.productos_globales
FOR EACH ROW
EXECUTE FUNCTION public.trg_productos_globales_ensure_bodega_general();

ALTER TABLE public.inventario_bodega_general ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_bodega_general ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_bodega_general_select ON public.inventario_bodega_general;
CREATE POLICY inventario_bodega_general_select
ON public.inventario_bodega_general
FOR SELECT
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

DROP POLICY IF EXISTS movimientos_bodega_general_select ON public.movimientos_bodega_general;
CREATE POLICY movimientos_bodega_general_select
ON public.movimientos_bodega_general
FOR SELECT
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

-- Solo vía RPC (SECURITY DEFINER): sin INSERT/UPDATE/DELETE directos.

CREATE OR REPLACE FUNCTION public.registrar_movimiento_bodega_general(
  p_producto_global_id uuid,
  p_tipo_movimiento public.tipo_movimiento_inventario,
  p_cantidad numeric,
  p_motivo text DEFAULT NULL,
  p_sucursal_destino_id uuid DEFAULT NULL
)
RETURNS TABLE (
  movimiento_id uuid,
  producto_global_id uuid,
  tipo_movimiento public.tipo_movimiento_inventario,
  cantidad_movimiento numeric,
  cantidad_anterior numeric,
  cantidad_nueva numeric,
  motivo text,
  sucursal_destino_id uuid,
  registrado_por uuid,
  registrado_por_nombre text,
  creado_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3) := 0;
  v_nueva numeric(14, 3);
  v_inventario_id uuid;
  v_registrado_nombre text;
  v_movimiento_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_bodega_general(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos en bodega general';
  END IF;

  IF p_producto_global_id IS NULL THEN
    RAISE EXCEPTION 'producto_global_id es obligatorio';
  END IF;

  IF p_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es obligatorio';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.productos_globales pg
    WHERE pg.id = p_producto_global_id
  ) THEN
    RAISE EXCEPTION 'Producto global no encontrado';
  END IF;

  IF p_sucursal_destino_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_sucursal_destino_id) THEN
    RAISE EXCEPTION 'Sucursal destino no encontrada';
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

  SELECT ibg.id, ibg.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_bodega_general ibg
  WHERE ibg.producto_global_id = p_producto_global_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.inventario_bodega_general (
      producto_global_id,
      cantidad_disponible,
      activo
    )
    VALUES (p_producto_global_id, 0, true)
    RETURNING id, cantidad_disponible
    INTO v_inventario_id, v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF p_tipo_movimiento = 'INGRESO' THEN
    v_nueva := v_anterior + v_cantidad;
  ELSIF p_tipo_movimiento = 'SALIDA' THEN
    IF v_anterior < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en bodega general. Disponible: %, solicitado: %', v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
  ELSE
    v_nueva := v_cantidad;
  END IF;

  UPDATE public.inventario_bodega_general
  SET cantidad_disponible = v_nueva,
      activo = true,
      actualizado_en = now()
  WHERE id = v_inventario_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Usuario')
  INTO v_registrado_nombre
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.movimientos_bodega_general (
    producto_global_id,
    tipo_movimiento,
    cantidad_movimiento,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    sucursal_destino_id,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_producto_global_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    p_sucursal_destino_id,
    v_actor_id,
    COALESCE(v_registrado_nombre, 'Usuario')
  )
  RETURNING id INTO v_movimiento_id;

  RETURN QUERY
  SELECT
    v_movimiento_id,
    p_producto_global_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    p_sucursal_destino_id,
    v_actor_id,
    COALESCE(v_registrado_nombre, 'Usuario'),
    now();
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_bodega_general(uuid, public.tipo_movimiento_inventario, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_bodega_general(uuid, public.tipo_movimiento_inventario, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_inventario_bodega_general()
RETURNS TABLE (
  producto_global_id uuid,
  nombre_principal text,
  codigo text,
  categoria text,
  tipo_producto public.tipo_producto,
  activo boolean,
  cantidad_disponible numeric,
  inventario_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pg.id AS producto_global_id,
    pg.nombre_principal,
    pg.codigo,
    pg.categoria::text,
    pg.tipo_producto,
    pg.activo,
    COALESCE(ibg.cantidad_disponible, 0)::numeric AS cantidad_disponible,
    ibg.id AS inventario_id
  FROM public.productos_globales pg
  LEFT JOIN public.inventario_bodega_general ibg
    ON ibg.producto_global_id = pg.id
  WHERE public.can_operate_bodega_general(auth.uid())
  ORDER BY pg.nombre_principal;
$$;

REVOKE ALL ON FUNCTION public.listar_inventario_bodega_general() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_inventario_bodega_general() TO authenticated;

NOTIFY pgrst, 'reload schema';
