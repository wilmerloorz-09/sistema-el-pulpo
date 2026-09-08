-- Guardar "Todas las sucursales" reemplaza los precios de cada sucursal existente.

CREATE OR REPLACE FUNCTION public.guardar_precios_dia_personal(
  p_branch_id uuid,
  p_lunes_viernes numeric,
  p_sabado numeric,
  p_domingo numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF p_lunes_viernes<0 OR p_sabado<0 OR p_domingo<0 THEN
    RAISE EXCEPTION 'Los precios no pueden ser negativos';
  END IF;

  IF p_branch_id IS NULL THEN
    IF NOT public.is_global_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Solo el administrador global puede configurar todas las sucursales';
    END IF;

    INSERT INTO public.precios_dia_personal_global(
      singleton,lunes_viernes,sabado,domingo,actualizado_por
    ) VALUES(
      true,p_lunes_viernes,p_sabado,p_domingo,auth.uid()
    )
    ON CONFLICT(singleton) DO UPDATE SET
      lunes_viernes=EXCLUDED.lunes_viernes,
      sabado=EXCLUDED.sabado,
      domingo=EXCLUDED.domingo,
      actualizado_por=auth.uid(),
      actualizado_en=now();

    INSERT INTO public.precios_dia_personal(
      branch_id,lunes_viernes,sabado,domingo,actualizado_por
    )
    SELECT
      b.id,p_lunes_viernes,p_sabado,p_domingo,auth.uid()
    FROM public.branches b
    ON CONFLICT(branch_id) DO UPDATE SET
      lunes_viernes=EXCLUDED.lunes_viernes,
      sabado=EXCLUDED.sabado,
      domingo=EXCLUDED.domingo,
      actualizado_por=auth.uid(),
      actualizado_en=now();
    RETURN;
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(),p_branch_id) THEN
    RAISE EXCEPTION 'Sin permiso para configurar esta sucursal';
  END IF;

  INSERT INTO public.precios_dia_personal(
    branch_id,lunes_viernes,sabado,domingo,actualizado_por
  ) VALUES(
    p_branch_id,p_lunes_viernes,p_sabado,p_domingo,auth.uid()
  )
  ON CONFLICT(branch_id) DO UPDATE SET
    lunes_viernes=EXCLUDED.lunes_viernes,
    sabado=EXCLUDED.sabado,
    domingo=EXCLUDED.domingo,
    actualizado_por=auth.uid(),
    actualizado_en=now();
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_precios_dia_personal(uuid,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_precios_dia_personal(uuid,numeric,numeric,numeric) TO authenticated;
