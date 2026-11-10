-- Configuración: cantidad física de bandejas existentes (Bodega General).

ALTER TABLE public.pescado_stock_central
  ADD COLUMN IF NOT EXISTS bandejas_existentes integer NOT NULL DEFAULT 0;

ALTER TABLE public.pescado_stock_central
  DROP CONSTRAINT IF EXISTS pescado_stock_central_bandejas_existentes_chk;
ALTER TABLE public.pescado_stock_central
  ADD CONSTRAINT pescado_stock_central_bandejas_existentes_chk
  CHECK (bandejas_existentes >= 0);

COMMENT ON COLUMN public.pescado_stock_central.bandejas_existentes IS
  'Cantidad física de bandejas existentes configurada para control operativo.';

CREATE OR REPLACE FUNCTION public.obtener_bandejas_existentes_pescado()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_qty integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para ver la configuración de bandejas';
  END IF;

  SELECT c.bandejas_existentes
  INTO v_qty
  FROM public.pescado_stock_central c
  WHERE c.codigo = 'PESCADO'
  LIMIT 1;

  RETURN COALESCE(v_qty, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_bandejas_existentes_pescado(p_cantidad integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_qty integer := COALESCE(p_cantidad, 0);
  v_stock uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para configurar bandejas';
  END IF;
  IF v_qty < 0 THEN
    RAISE EXCEPTION 'La cantidad de bandejas no puede ser negativa';
  END IF;

  v_stock := public.pescado_asegurar_stock_central();

  UPDATE public.pescado_stock_central
  SET bandejas_existentes = v_qty,
      updated_at = now()
  WHERE id = v_stock;

  RETURN v_qty;
END;
$function$;

REVOKE ALL ON FUNCTION public.obtener_bandejas_existentes_pescado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_bandejas_existentes_pescado() TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_bandejas_existentes_pescado(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_bandejas_existentes_pescado(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
