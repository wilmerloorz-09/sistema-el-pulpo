-- Inventario vivo por bandeja (pescado cocido) + verificación de cantidad.

CREATE TABLE IF NOT EXISTS public.pescado_bandejas (
  numero text PRIMARY KEY,
  cantidad_cocida_lb numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT pescado_bandejas_cocida_chk CHECK (cantidad_cocida_lb >= 0),
  cantidad_verificada_lb numeric(14, 3) NULL
    CONSTRAINT pescado_bandejas_verificada_chk CHECK (
      cantidad_verificada_lb IS NULL OR cantidad_verificada_lb >= 0
    ),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid NULL,
  verificado_en timestamptz NULL,
  verificado_por uuid NULL
);

COMMENT ON TABLE public.pescado_bandejas IS
  'Estado actual de bandejas con pescado cocido en Bodega General (peso cocido + verificación).';

CREATE INDEX IF NOT EXISTS idx_pescado_bandejas_cocida
  ON public.pescado_bandejas (cantidad_cocida_lb DESC)
  WHERE cantidad_cocida_lb > 0;

ALTER TABLE public.pescado_bandejas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pescado_bandejas_select ON public.pescado_bandejas;
CREATE POLICY pescado_bandejas_select ON public.pescado_bandejas
  FOR SELECT TO authenticated
  USING (public.can_operate_gestion_pescado(auth.uid()));

GRANT SELECT ON public.pescado_bandejas TO authenticated;

-- Sincroniza bandejas tras una preparación: limpia cocidas y carga las del formulario.
CREATE OR REPLACE FUNCTION public.sincronizar_bandejas_pescado_cocido(
  p_numeros text[],
  p_pesos_lb numeric[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_n integer;
  v_i integer;
  v_numero text;
  v_peso numeric(14, 3);
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para sincronizar bandejas de pescado';
  END IF;

  IF p_numeros IS NULL OR p_pesos_lb IS NULL THEN
    RAISE EXCEPTION 'Debes enviar números y pesos de bandejas';
  END IF;
  IF cardinality(p_numeros) IS DISTINCT FROM cardinality(p_pesos_lb) THEN
    RAISE EXCEPTION 'La cantidad de números y pesos de bandejas no coincide';
  END IF;

  UPDATE public.pescado_bandejas
  SET cantidad_cocida_lb = 0,
      cantidad_verificada_lb = NULL,
      actualizado_en = now(),
      actualizado_por = v_actor,
      verificado_en = NULL,
      verificado_por = NULL
  WHERE cantidad_cocida_lb > 0
     OR cantidad_verificada_lb IS NOT NULL;

  v_n := COALESCE(cardinality(p_numeros), 0);
  FOR v_i IN 1..v_n LOOP
    v_numero := NULLIF(btrim(p_numeros[v_i]), '');
    v_peso := round(COALESCE(p_pesos_lb[v_i], 0)::numeric, 3);
    IF v_numero IS NULL THEN
      RAISE EXCEPTION 'Hay bandejas sin número';
    END IF;
    IF v_peso <= 0 THEN
      RAISE EXCEPTION 'La bandeja % debe tener peso mayor a 0', v_numero;
    END IF;

    INSERT INTO public.pescado_bandejas (
      numero, cantidad_cocida_lb, cantidad_verificada_lb,
      actualizado_en, actualizado_por, verificado_en, verificado_por
    ) VALUES (
      v_numero, v_peso, NULL, now(), v_actor, NULL, NULL
    )
    ON CONFLICT (numero) DO UPDATE
    SET cantidad_cocida_lb = EXCLUDED.cantidad_cocida_lb,
        cantidad_verificada_lb = NULL,
        actualizado_en = now(),
        actualizado_por = v_actor,
        verificado_en = NULL,
        verificado_por = NULL;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.listar_bandejas_verificacion_pescado()
RETURNS TABLE (
  numero text,
  cantidad_cocida_lb numeric,
  cantidad_verificada_lb numeric,
  actualizado_en timestamptz,
  verificado_en timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para ver la verificación de bandejas';
  END IF;

  RETURN QUERY
  SELECT
    b.numero,
    b.cantidad_cocida_lb,
    b.cantidad_verificada_lb,
    b.actualizado_en,
    b.verificado_en
  FROM public.pescado_bandejas b
  WHERE b.cantidad_cocida_lb > 0
  ORDER BY
    CASE WHEN b.numero ~ '^[0-9]+$' THEN b.numero::integer ELSE NULL END NULLS LAST,
    b.numero;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_verificacion_bandeja_pescado(
  p_numero text,
  p_cantidad_verificada_lb numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_numero text := NULLIF(btrim(COALESCE(p_numero, '')), '');
  v_qty numeric(14, 3);
  v_row public.pescado_bandejas%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para guardar la verificación de bandejas';
  END IF;
  IF v_numero IS NULL THEN RAISE EXCEPTION 'Número de bandeja obligatorio'; END IF;

  v_qty := round(COALESCE(p_cantidad_verificada_lb, 0)::numeric, 3);
  IF v_qty < 0 THEN
    RAISE EXCEPTION 'La cantidad verificada no puede ser negativa';
  END IF;

  SELECT * INTO v_row
  FROM public.pescado_bandejas
  WHERE numero = v_numero
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_row.cantidad_cocida_lb, 0) <= 0 THEN
    RAISE EXCEPTION 'La bandeja % no tiene pescado cocido para verificar', v_numero;
  END IF;

  UPDATE public.pescado_bandejas
  SET cantidad_verificada_lb = v_qty,
      verificado_en = now(),
      verificado_por = v_actor,
      actualizado_en = now(),
      actualizado_por = v_actor
  WHERE numero = v_numero
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'numero', v_row.numero,
    'cantidad_cocida_lb', v_row.cantidad_cocida_lb,
    'cantidad_verificada_lb', v_row.cantidad_verificada_lb,
    'verificado_en', v_row.verificado_en
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sincronizar_bandejas_pescado_cocido(text[], numeric[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_bandejas_pescado_cocido(text[], numeric[]) TO authenticated;
REVOKE ALL ON FUNCTION public.listar_bandejas_verificacion_pescado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_bandejas_verificacion_pescado() TO authenticated;
REVOKE ALL ON FUNCTION public.guardar_verificacion_bandeja_pescado(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_verificacion_bandeja_pescado(text, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
