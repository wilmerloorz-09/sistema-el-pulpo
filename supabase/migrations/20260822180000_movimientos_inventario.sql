-- Etapa 2 (parcial): movimientos de inventario por sucursal
-- INGRESO | SALIDA | AJUSTE con historial auditable.
-- NO integra ventas ni descuento automático.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'tipo_movimiento_inventario'
  ) THEN
    CREATE TYPE public.tipo_movimiento_inventario AS ENUM ('INGRESO', 'SALIDA', 'AJUSTE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  tipo_movimiento public.tipo_movimiento_inventario NOT NULL,
  cantidad_movimiento numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_inventario_cantidad_movimiento_chk CHECK (cantidad_movimiento >= 0),
  cantidad_anterior numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_inventario_cantidad_anterior_chk CHECK (cantidad_anterior >= 0),
  cantidad_nueva numeric(14, 3) NOT NULL
    CONSTRAINT movimientos_inventario_cantidad_nueva_chk CHECK (cantidad_nueva >= 0),
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  registrado_por_nombre text NOT NULL DEFAULT 'Usuario',
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.movimientos_inventario IS
  'Historial de movimientos de inventario por producto y sucursal. Solo append; no modifica ventas.';
COMMENT ON COLUMN public.movimientos_inventario.cantidad_movimiento IS
  'INGRESO/SALIDA: unidades movidas. AJUSTE: cantidad final fijada.';
COMMENT ON COLUMN public.movimientos_inventario.motivo IS
  'Motivo operativo del movimiento (ej. traslado a otra sucursal, conteo físico).';

CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_sucursal_creado
  ON public.movimientos_inventario (sucursal_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_producto_sucursal_creado
  ON public.movimientos_inventario (producto_id, sucursal_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_registrado_por
  ON public.movimientos_inventario (registrado_por);

ALTER TABLE public.movimientos_inventario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Movimientos inventario select por sucursal" ON public.movimientos_inventario;
CREATE POLICY "Movimientos inventario select por sucursal"
ON public.movimientos_inventario
FOR SELECT
TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_sucursal', 'VIEW'::public.access_level)
  OR public.has_branch_permission(auth.uid(), sucursal_id, 'admin_global', 'VIEW'::public.access_level)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
);

-- Los movimientos se registran únicamente vía RPC (SECURITY DEFINER).
-- No hay políticas INSERT/UPDATE/DELETE para authenticated.

CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_sucursal_id uuid,
  p_tipo_movimiento public.tipo_movimiento_inventario,
  p_cantidad numeric,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  movimiento_id uuid,
  producto_id uuid,
  sucursal_id uuid,
  tipo_movimiento public.tipo_movimiento_inventario,
  cantidad_movimiento numeric,
  cantidad_anterior numeric,
  cantidad_nueva numeric,
  motivo text,
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

  IF NOT public.can_manage_branch_admin(v_actor_id, p_sucursal_id) THEN
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

  SELECT ip.id, ip.cantidad_disponible
  INTO v_inventario_id, v_anterior
  FROM public.inventario_productos ip
  WHERE ip.producto_id = p_producto_id
    AND ip.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.inventario_productos (
      producto_id,
      sucursal_id,
      cantidad_disponible,
      activo
    )
    VALUES (p_producto_id, p_sucursal_id, 0, true)
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
    p_sucursal_id,
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
    p_sucursal_id,
    p_tipo_movimiento,
    CASE WHEN p_tipo_movimiento = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    v_motivo,
    v_actor_id,
    v_registrado_nombre,
    now();
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_inventario(uuid, uuid, public.tipo_movimiento_inventario, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_inventario(uuid, uuid, public.tipo_movimiento_inventario, numeric, text) TO authenticated;
