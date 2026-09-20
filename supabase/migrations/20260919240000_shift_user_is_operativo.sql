-- Rol "Operativo" en turno: solo control de personal (sin acceso al sistema).

ALTER TABLE public.cash_shift_users
  ADD COLUMN IF NOT EXISTS is_operativo boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.shift_user_input'::regtype
      AND attname = 'is_operativo'
      AND NOT attisdropped
  ) THEN
    ALTER TYPE public.shift_user_input ADD ATTRIBUTE is_operativo boolean;
  END IF;
END;
$$;

COMMENT ON COLUMN public.cash_shift_users.is_operativo IS
  'Personal del turno solo para control/jornada. Sin otros roles de sistema no puede ingresar.';

-- Normalización: Operativo solo mantiene is_enabled, pero no otorga acceso de sistema.
CREATE OR REPLACE FUNCTION public.normalize_cash_shift_user_capabilities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_system_capability boolean;
  v_has_presence boolean;
BEGIN
  NEW.can_serve_tables := COALESCE(NEW.can_serve_tables, false);
  NEW.can_access_orders := COALESCE(NEW.can_access_orders, false);
  NEW.can_edit_orders := COALESCE(NEW.can_edit_orders, false);
  NEW.can_dispatch_orders := COALESCE(NEW.can_dispatch_orders, false);
  NEW.can_manage_products := COALESCE(NEW.can_manage_products, false);
  NEW.can_use_caja := COALESCE(NEW.can_use_caja, false);
  NEW.can_authorize_order_cancel := COALESCE(NEW.can_authorize_order_cancel, false);
  NEW.can_double_session := COALESCE(NEW.can_double_session, false);
  NEW.is_supervisor := COALESCE(NEW.is_supervisor, false);
  NEW.can_pack_orders := COALESCE(NEW.can_pack_orders, false);
  NEW.can_serve_plates := COALESCE(NEW.can_serve_plates, false);
  NEW.is_operativo := COALESCE(NEW.is_operativo, false);

  IF NEW.can_serve_tables THEN
    NEW.can_access_orders := true;
  END IF;

  IF NEW.can_dispatch_orders THEN
    NEW.can_manage_products := true;
  END IF;

  v_has_system_capability :=
    NEW.can_serve_tables OR
    NEW.can_access_orders OR
    NEW.can_edit_orders OR
    NEW.can_dispatch_orders OR
    NEW.can_manage_products OR
    NEW.can_use_caja OR
    NEW.can_authorize_order_cancel OR
    NEW.is_supervisor OR
    NEW.can_pack_orders OR
    NEW.can_serve_plates;

  v_has_presence := v_has_system_capability OR NEW.is_operativo;

  -- Sin acceso de sistema, sesión doble no aplica.
  IF NEW.is_operativo AND NOT v_has_system_capability THEN
    NEW.can_double_session := false;
    NEW.last_session_id := NULL;
    NEW.secondary_session_id := NULL;
  END IF;

  IF COALESCE(NEW.is_enabled, false) AND NOT v_has_presence THEN
    NEW.is_enabled := false;
    NEW.can_double_session := false;
    NEW.last_session_id := NULL;
    NEW.secondary_session_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.cash_shift_users DROP CONSTRAINT IF EXISTS chk_csu_operational_if_enabled;
ALTER TABLE public.cash_shift_users DROP CONSTRAINT IF EXISTS cash_shift_users_has_capability_chk;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  is_enabled = false OR
  can_serve_tables = true OR
  can_access_orders = true OR
  can_edit_orders = true OR
  can_dispatch_orders = true OR
  can_manage_products = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true OR
  can_pack_orders = true OR
  can_serve_plates = true OR
  is_operativo = true
);

-- Listado Admin > Turno incluye is_operativo.
DROP FUNCTION IF EXISTS public.list_shift_users_for_branch(uuid);
CREATE OR REPLACE FUNCTION public.list_shift_users_for_branch(p_branch_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  alias text,
  is_profile_active boolean,
  is_enabled boolean,
  can_serve_tables boolean,
  can_access_orders boolean,
  can_edit_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  can_double_session boolean,
  is_supervisor boolean,
  can_pack_orders boolean,
  secondary_caja_takeout_enabled boolean,
  secondary_caja_express_enabled boolean,
  secondary_caja_template_id uuid,
  can_serve_plates boolean,
  is_operativo boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_allow_concurrent boolean := public.allows_concurrent_open_shift(p_branch_id);
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_shift_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para administrar el turno de esta sucursal';
  END IF;

  SELECT cs.id
  INTO v_shift_id
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH branch_members AS (
    SELECT ub.user_id
    FROM public.user_branches ub
    WHERE ub.branch_id = p_branch_id

    UNION

    SELECT ugr.user_id
    FROM public.user_global_roles ugr
    JOIN public.roles r
      ON r.id = ugr.role_id
    WHERE ugr.is_active = true
      AND r.is_active = true
      AND r.scope = 'GLOBAL'::public.role_scope
      AND r.code = 'administrador'

    UNION

    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.is_active = true
      AND NOT public.is_global_admin(p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_branch_roles ubr
        JOIN public.roles r
          ON r.id = ubr.role_id
        WHERE ubr.user_id = p.id
          AND ubr.is_active = true
          AND r.is_active = true
          AND r.code = 'supervisor'
      )

    UNION

    SELECT csu.user_id
    FROM public.cash_shift_users csu
    JOIN public.cash_shifts cs
      ON cs.id = csu.shift_id
    JOIN public.profiles p
      ON p.id = csu.user_id
    WHERE v_allow_concurrent
      AND csu.is_enabled = true
      AND cs.status = 'OPEN'
      AND cs.branch_id IS DISTINCT FROM p_branch_id
      AND p.is_active = true
  )
  SELECT
    p.id AS user_id,
    p.full_name,
    p.username,
    p.alias,
    p.is_active AS is_profile_active,
    COALESCE(csu.is_enabled, false) AS is_enabled,
    COALESCE(csu.can_serve_tables, false) AS can_serve_tables,
    COALESCE(csu.can_access_orders, COALESCE(csu.can_serve_tables, false), false) AS can_access_orders,
    COALESCE(csu.can_edit_orders, false) AS can_edit_orders,
    COALESCE(csu.can_dispatch_orders, false) AS can_dispatch_orders,
    COALESCE(csu.can_manage_products, COALESCE(csu.can_dispatch_orders, false), false) AS can_manage_products,
    COALESCE(csu.can_use_caja, false) AS can_use_caja,
    COALESCE(csu.can_authorize_order_cancel, false) AS can_authorize_order_cancel,
    COALESCE(csu.can_double_session, false) AS can_double_session,
    COALESCE(csu.is_supervisor, false) AS is_supervisor,
    COALESCE(csu.can_pack_orders, false) AS can_pack_orders,
    COALESCE(csu.secondary_caja_takeout_enabled, false) AS secondary_caja_takeout_enabled,
    COALESCE(csu.secondary_caja_express_enabled, false) AS secondary_caja_express_enabled,
    csu.secondary_caja_template_id,
    COALESCE(csu.can_serve_plates, false) AS can_serve_plates,
    COALESCE(csu.is_operativo, false) AS is_operativo
  FROM branch_members bm
  JOIN public.profiles p
    ON p.id = bm.user_id
  LEFT JOIN public.cash_shift_users csu
    ON csu.shift_id = v_shift_id
   AND csu.user_id = bm.user_id
  ORDER BY p.full_name, p.alias;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_shift_users_for_branch(uuid) TO authenticated;

-- True si en la sucursal el usuario solo esta como Operativo (sin roles de sistema).
CREATE OR REPLACE FUNCTION public.user_is_shift_personnel_only(p_branch_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid := p_branch_id;
  v_row public.cash_shift_users%ROWTYPE;
  v_has_system boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_global_admin(auth.uid()) THEN
    RETURN false;
  END IF;

  IF v_branch_id IS NULL THEN
    SELECT p.active_branch_id INTO v_branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
  END IF;

  IF v_branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RETURN false;
  END IF;

  SELECT csu.*
  INTO v_row
  FROM public.cash_shift_users csu
  JOIN public.cash_shifts cs
    ON cs.id = csu.shift_id
  WHERE csu.user_id = auth.uid()
    AND csu.is_enabled = true
    AND cs.status = 'OPEN'
    AND cs.branch_id = v_branch_id
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_has_system :=
    COALESCE(v_row.can_serve_tables, false)
    OR COALESCE(v_row.can_access_orders, false)
    OR COALESCE(v_row.can_edit_orders, false)
    OR COALESCE(v_row.can_dispatch_orders, false)
    OR COALESCE(v_row.can_manage_products, false)
    OR COALESCE(v_row.can_use_caja, false)
    OR COALESCE(v_row.can_authorize_order_cancel, false)
    OR COALESCE(v_row.is_supervisor, false)
    OR COALESCE(v_row.can_pack_orders, false)
    OR COALESCE(v_row.can_serve_plates, false)
    OR COALESCE(v_row.can_exchange_cash, false);

  RETURN COALESCE(v_row.is_operativo, false) AND NOT v_has_system;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_shift_personnel_only(uuid) TO authenticated;

-- Jornadas: incluir OPERATIVO como rol laboral de control.
ALTER TABLE public.funciones_laborales DROP CONSTRAINT IF EXISTS funciones_laborales_shift_role_ck;
ALTER TABLE public.funciones_laborales
  ADD CONSTRAINT funciones_laborales_shift_role_ck CHECK (
    shift_role_key IS NULL OR shift_role_key IN (
      'VENTA','DESPACHO','SERVIR','EMPAQUE','CAJA','SUPERVISOR','OPERATIVO'
    )
  );

INSERT INTO public.funciones_laborales (codigo, nombre, orden, shift_role_key, activo)
SELECT 'OPERATIVO', 'Operativo', 65, 'OPERATIVO', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.funciones_laborales WHERE upper(codigo) = 'OPERATIVO'
);

UPDATE public.funciones_laborales
SET
  nombre = 'Operativo',
  orden = 65,
  shift_role_key = 'OPERATIVO',
  activo = true
WHERE upper(codigo) = 'OPERATIVO';

CREATE OR REPLACE FUNCTION public.roles_laborales_turno(p_row public.cash_shift_users)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN COALESCE(p_row.can_serve_tables,false) THEN 'VENTA' END,
    CASE WHEN COALESCE(p_row.can_dispatch_orders,false) THEN 'DESPACHO' END,
    CASE WHEN COALESCE(p_row.can_serve_plates,false) THEN 'SERVIR' END,
    CASE WHEN COALESCE(p_row.can_pack_orders,false) THEN 'EMPAQUE' END,
    CASE WHEN COALESCE(p_row.can_use_caja,false) THEN 'CAJA' END,
    CASE WHEN COALESCE(p_row.is_supervisor,false) THEN 'SUPERVISOR' END,
    CASE WHEN COALESCE(p_row.is_operativo,false) THEN 'OPERATIVO' END
  ],NULL);
$$;

DROP TRIGGER IF EXISTS trg_cash_shift_users_jornada_insert_update ON public.cash_shift_users;
CREATE TRIGGER trg_cash_shift_users_jornada_insert_update
AFTER INSERT OR UPDATE OF is_enabled,can_serve_tables,can_dispatch_orders,can_serve_plates,can_pack_orders,can_use_caja,is_supervisor,is_operativo
ON public.cash_shift_users FOR EACH ROW
EXECUTE FUNCTION public.trg_sincronizar_jornada_usuario_turno();

NOTIFY pgrst, 'reload schema';
