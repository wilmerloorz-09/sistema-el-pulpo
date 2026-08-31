-- Fix: el espejo a products no puede usar siempre display_order=1
-- (uq_products_subcategory_display_order bloqueaba el 2.º producto global).

CREATE OR REPLACE FUNCTION public.trg_productos_globales_mirror_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub uuid;
  v_display_order integer;
BEGIN
  v_sub := public.catalogo_global_bridge_subcategory_id();
  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'No existe subcategoria puente Catálogo global';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(display_order), 0) + 1
    INTO v_display_order
    FROM public.products
    WHERE subcategory_id = v_sub;
  ELSE
    SELECT display_order
    INTO v_display_order
    FROM public.products
    WHERE id = NEW.id;

    IF v_display_order IS NULL THEN
      SELECT COALESCE(MAX(display_order), 0) + 1
      INTO v_display_order
      FROM public.products
      WHERE subcategory_id = v_sub;
    END IF;
  END IF;

  INSERT INTO public.products (
    id,
    subcategory_id,
    description,
    unit_price,
    price_mode,
    display_order,
    is_active,
    tipo_producto,
    force_servir_module
  )
  VALUES (
    NEW.id,
    v_sub,
    NEW.nombre_principal,
    NEW.precio_default,
    NEW.price_mode,
    v_display_order,
    NEW.activo,
    NEW.tipo_producto,
    NEW.force_servir_default
  )
  ON CONFLICT (id) DO UPDATE
  SET
    description = EXCLUDED.description,
    unit_price = EXCLUDED.unit_price,
    price_mode = EXCLUDED.price_mode,
    is_active = EXCLUDED.is_active,
    tipo_producto = EXCLUDED.tipo_producto,
    force_servir_module = EXCLUDED.force_servir_module,
    updated_at = now();

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
