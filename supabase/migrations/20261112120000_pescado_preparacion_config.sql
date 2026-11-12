-- Configuración de Pescado cocido:
-- - cantidad de bandejas (ya existía) + usuario único con acceso a Preparación
-- - Preparación solo para administradores o ese usuario

ALTER TABLE public.pescado_stock_central
  ADD COLUMN IF NOT EXISTS preparacion_usuario_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pescado_stock_central_prep_usuario
  ON public.pescado_stock_central (preparacion_usuario_id)
  WHERE preparacion_usuario_id IS NOT NULL;

COMMENT ON COLUMN public.pescado_stock_central.preparacion_usuario_id IS
  'Usuario operativo único autorizado a usar el módulo Preparación (además de administradores).';

CREATE OR REPLACE FUNCTION public.can_manage_pescado_cocido_config(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.modules m ON m.id = rp.module_id
      WHERE ugr.user_id = p_user_id
        AND ugr.is_active = true
        AND r.is_active = true
        AND m.is_active = true
        AND m.code = 'admin_global'
        AND rp.access_level = 'MANAGE'::public.access_level
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      JOIN public.roles r ON r.id = ubr.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.modules m ON m.id = rp.module_id
      WHERE ubr.user_id = p_user_id
        AND ubr.is_active = true
        AND r.is_active = true
        AND m.is_active = true
        AND m.code = 'admin_sucursal'
        AND rp.access_level = 'MANAGE'::public.access_level
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_preparacion_pescado(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.can_manage_pescado_cocido_config(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.pescado_stock_central c
      WHERE c.codigo = 'PESCADO'
        AND c.preparacion_usuario_id IS NOT NULL
        AND c.preparacion_usuario_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.puede_acceder_preparacion_pescado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(public.can_access_preparacion_pescado(auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.obtener_config_preparacion_pescado()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT (
    public.can_manage_pescado_cocido_config(v_actor)
    OR public.can_access_preparacion_pescado(v_actor)
    OR public.can_operate_gestion_pescado(v_actor)
  ) THEN
    RAISE EXCEPTION 'No tienes permiso para ver la configuración de preparación';
  END IF;

  SELECT
    c.bandejas_existentes,
    c.preparacion_usuario_id,
    p.full_name,
    p.first_name,
    p.last_name,
    p.username,
    p.alias
  INTO v_row
  FROM public.pescado_stock_central c
  LEFT JOIN public.profiles p ON p.id = c.preparacion_usuario_id
  WHERE c.codigo = 'PESCADO'
  LIMIT 1;

  RETURN jsonb_build_object(
    'bandejas_existentes', COALESCE(v_row.bandejas_existentes, 0),
    'preparacion_usuario_id', v_row.preparacion_usuario_id,
    'preparacion_usuario_nombre', NULLIF(trim(both FROM COALESCE(
      NULLIF(trim(both FROM COALESCE(v_row.full_name, '')), ''),
      NULLIF(trim(both FROM concat_ws(' ', v_row.first_name, v_row.last_name)), ''),
      NULLIF(trim(both FROM COALESCE(v_row.alias, '')), ''),
      NULLIF(trim(both FROM COALESCE(v_row.username, '')), ''),
      ''
    )), ''),
    'puede_editar', public.can_manage_pescado_cocido_config(v_actor)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_config_preparacion_pescado(
  p_bandejas_existentes integer,
  p_preparacion_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_qty integer := COALESCE(p_bandejas_existentes, 0);
  v_stock uuid;
  v_user uuid := p_preparacion_usuario_id;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF NOT public.can_manage_pescado_cocido_config(v_actor) THEN
    RAISE EXCEPTION 'Solo administradores pueden editar la configuración de preparación';
  END IF;
  IF v_qty < 0 THEN
    RAISE EXCEPTION 'La cantidad de bandejas no puede ser negativa';
  END IF;

  IF v_user IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = v_user AND COALESCE(p.is_active, true) = true
    ) THEN
      RAISE EXCEPTION 'El usuario seleccionado no existe o está inactivo';
    END IF;
  END IF;

  v_stock := public.pescado_asegurar_stock_central();

  UPDATE public.pescado_stock_central
  SET bandejas_existentes = v_qty,
      preparacion_usuario_id = v_user,
      updated_at = now()
  WHERE id = v_stock;

  RETURN public.obtener_config_preparacion_pescado();
END;
$function$;

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
  IF NOT (
    public.can_operate_gestion_pescado(v_actor)
    OR public.can_access_preparacion_pescado(v_actor)
  ) THEN
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
  IF NOT public.can_manage_pescado_cocido_config(v_actor) THEN
    RAISE EXCEPTION 'Solo administradores pueden configurar bandejas';
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

-- Endurecer RPCs de preparación: solo admin o usuario configurado.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.registrar_ingreso_pescado(text, numeric, numeric, text, integer, numeric, numeric, numeric[])'::regprocedure
  ) INTO def;
  def := replace(
    def,
    'IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION ''No tienes permiso para registrar ingresos de pescado'';',
    'IF NOT public.can_access_preparacion_pescado(v_actor) THEN
    RAISE EXCEPTION ''No tienes permiso para registrar preparación de pescado'';'
  );
  EXECUTE def;

  SELECT pg_get_functiondef(
    'public.actualizar_ingreso_pescado(uuid, text, numeric, numeric, text, integer, numeric, numeric, numeric[])'::regprocedure
  ) INTO def;
  def := replace(
    def,
    'IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION ''No tienes permiso para actualizar ingresos de pescado'';',
    'IF NOT public.can_access_preparacion_pescado(v_actor) THEN
    RAISE EXCEPTION ''No tienes permiso para actualizar preparación de pescado'';'
  );
  EXECUTE def;
END $$;

REVOKE ALL ON FUNCTION public.can_manage_pescado_cocido_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_pescado_cocido_config(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_access_preparacion_pescado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_preparacion_pescado(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.puede_acceder_preparacion_pescado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.puede_acceder_preparacion_pescado() TO authenticated;
REVOKE ALL ON FUNCTION public.obtener_config_preparacion_pescado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_config_preparacion_pescado() TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_config_preparacion_pescado(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_config_preparacion_pescado(integer, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
