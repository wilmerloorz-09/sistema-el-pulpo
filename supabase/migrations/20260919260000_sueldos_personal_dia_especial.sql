-- Columna de sueldo para día especial por persona.

ALTER TABLE public.sueldos_personal
  ADD COLUMN IF NOT EXISTS dia_especial numeric(12,2) NOT NULL DEFAULT 0
  CHECK (dia_especial >= 0);

DROP FUNCTION IF EXISTS public.list_sueldos_personal();
CREATE OR REPLACE FUNCTION public.list_sueldos_personal()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  alias text,
  is_active boolean,
  lunes_viernes numeric,
  sabado numeric,
  domingo numeric,
  dia_especial numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (
    public.is_global_admin(auth.uid())
    OR public.can_manage_sueldos_personal(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE public.can_view_jornadas_personal(auth.uid(), b.id)
    )
  ) THEN
    RAISE EXCEPTION 'Sin permiso para ver sueldos de personal';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.alias,
    p.is_active,
    COALESCE(s.lunes_viernes, 0)::numeric AS lunes_viernes,
    COALESCE(s.sabado, 0)::numeric AS sabado,
    COALESCE(s.domingo, 0)::numeric AS domingo,
    COALESCE(s.dia_especial, 0)::numeric AS dia_especial
  FROM public.profiles p
  LEFT JOIN public.sueldos_personal s
    ON s.user_id = p.id
  WHERE p.is_active = true
    AND COALESCE(p.is_protected_superadmin, false) = false
  ORDER BY
    COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.alias), ''), p.username);
END;
$$;

DROP FUNCTION IF EXISTS public.guardar_sueldo_personal(uuid, numeric, numeric, numeric);
CREATE OR REPLACE FUNCTION public.guardar_sueldo_personal(
  p_user_id uuid,
  p_lunes_viernes numeric,
  p_sabado numeric,
  p_domingo numeric,
  p_dia_especial numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id es obligatorio';
  END IF;

  IF NOT public.can_manage_sueldos_personal(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso para configurar sueldos de personal';
  END IF;

  IF p_lunes_viernes < 0 OR p_sabado < 0 OR p_domingo < 0 OR COALESCE(p_dia_especial, 0) < 0 THEN
    RAISE EXCEPTION 'Los sueldos no pueden ser negativos';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  INSERT INTO public.sueldos_personal(
    user_id, lunes_viernes, sabado, domingo, dia_especial, actualizado_por
  ) VALUES (
    p_user_id, p_lunes_viernes, p_sabado, p_domingo, COALESCE(p_dia_especial, 0), auth.uid()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    lunes_viernes = EXCLUDED.lunes_viernes,
    sabado = EXCLUDED.sabado,
    domingo = EXCLUDED.domingo,
    dia_especial = EXCLUDED.dia_especial,
    actualizado_por = auth.uid(),
    actualizado_en = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_sueldos_personal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_sueldo_personal(uuid, numeric, numeric, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
