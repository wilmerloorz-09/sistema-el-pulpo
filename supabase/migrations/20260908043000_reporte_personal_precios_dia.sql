-- Reporte simple de personal basado en cash_shifts + cash_shift_users.
-- Los únicos datos nuevos son los precios del día por sucursal.

UPDATE public.modules
SET name='Reporte de personal',
    description='Personal agregado a los turnos y valor diario por sucursal',
    updated_at=now()
WHERE code='jornadas_personal';

CREATE TABLE IF NOT EXISTS public.precios_dia_personal (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  lunes_viernes numeric(12,2) NOT NULL DEFAULT 0 CHECK (lunes_viernes>=0),
  sabado numeric(12,2) NOT NULL DEFAULT 0 CHECK (sabado>=0),
  domingo numeric(12,2) NOT NULL DEFAULT 0 CHECK (domingo>=0),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.precios_fecha_especial_personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  nombre text NOT NULL CHECK (btrim(nombre)<>''),
  valor numeric(12,2) NOT NULL CHECK (valor>=0),
  creado_por uuid REFERENCES public.profiles(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.profiles(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(branch_id,fecha)
);

CREATE INDEX IF NOT EXISTS ix_precios_fecha_especial_personal_fecha
  ON public.precios_fecha_especial_personal(branch_id,fecha);

ALTER TABLE public.precios_dia_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_fecha_especial_personal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Personal ve precios diarios autorizados"
ON public.precios_dia_personal FOR SELECT TO authenticated
USING (public.can_view_jornadas_personal(auth.uid(),branch_id));

CREATE POLICY "Personal ve precios especiales autorizados"
ON public.precios_fecha_especial_personal FOR SELECT TO authenticated
USING (public.can_view_jornadas_personal(auth.uid(),branch_id));

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
  IF NOT public.can_manage_branch_admin(auth.uid(),p_branch_id) THEN
    RAISE EXCEPTION 'Sin permiso para configurar esta sucursal';
  END IF;
  IF p_lunes_viernes<0 OR p_sabado<0 OR p_domingo<0 THEN
    RAISE EXCEPTION 'Los precios no pueden ser negativos';
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
  IF NOT public.can_manage_branch_admin(auth.uid(),p_branch_id) THEN
    RAISE EXCEPTION 'Sin permiso para configurar esta sucursal';
  END IF;
  IF p_valor<0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;
  INSERT INTO public.precios_fecha_especial_personal(
    id,branch_id,fecha,nombre,valor,creado_por,actualizado_por
  ) VALUES(
    v_id,p_branch_id,p_fecha,btrim(p_nombre),p_valor,auth.uid(),auth.uid()
  )
  ON CONFLICT(branch_id,fecha) DO UPDATE SET
    nombre=EXCLUDED.nombre,
    valor=EXCLUDED.valor,
    actualizado_por=auth.uid(),
    actualizado_en=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_precio_fecha_especial_personal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_branch_id uuid;
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.precios_fecha_especial_personal WHERE id=p_id;
  IF v_branch_id IS NULL OR NOT public.can_manage_branch_admin(auth.uid(),v_branch_id) THEN
    RAISE EXCEPTION 'Sin permiso para eliminar este precio';
  END IF;
  DELETE FROM public.precios_fecha_especial_personal WHERE id=p_id;
END;
$$;

GRANT SELECT ON public.precios_dia_personal,public.precios_fecha_especial_personal TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.precios_dia_personal,public.precios_fecha_especial_personal FROM authenticated;
REVOKE ALL ON FUNCTION public.guardar_precios_dia_personal(uuid,numeric,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_precio_fecha_especial_personal(uuid,uuid,date,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_precio_fecha_especial_personal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_precios_dia_personal(uuid,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_precio_fecha_especial_personal(uuid,uuid,date,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_precio_fecha_especial_personal(uuid) TO authenticated;
