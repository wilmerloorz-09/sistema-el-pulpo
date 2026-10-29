-- =============================================================================
-- Pescado fresco: catálogo, stock, compras (proveedor/factura), ajustes e historial.
-- Separado de pescado cocido (gestion_pescado actual).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pescado_fresco_productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_fresco_productos_codigo_uniq UNIQUE (codigo),
  CONSTRAINT pescado_fresco_productos_codigo_chk CHECK (length(btrim(codigo)) >= 1),
  CONSTRAINT pescado_fresco_productos_nombre_chk CHECK (length(btrim(nombre)) >= 1)
);

COMMENT ON TABLE public.pescado_fresco_productos IS
  'Catálogo de productos de pescado fresco (compra / ajuste).';

CREATE TABLE IF NOT EXISTS public.pescado_fresco_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.pescado_fresco_productos(id) ON DELETE RESTRICT,
  cantidad_lb numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT pescado_fresco_stock_cantidad_chk CHECK (cantidad_lb >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_fresco_stock_producto_uniq UNIQUE (producto_id)
);

COMMENT ON TABLE public.pescado_fresco_stock IS
  'Stock central de pescado fresco en libras.';

CREATE TABLE IF NOT EXISTS public.pescado_fresco_compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid NOT NULL REFERENCES public.proveedores(id),
  numero_comprobante text NOT NULL,
  fecha_compra date NOT NULL DEFAULT (CURRENT_DATE),
  observaciones text NULL,
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text NOT NULL DEFAULT 'Usuario',
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_fresco_compras_comprobante_chk CHECK (length(btrim(numero_comprobante)) >= 1)
);

CREATE TABLE IF NOT EXISTS public.pescado_fresco_compras_detalle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES public.pescado_fresco_compras(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.pescado_fresco_productos(id),
  cantidad_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_fresco_compras_detalle_cantidad_chk CHECK (cantidad_lb > 0),
  CONSTRAINT pescado_fresco_compras_detalle_producto_uniq UNIQUE (compra_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_pescado_fresco_compras_fecha
  ON public.pescado_fresco_compras (fecha_compra DESC, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_pescado_fresco_compras_detalle_compra
  ON public.pescado_fresco_compras_detalle (compra_id);

CREATE TABLE IF NOT EXISTS public.pescado_fresco_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.pescado_fresco_productos(id),
  tipo_movimiento text NOT NULL
    CONSTRAINT pescado_fresco_movimientos_tipo_chk CHECK (tipo_movimiento IN (
      'INGRESO',
      'SALIDA',
      'AJUSTE',
      'COMPRA'
    )),
  cantidad_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_fresco_movimientos_cantidad_chk CHECK (cantidad_lb >= 0),
  cantidad_anterior numeric(14, 3) NOT NULL,
  cantidad_nueva numeric(14, 3) NOT NULL,
  motivo text,
  compra_id uuid REFERENCES public.pescado_fresco_compras(id) ON DELETE SET NULL,
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pescado_fresco_movimientos_creado
  ON public.pescado_fresco_movimientos (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_pescado_fresco_movimientos_producto
  ON public.pescado_fresco_movimientos (producto_id, creado_en DESC);

INSERT INTO public.pescado_fresco_productos (codigo, nombre)
VALUES
  ('BONITO', 'Bonito'),
  ('ALBACORA', 'Albacora')
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  activo = true,
  actualizado_en = now();

INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
SELECT p.id, 0
FROM public.pescado_fresco_productos p
WHERE p.codigo IN ('BONITO', 'ALBACORA')
ON CONFLICT (producto_id) DO NOTHING;

ALTER TABLE public.pescado_fresco_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_fresco_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_fresco_compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_fresco_compras_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_fresco_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pescado_fresco_productos_select ON public.pescado_fresco_productos;
CREATE POLICY pescado_fresco_productos_select
ON public.pescado_fresco_productos FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_fresco_stock_select ON public.pescado_fresco_stock;
CREATE POLICY pescado_fresco_stock_select
ON public.pescado_fresco_stock FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_fresco_compras_select ON public.pescado_fresco_compras;
CREATE POLICY pescado_fresco_compras_select
ON public.pescado_fresco_compras FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_fresco_compras_detalle_select ON public.pescado_fresco_compras_detalle;
CREATE POLICY pescado_fresco_compras_detalle_select
ON public.pescado_fresco_compras_detalle FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_fresco_movimientos_select ON public.pescado_fresco_movimientos;
CREATE POLICY pescado_fresco_movimientos_select
ON public.pescado_fresco_movimientos FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

CREATE OR REPLACE FUNCTION public.listar_stock_pescado_fresco()
RETURNS TABLE (
  producto_id uuid,
  codigo text,
  nombre text,
  cantidad_lb numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.codigo,
    p.nombre,
    COALESCE(s.cantidad_lb, 0)::numeric(14, 3)
  FROM public.pescado_fresco_productos p
  LEFT JOIN public.pescado_fresco_stock s ON s.producto_id = p.id
  WHERE p.activo = true
    AND public.can_operate_gestion_pescado(auth.uid())
  ORDER BY p.nombre;
$$;

REVOKE ALL ON FUNCTION public.listar_stock_pescado_fresco() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_stock_pescado_fresco() TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_compra_pescado_fresco(
  p_proveedor_id uuid,
  p_numero_comprobante text,
  p_fecha_compra date,
  p_detalle jsonb,
  p_observaciones text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_nombre text := 'Usuario';
  v_comprobante text := NULLIF(btrim(COALESCE(p_numero_comprobante, '')), '');
  v_observaciones text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_compra_id uuid;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric(14, 3);
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_items int := 0;
  v_motivo text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_gestion_pescado(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras de pescado fresco';
  END IF;

  IF p_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar un proveedor';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.proveedores p
    WHERE p.id = p_proveedor_id AND p.activo = true
  ) THEN
    RAISE EXCEPTION 'Proveedor no encontrado o inactivo';
  END IF;

  IF v_comprobante IS NULL THEN
    RAISE EXCEPTION 'El número de comprobante/factura es obligatorio';
  END IF;

  IF p_fecha_compra IS NULL THEN
    RAISE EXCEPTION 'La fecha de compra es obligatoria';
  END IF;

  IF p_detalle IS NULL OR jsonb_typeof(p_detalle) <> 'array' OR jsonb_array_length(p_detalle) = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto a la compra';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.username), ''), 'Usuario')
  INTO v_actor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_actor_id;

  INSERT INTO public.pescado_fresco_compras (
    proveedor_id,
    numero_comprobante,
    fecha_compra,
    observaciones,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_proveedor_id,
    v_comprobante,
    p_fecha_compra,
    v_observaciones,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_compra_id;

  v_motivo := 'Compra ' || v_comprobante;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_detalle)
  LOOP
    v_producto_id := NULLIF(v_item->>'producto_id', '')::uuid;
    v_cantidad := round(COALESCE((v_item->>'cantidad_lb')::numeric, 0), 3);

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'Producto inválido en el detalle de compra';
    END IF;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a 0';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.pescado_fresco_productos pf
      WHERE pf.id = v_producto_id AND pf.activo = true
    ) THEN
      RAISE EXCEPTION 'Producto de pescado fresco no encontrado o inactivo';
    END IF;

    v_items := v_items + 1;

    INSERT INTO public.pescado_fresco_compras_detalle (
      compra_id,
      producto_id,
      cantidad_lb
    )
    VALUES (v_compra_id, v_producto_id, v_cantidad);

    SELECT s.cantidad_lb
    INTO v_anterior
    FROM public.pescado_fresco_stock s
    WHERE s.producto_id = v_producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
      VALUES (v_producto_id, 0)
      RETURNING cantidad_lb INTO v_anterior;
    END IF;

    v_anterior := COALESCE(v_anterior, 0);
    v_nueva := v_anterior + v_cantidad;

    UPDATE public.pescado_fresco_stock
    SET cantidad_lb = v_nueva,
        actualizado_en = now()
    WHERE producto_id = v_producto_id;

    INSERT INTO public.pescado_fresco_movimientos (
      producto_id,
      tipo_movimiento,
      cantidad_lb,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      compra_id,
      registrado_por,
      registrado_por_nombre
    )
    VALUES (
      v_producto_id,
      'COMPRA',
      v_cantidad,
      v_anterior,
      v_nueva,
      v_motivo,
      v_compra_id,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario')
    );
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto a la compra';
  END IF;

  RETURN v_compra_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_compra_pescado_fresco(uuid, text, date, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_compra_pescado_fresco(uuid, text, date, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_pescado_fresco(
  p_producto_id uuid,
  p_tipo_movimiento text,
  p_cantidad_lb numeric,
  p_motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_nombre text := 'Usuario';
  v_tipo text := upper(btrim(COALESCE(p_tipo_movimiento, '')));
  v_cantidad numeric(14, 3) := round(COALESCE(p_cantidad_lb, 0), 3);
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_mov_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_gestion_pescado(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ajustar pescado fresco';
  END IF;

  IF p_producto_id IS NULL THEN
    RAISE EXCEPTION 'Producto obligatorio';
  END IF;

  IF v_tipo NOT IN ('INGRESO', 'SALIDA', 'AJUSTE') THEN
    RAISE EXCEPTION 'Tipo de movimiento no soportado: %', v_tipo;
  END IF;

  IF v_tipo IN ('INGRESO', 'SALIDA') AND v_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  IF v_tipo = 'AJUSTE' AND v_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad de ajuste no puede ser negativa';
  END IF;

  IF v_tipo <> 'INGRESO' AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'El motivo es obligatorio para salida o ajuste';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pescado_fresco_productos pf
    WHERE pf.id = p_producto_id AND pf.activo = true
  ) THEN
    RAISE EXCEPTION 'Producto de pescado fresco no encontrado o inactivo';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.username), ''), 'Usuario')
  INTO v_actor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_actor_id;

  SELECT s.cantidad_lb
  INTO v_anterior
  FROM public.pescado_fresco_stock s
  WHERE s.producto_id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
    VALUES (p_producto_id, 0)
    RETURNING cantidad_lb INTO v_anterior;
  END IF;

  v_anterior := COALESCE(v_anterior, 0);

  IF v_tipo = 'INGRESO' THEN
    v_nueva := v_anterior + v_cantidad;
  ELSIF v_tipo = 'SALIDA' THEN
    IF v_cantidad > v_anterior THEN
      RAISE EXCEPTION 'Stock insuficiente: hay % lb y se intentan retirar % lb', v_anterior, v_cantidad;
    END IF;
    v_nueva := v_anterior - v_cantidad;
  ELSE
    v_nueva := v_cantidad;
  END IF;

  UPDATE public.pescado_fresco_stock
  SET cantidad_lb = v_nueva,
      actualizado_en = now()
  WHERE producto_id = p_producto_id;

  INSERT INTO public.pescado_fresco_movimientos (
    producto_id,
    tipo_movimiento,
    cantidad_lb,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_producto_id,
    v_tipo,
    CASE WHEN v_tipo = 'AJUSTE' THEN v_nueva ELSE v_cantidad END,
    v_anterior,
    v_nueva,
    COALESCE(v_motivo, 'Ingreso manual'),
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_pescado_fresco(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_pescado_fresco(uuid, text, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
