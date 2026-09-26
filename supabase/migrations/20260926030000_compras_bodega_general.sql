-- Compras de bodega general: encabezado + detalle.
-- Al registrar, ingresa stock en inventario_bodega_general.

-- Enlace opcional desde movimientos hacia la compra origen.
ALTER TABLE public.movimientos_bodega_general
  ADD COLUMN IF NOT EXISTS compra_id uuid NULL;

CREATE TABLE IF NOT EXISTS public.compras_bodega_general (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid NOT NULL REFERENCES public.proveedores(id),
  numero_comprobante text NOT NULL,
  fecha_compra date NOT NULL DEFAULT (CURRENT_DATE),
  observaciones text NULL,
  total numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT compras_bodega_general_total_chk CHECK (total >= 0),
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  registrado_por_nombre text NOT NULL DEFAULT 'Usuario',
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compras_bodega_general_comprobante_chk CHECK (length(btrim(numero_comprobante)) >= 1)
);

COMMENT ON TABLE public.compras_bodega_general IS
  'Encabezado de compras a proveedores para bodega general.';
COMMENT ON COLUMN public.compras_bodega_general.numero_comprobante IS
  'Número de factura o comprobante del proveedor.';
COMMENT ON COLUMN public.compras_bodega_general.fecha_compra IS
  'Fecha de la compra según el comprobante.';

CREATE TABLE IF NOT EXISTS public.compras_bodega_general_detalle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES public.compras_bodega_general(id) ON DELETE CASCADE,
  producto_global_id uuid NOT NULL REFERENCES public.productos_globales(id),
  cantidad numeric(14, 3) NOT NULL
    CONSTRAINT compras_bodega_general_detalle_cantidad_chk CHECK (cantidad > 0),
  precio_unitario numeric(14, 4) NOT NULL DEFAULT 0
    CONSTRAINT compras_bodega_general_detalle_precio_chk CHECK (precio_unitario >= 0),
  subtotal numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT compras_bodega_general_detalle_subtotal_chk CHECK (subtotal >= 0),
  CONSTRAINT compras_bodega_general_detalle_producto_uniq UNIQUE (compra_id, producto_global_id)
);

COMMENT ON TABLE public.compras_bodega_general_detalle IS
  'Líneas de producto de una compra de bodega general.';

CREATE INDEX IF NOT EXISTS idx_compras_bodega_general_fecha
  ON public.compras_bodega_general (fecha_compra DESC, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_compras_bodega_general_proveedor
  ON public.compras_bodega_general (proveedor_id);

CREATE INDEX IF NOT EXISTS idx_compras_bodega_general_comprobante
  ON public.compras_bodega_general (lower(btrim(numero_comprobante)));

CREATE INDEX IF NOT EXISTS idx_compras_bodega_general_detalle_compra
  ON public.compras_bodega_general_detalle (compra_id);

CREATE INDEX IF NOT EXISTS idx_compras_bodega_general_detalle_producto
  ON public.compras_bodega_general_detalle (producto_global_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movimientos_bodega_general_compra_fk'
  ) THEN
    ALTER TABLE public.movimientos_bodega_general
      ADD CONSTRAINT movimientos_bodega_general_compra_fk
      FOREIGN KEY (compra_id) REFERENCES public.compras_bodega_general(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movimientos_bodega_general_compra
  ON public.movimientos_bodega_general (compra_id)
  WHERE compra_id IS NOT NULL;

ALTER TABLE public.compras_bodega_general ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras_bodega_general_detalle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compras_bodega_general_select ON public.compras_bodega_general;
CREATE POLICY compras_bodega_general_select
ON public.compras_bodega_general
FOR SELECT
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

DROP POLICY IF EXISTS compras_bodega_general_detalle_select ON public.compras_bodega_general_detalle;
CREATE POLICY compras_bodega_general_detalle_select
ON public.compras_bodega_general_detalle
FOR SELECT
TO authenticated
USING (public.can_operate_bodega_general(auth.uid()));

-- Solo vía RPC SECURITY DEFINER: sin INSERT/UPDATE/DELETE directos.

CREATE OR REPLACE FUNCTION public.registrar_compra_bodega_general(
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
  v_total numeric(14, 2) := 0;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric(14, 3);
  v_precio numeric(14, 4);
  v_subtotal numeric(14, 2);
  v_inventario_id uuid;
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_motivo text;
  v_items int := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;

  IF NOT public.can_operate_bodega_general(v_actor_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras en bodega general';
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

  INSERT INTO public.compras_bodega_general (
    proveedor_id,
    numero_comprobante,
    fecha_compra,
    observaciones,
    total,
    registrado_por,
    registrado_por_nombre
  )
  VALUES (
    p_proveedor_id,
    v_comprobante,
    p_fecha_compra,
    v_observaciones,
    0,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Usuario')
  )
  RETURNING id INTO v_compra_id;

  v_motivo := 'Compra ' || v_comprobante;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_detalle)
  LOOP
    v_producto_id := NULLIF(v_item->>'producto_global_id', '')::uuid;
    v_cantidad := round(COALESCE((v_item->>'cantidad')::numeric, 0), 3);
    v_precio := round(COALESCE((v_item->>'precio_unitario')::numeric, 0), 4);

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'Producto inválido en el detalle de compra';
    END IF;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a 0';
    END IF;

    IF v_precio < 0 THEN
      RAISE EXCEPTION 'El precio unitario no puede ser negativo';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.productos_globales pg WHERE pg.id = v_producto_id) THEN
      RAISE EXCEPTION 'Producto general no encontrado';
    END IF;

    v_subtotal := round(v_cantidad * v_precio, 2);
    v_total := v_total + v_subtotal;
    v_items := v_items + 1;

    INSERT INTO public.compras_bodega_general_detalle (
      compra_id,
      producto_global_id,
      cantidad,
      precio_unitario,
      subtotal
    )
    VALUES (v_compra_id, v_producto_id, v_cantidad, v_precio, v_subtotal);

    SELECT ibg.id, ibg.cantidad_disponible
    INTO v_inventario_id, v_anterior
    FROM public.inventario_bodega_general ibg
    WHERE ibg.producto_global_id = v_producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventario_bodega_general (
        producto_global_id,
        cantidad_disponible,
        activo
      )
      VALUES (v_producto_id, 0, true)
      RETURNING id, cantidad_disponible
      INTO v_inventario_id, v_anterior;
    END IF;

    v_anterior := COALESCE(v_anterior, 0);
    v_nueva := v_anterior + v_cantidad;

    UPDATE public.inventario_bodega_general
    SET cantidad_disponible = v_nueva,
        activo = true,
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
      compra_id
    )
    VALUES (
      v_producto_id,
      'INGRESO',
      v_cantidad,
      v_anterior,
      v_nueva,
      v_motivo,
      NULL,
      v_actor_id,
      COALESCE(v_actor_nombre, 'Usuario'),
      v_compra_id
    );
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto a la compra';
  END IF;

  UPDATE public.compras_bodega_general
  SET total = v_total
  WHERE id = v_compra_id;

  RETURN v_compra_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_compra_bodega_general(uuid, text, date, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_compra_bodega_general(uuid, text, date, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
