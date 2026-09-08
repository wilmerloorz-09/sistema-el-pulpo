-- Precio general opcional para todas las sucursales.

CREATE TABLE IF NOT EXISTS public.precios_dia_personal_global (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  lunes_viernes numeric(12,2) NOT NULL DEFAULT 0 CHECK (lunes_viernes>=0),
  sabado numeric(12,2) NOT NULL DEFAULT 0 CHECK (sabado>=0),
  domingo numeric(12,2) NOT NULL DEFAULT 0 CHECK (domingo>=0),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.precios_dia_personal_global ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Personal autenticado ve precio diario global"
ON public.precios_dia_personal_global FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.precios_dia_personal_global TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.precios_dia_personal_global FROM authenticated;

ALTER TABLE public.precios_fecha_especial_personal
  ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.precios_fecha_especial_personal
  DROP CONSTRAINT IF EXISTS precios_fecha_especial_personal_branch_id_fecha_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_precio_especial_personal_sucursal
  ON public.precios_fecha_especial_personal(branch_id,fecha) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_precio_especial_personal_global
  ON public.precios_fecha_especial_personal(fecha) WHERE branch_id IS NULL;

DROP POLICY IF EXISTS "Personal ve precios especiales autorizados"
ON public.precios_fecha_especial_personal;
CREATE POLICY "Personal ve precios especiales autorizados"
ON public.precios_fecha_especial_personal FOR SELECT TO authenticated
USING (
  branch_id IS NULL
  OR public.can_view_jornadas_personal(auth.uid(),branch_id)
);

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

CREATE OR REPLACE FUNCTION public.guardar_precio_fecha_especial_personal(
  p_id uuid,
  p_branch_id uuid,
  p_fecha date,
  p_nombre text,
  p_valor numeric
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_id uuid:=COALESCE(p_id,gen_random_uuid());
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.is_global_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Solo el administrador global puede configurar todas las sucursales';
    END IF;
  ELSIF NOT public.can_manage_branch_admin(auth.uid(),p_branch_id) THEN
    RAISE EXCEPTION 'Sin permiso para configurar esta sucursal';
  END IF;
  IF p_valor<0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;

  IF p_branch_id IS NULL THEN
    INSERT INTO public.precios_fecha_especial_personal(
      id,branch_id,fecha,nombre,valor,creado_por,actualizado_por
    ) VALUES(v_id,NULL,p_fecha,btrim(p_nombre),p_valor,auth.uid(),auth.uid())
    ON CONFLICT(fecha) WHERE branch_id IS NULL DO UPDATE SET
      nombre=EXCLUDED.nombre,valor=EXCLUDED.valor,
      actualizado_por=auth.uid(),actualizado_en=now()
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.precios_fecha_especial_personal(
      id,branch_id,fecha,nombre,valor,creado_por,actualizado_por
    ) VALUES(v_id,p_branch_id,p_fecha,btrim(p_nombre),p_valor,auth.uid(),auth.uid())
    ON CONFLICT(branch_id,fecha) WHERE branch_id IS NOT NULL DO UPDATE SET
      nombre=EXCLUDED.nombre,valor=EXCLUDED.valor,
      actualizado_por=auth.uid(),actualizado_en=now()
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_precio_fecha_especial_personal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_branch_id uuid; v_exists boolean;
BEGIN
  SELECT branch_id,true INTO v_branch_id,v_exists
  FROM public.precios_fecha_especial_personal WHERE id=p_id;
  IF NOT COALESCE(v_exists,false) OR (
    v_branch_id IS NULL AND NOT public.is_global_admin(auth.uid())
  ) OR (
    v_branch_id IS NOT NULL AND NOT public.can_manage_branch_admin(auth.uid(),v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Sin permiso para eliminar este precio';
  END IF;
  DELETE FROM public.precios_fecha_especial_personal WHERE id=p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.guardar_precios_dia_personal(uuid,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_precio_fecha_especial_personal(uuid,uuid,date,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_precio_fecha_especial_personal(uuid) TO authenticated;
