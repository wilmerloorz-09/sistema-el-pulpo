-- Todas las cantidades de producto en inventario son números enteros.
-- (Precios y subtotales siguen con decimales.)

DO $$
DECLARE
  r record;
  v_constraint text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('inventario_productos', 'cantidad_disponible'),
      ('inventario_productos', 'limite_stock'),
      ('inventario_bodega_sucursal', 'cantidad_disponible'),
      ('inventario_bodega_general', 'cantidad_disponible'),
      ('producto_sucursal', 'cantidad_disponible'),
      ('movimientos_inventario', 'cantidad_movimiento'),
      ('movimientos_inventario', 'cantidad_anterior'),
      ('movimientos_inventario', 'cantidad_nueva'),
      ('movimientos_bodega_general', 'cantidad_movimiento'),
      ('movimientos_bodega_general', 'cantidad_anterior'),
      ('movimientos_bodega_general', 'cantidad_nueva'),
      ('movimientos_bodega_sucursal', 'cantidad_movimiento'),
      ('movimientos_bodega_sucursal', 'cantidad_anterior'),
      ('movimientos_bodega_sucursal', 'cantidad_nueva'),
      ('compras_bodega_general_detalle', 'cantidad'),
      ('traslados_bodega_general_detalle', 'cantidad'),
      ('traslados_bodega_sucursal_nevera_detalle', 'cantidad')
    ) AS t(tabla, columna)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tabla AND column_name = r.columna
    ) THEN
      CONTINUE;
    END IF;

    v_constraint := r.tabla || '_' || r.columna || '_entero_chk';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = v_constraint) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = trunc(%I))',
        r.tabla, v_constraint, r.columna, r.columna
      );
    END IF;
  END LOOP;
END $$;
