-- Permite gestionar campañas a admin global o admin de sucursal con MANAGE.

CREATE OR REPLACE FUNCTION public.puede_gestionar_campanas_promocionales(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(COALESCE(p_user_id, auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      INNER JOIN public.roles r ON r.id = ubr.role_id AND r.is_active = true
      INNER JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.access_level = 'MANAGE'
      INNER JOIN public.modules m ON m.id = rp.module_id AND m.code IN ('admin_sucursal', 'admin_global')
      WHERE ubr.user_id = COALESCE(p_user_id, auth.uid())
        AND ubr.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      INNER JOIN public.roles r ON r.id = ugr.role_id AND r.is_active = true
      INNER JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.access_level = 'MANAGE'
      INNER JOIN public.modules m ON m.id = rp.module_id AND m.code IN ('admin_sucursal', 'admin_global')
      WHERE ugr.user_id = COALESCE(p_user_id, auth.uid())
        AND ugr.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.puede_gestionar_campanas_promocionales(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.puede_gestionar_campanas_promocionales(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cerrar_ofertas_campana(
  p_campana_id uuid,
  p_ofertas_ganadoras jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campana public.campanas_promocionales%ROWTYPE;
  v_ganadoras text[];
  v_dias integer;
  v_actualizadas_ganadas integer := 0;
  v_actualizadas_perdidas integer := 0;
BEGIN
  IF NOT public.puede_gestionar_campanas_promocionales(auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar ofertas de campaña';
  END IF;

  IF p_campana_id IS NULL THEN
    RAISE EXCEPTION 'Campaña inválida';
  END IF;

  IF jsonb_typeof(p_ofertas_ganadoras) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las ofertas ganadoras deben ser un arreglo JSON';
  END IF;

  SELECT * INTO v_campana
  FROM public.campanas_promocionales
  WHERE id = p_campana_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaña no encontrada';
  END IF;

  SELECT COALESCE(array_agg(trim(both '"' from value::text)), ARRAY[]::text[])
  INTO v_ganadoras
  FROM jsonb_array_elements_text(p_ofertas_ganadoras) AS value;

  v_dias := v_campana.dias_vigencia_descuento;

  UPDATE public.campanas_promocionales
  SET ofertas_cumplidas = COALESCE(to_jsonb(v_ganadoras), '[]'::jsonb)
  WHERE id = p_campana_id;

  UPDATE public.predicciones_clientes pc
  SET
    estado_prediccion = 'GANADA',
    codigo_cupon = public.generar_codigo_cupon_promocion(),
    fecha_caducidad_cupon = now() + make_interval(days => v_dias)
  WHERE pc.campana_id = p_campana_id
    AND pc.estado_prediccion = 'PENDIENTE'
    AND pc.oferta_seleccionada_id = ANY (v_ganadoras);

  GET DIAGNOSTICS v_actualizadas_ganadas = ROW_COUNT;

  UPDATE public.predicciones_clientes pc
  SET estado_prediccion = 'PERDIDA'
  WHERE pc.campana_id = p_campana_id
    AND pc.estado_prediccion = 'PENDIENTE'
    AND NOT (pc.oferta_seleccionada_id = ANY (v_ganadoras));

  GET DIAGNOSTICS v_actualizadas_perdidas = ROW_COUNT;

  RETURN jsonb_build_object(
    'campana_id', p_campana_id,
    'ofertas_ganadoras', to_jsonb(v_ganadoras),
    'ganadas', v_actualizadas_ganadas,
    'perdidas', v_actualizadas_perdidas
  );
END;
$$;

DROP POLICY IF EXISTS campanas_insert_admin ON public.campanas_promocionales;
CREATE POLICY campanas_insert_admin
  ON public.campanas_promocionales
  FOR INSERT
  TO authenticated
  WITH CHECK (public.puede_gestionar_campanas_promocionales(auth.uid()));

DROP POLICY IF EXISTS campanas_update_admin ON public.campanas_promocionales;
CREATE POLICY campanas_update_admin
  ON public.campanas_promocionales
  FOR UPDATE
  TO authenticated
  USING (public.puede_gestionar_campanas_promocionales(auth.uid()))
  WITH CHECK (public.puede_gestionar_campanas_promocionales(auth.uid()));

DROP POLICY IF EXISTS campanas_delete_admin ON public.campanas_promocionales;
CREATE POLICY campanas_delete_admin
  ON public.campanas_promocionales
  FOR DELETE
  TO authenticated
  USING (public.puede_gestionar_campanas_promocionales(auth.uid()));

DROP POLICY IF EXISTS predicciones_update_admin ON public.predicciones_clientes;
CREATE POLICY predicciones_update_admin
  ON public.predicciones_clientes
  FOR UPDATE
  TO authenticated
  USING (public.puede_gestionar_campanas_promocionales(auth.uid()))
  WITH CHECK (public.puede_gestionar_campanas_promocionales(auth.uid()));

DROP POLICY IF EXISTS permisos_promociones_admin ON public.permisos_promociones_turnos;
CREATE POLICY permisos_promociones_admin
  ON public.permisos_promociones_turnos
  FOR ALL
  TO authenticated
  USING (public.puede_gestionar_campanas_promocionales(auth.uid()))
  WITH CHECK (public.puede_gestionar_campanas_promocionales(auth.uid()));

NOTIFY pgrst, 'reload schema';
