-- =============================================================================
-- Gestión Pescado: stock propio (central + sucursal) en libras, doble pesaje,
-- envíos y devoluciones. No se mezcla con nevera / bodega sucursal de productos.
-- =============================================================================

INSERT INTO public.modules (code, name, description, is_active)
VALUES (
  'gestion_pescado',
  'Gestión Pescado',
  'Control de pescado cocinado en libras: entrega, recepción, envíos y devoluciones',
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

-- Bodeguero general opera también gestión pescado.
INSERT INTO public.role_permissions (role_id, module_id, access_level)
SELECT r.id, m.id, 'OPERATE'::public.access_level
FROM public.roles r
CROSS JOIN public.modules m
WHERE r.code = 'bodeguero_general'
  AND m.code = 'gestion_pescado'
ON CONFLICT (role_id, module_id) DO UPDATE SET
  access_level = EXCLUDED.access_level,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.can_operate_gestion_pescado(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_admin(p_user_id)
    OR public.can_operate_bodega_general(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      JOIN public.roles r ON r.id = ugr.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.modules m ON m.id = rp.module_id
      WHERE ugr.user_id = p_user_id
        AND ugr.is_active = true
        AND r.is_active = true
        AND m.code = 'gestion_pescado'
        AND m.is_active = true
        AND rp.access_level IN (
          'OPERATE'::public.access_level,
          'MANAGE'::public.access_level
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_devolver_pescado_sucursal(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_operate_gestion_pescado(p_user_id)
    OR public.can_manage_branch_admin(p_user_id, p_branch_id)
    OR public.user_is_branch_supervisor_for_shift_gate(p_user_id, p_branch_id)
    OR public.has_active_supervisor_delegation(p_user_id, p_branch_id);
$$;

REVOKE ALL ON FUNCTION public.can_operate_gestion_pescado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_operate_gestion_pescado(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_devolver_pescado_sucursal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_devolver_pescado_sucursal(uuid, uuid) TO authenticated;

-- ---- Tablas ----

CREATE TABLE IF NOT EXISTS public.pescado_stock_central (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL DEFAULT 'PESCADO',
  nombre text NOT NULL DEFAULT 'Pescado',
  cantidad_libras numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT pescado_stock_central_cantidad_chk CHECK (cantidad_libras >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_stock_central_codigo_uniq UNIQUE (codigo)
);

COMMENT ON TABLE public.pescado_stock_central IS
  'Stock de pescado cocinado en bodega central (libras). Separado del inventario de productos.';

CREATE TABLE IF NOT EXISTS public.pescado_stock_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cantidad_libras numeric(14, 3) NOT NULL DEFAULT 0
    CONSTRAINT pescado_stock_sucursal_cantidad_chk CHECK (cantidad_libras >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_stock_sucursal_sucursal_uniq UNIQUE (sucursal_id)
);

COMMENT ON TABLE public.pescado_stock_sucursal IS
  'Stock de pescado cocinado por sucursal (libras). No se mezcla con nevera/bodega sucursal.';

CREATE TABLE IF NOT EXISTS public.pescado_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peso_entrega_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_entregas_peso_chk CHECK (peso_entrega_lb > 0),
  entregado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entregado_por_nombre text,
  notas text,
  estado text NOT NULL DEFAULT 'PENDIENTE_RECEPCION'
    CONSTRAINT pescado_entregas_estado_chk CHECK (estado IN ('PENDIENTE_RECEPCION', 'RECIBIDO')),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pescado_entregas_estado_creado
  ON public.pescado_entregas (estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS public.pescado_recepciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrega_id uuid NOT NULL REFERENCES public.pescado_entregas(id) ON DELETE RESTRICT,
  peso_recepcion_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_recepciones_peso_chk CHECK (peso_recepcion_lb > 0),
  merma_lb numeric(14, 3) NOT NULL DEFAULT 0,
  recibido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recibido_por_nombre text,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pescado_recepciones_entrega_uniq UNIQUE (entrega_id)
);

CREATE TABLE IF NOT EXISTS public.pescado_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_destino_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cantidad_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_envios_cantidad_chk CHECK (cantidad_lb > 0),
  enviado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  enviado_por_nombre text,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pescado_envios_sucursal_creado
  ON public.pescado_envios (sucursal_destino_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS public.pescado_devoluciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL,
  cantidad_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_devoluciones_cantidad_chk CHECK (cantidad_lb > 0),
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pescado_devoluciones_sucursal_creado
  ON public.pescado_devoluciones (sucursal_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS public.pescado_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_movimiento text NOT NULL
    CONSTRAINT pescado_movimientos_tipo_chk CHECK (tipo_movimiento IN (
      'INGRESO_RECEPCION',
      'MERMA',
      'ENVIO',
      'DEVOLUCION',
      'AJUSTE'
    )),
  ambito text NOT NULL
    CONSTRAINT pescado_movimientos_ambito_chk CHECK (ambito IN ('CENTRAL', 'SUCURSAL')),
  sucursal_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cantidad_lb numeric(14, 3) NOT NULL
    CONSTRAINT pescado_movimientos_cantidad_chk CHECK (cantidad_lb >= 0),
  cantidad_anterior numeric(14, 3) NOT NULL,
  cantidad_nueva numeric(14, 3) NOT NULL,
  referencia_tipo text,
  referencia_id uuid,
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pescado_movimientos_creado
  ON public.pescado_movimientos (creado_en DESC);

-- Seed stock central
INSERT INTO public.pescado_stock_central (codigo, nombre, cantidad_libras)
VALUES ('PESCADO', 'Pescado', 0)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.pescado_stock_central ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_stock_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_recepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pescado_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pescado_stock_central_select ON public.pescado_stock_central;
CREATE POLICY pescado_stock_central_select ON public.pescado_stock_central
FOR SELECT TO authenticated
USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.user_branch_roles ubr
    JOIN public.roles r ON r.id = ubr.role_id
    WHERE ubr.user_id = auth.uid()
      AND ubr.is_active = true
      AND r.is_active = true
      AND r.code IN ('supervisor', 'administrador_sucursal', 'admin_sucursal')
  )
);

DROP POLICY IF EXISTS pescado_stock_sucursal_select ON public.pescado_stock_sucursal;
CREATE POLICY pescado_stock_sucursal_select ON public.pescado_stock_sucursal
FOR SELECT TO authenticated
USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  OR public.can_devolver_pescado_sucursal(auth.uid(), sucursal_id)
);

DROP POLICY IF EXISTS pescado_entregas_select ON public.pescado_entregas;
CREATE POLICY pescado_entregas_select ON public.pescado_entregas
FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_recepciones_select ON public.pescado_recepciones;
CREATE POLICY pescado_recepciones_select ON public.pescado_recepciones
FOR SELECT TO authenticated
USING (public.can_operate_gestion_pescado(auth.uid()));

DROP POLICY IF EXISTS pescado_envios_select ON public.pescado_envios;
CREATE POLICY pescado_envios_select ON public.pescado_envios
FOR SELECT TO authenticated
USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR public.can_manage_branch_admin(auth.uid(), sucursal_destino_id)
);

DROP POLICY IF EXISTS pescado_devoluciones_select ON public.pescado_devoluciones;
CREATE POLICY pescado_devoluciones_select ON public.pescado_devoluciones
FOR SELECT TO authenticated
USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR public.can_devolver_pescado_sucursal(auth.uid(), sucursal_id)
);

DROP POLICY IF EXISTS pescado_movimientos_select ON public.pescado_movimientos;
CREATE POLICY pescado_movimientos_select ON public.pescado_movimientos
FOR SELECT TO authenticated
USING (
  public.can_operate_gestion_pescado(auth.uid())
  OR (sucursal_id IS NOT NULL AND public.can_devolver_pescado_sucursal(auth.uid(), sucursal_id))
);

-- ---- Helpers internos ----

CREATE OR REPLACE FUNCTION public.pescado_nombre_actor(p_actor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(btrim(p.full_name), ''),
    NULLIF(btrim(p.username), ''),
    'Usuario'
  )
  FROM public.profiles p
  WHERE p.id = p_actor_id;
$$;

CREATE OR REPLACE FUNCTION public.pescado_asegurar_stock_central()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.pescado_stock_central
  WHERE codigo = 'PESCADO'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.pescado_stock_central (codigo, nombre, cantidad_libras)
    VALUES ('PESCADO', 'Pescado', 0)
    RETURNING id INTO v_id;

    SELECT id INTO v_id
    FROM public.pescado_stock_central
    WHERE id = v_id
    FOR UPDATE;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pescado_asegurar_stock_sucursal(p_sucursal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal obligatoria';
  END IF;

  SELECT id INTO v_id
  FROM public.pescado_stock_sucursal
  WHERE sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.pescado_stock_sucursal (sucursal_id, cantidad_libras)
    VALUES (p_sucursal_id, 0)
    RETURNING id INTO v_id;

    SELECT id INTO v_id
    FROM public.pescado_stock_sucursal
    WHERE id = v_id
    FOR UPDATE;
  END IF;

  RETURN v_id;
END;
$$;

-- ---- RPCs ----

CREATE OR REPLACE FUNCTION public.registrar_entrega_pescado(
  p_peso_entrega_lb numeric,
  p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_peso numeric(14, 3);
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar entregas de pescado';
  END IF;

  v_peso := round(COALESCE(p_peso_entrega_lb, 0)::numeric, 3);
  IF v_peso <= 0 THEN
    RAISE EXCEPTION 'El peso de entrega debe ser mayor a 0';
  END IF;

  INSERT INTO public.pescado_entregas (
    peso_entrega_lb, entregado_por, entregado_por_nombre, notas, estado
  )
  VALUES (
    v_peso,
    v_actor,
    public.pescado_nombre_actor(v_actor),
    NULLIF(btrim(p_notas), ''),
    'PENDIENTE_RECEPCION'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_recepcion_pescado(
  p_entrega_id uuid,
  p_peso_recepcion_lb numeric,
  p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_peso numeric(14, 3);
  v_entrega public.pescado_entregas%ROWTYPE;
  v_merma numeric(14, 3);
  v_stock_id uuid;
  v_anterior numeric(14, 3);
  v_nueva numeric(14, 3);
  v_recepcion_id uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar recepción de pescado';
  END IF;
  IF p_entrega_id IS NULL THEN
    RAISE EXCEPTION 'Entrega obligatoria';
  END IF;

  v_peso := round(COALESCE(p_peso_recepcion_lb, 0)::numeric, 3);
  IF v_peso <= 0 THEN
    RAISE EXCEPTION 'El peso de recepción debe ser mayor a 0';
  END IF;

  SELECT * INTO v_entrega
  FROM public.pescado_entregas
  WHERE id = p_entrega_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega no encontrada';
  END IF;
  IF v_entrega.estado <> 'PENDIENTE_RECEPCION' THEN
    RAISE EXCEPTION 'Esta entrega ya fue recibida';
  END IF;

  v_merma := round((v_entrega.peso_entrega_lb - v_peso)::numeric, 3);
  v_nombre := public.pescado_nombre_actor(v_actor);

  INSERT INTO public.pescado_recepciones (
    entrega_id, peso_recepcion_lb, merma_lb, recibido_por, recibido_por_nombre, notas
  )
  VALUES (
    p_entrega_id, v_peso, v_merma, v_actor, v_nombre, NULLIF(btrim(p_notas), '')
  )
  RETURNING id INTO v_recepcion_id;

  UPDATE public.pescado_entregas
  SET estado = 'RECIBIDO'
  WHERE id = p_entrega_id;

  v_stock_id := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_anterior
  FROM public.pescado_stock_central WHERE id = v_stock_id;
  v_anterior := COALESCE(v_anterior, 0);
  v_nueva := v_anterior + v_peso;

  UPDATE public.pescado_stock_central
  SET cantidad_libras = v_nueva, updated_at = now()
  WHERE id = v_stock_id;

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  ) VALUES (
    'INGRESO_RECEPCION', 'CENTRAL', v_peso, v_anterior, v_nueva,
    'recepcion', v_recepcion_id, v_actor, v_nombre,
    format('Recepción de entrega %s (entrega %s lb → recepción %s lb)',
      left(p_entrega_id::text, 8),
      trim(to_char(v_entrega.peso_entrega_lb, 'FM999999990.999')),
      trim(to_char(v_peso, 'FM999999990.999')))
  );

  IF v_merma <> 0 THEN
    INSERT INTO public.pescado_movimientos (
      tipo_movimiento, ambito, cantidad_lb, cantidad_anterior, cantidad_nueva,
      referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
    ) VALUES (
      'MERMA', 'CENTRAL', abs(v_merma), v_anterior, v_nueva,
      'recepcion', v_recepcion_id, v_actor, v_nombre,
      format('Diferencia entrega−recepción: %s lb',
        trim(to_char(v_merma, 'FM999999990.999')))
    );
  END IF;

  RETURN v_recepcion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_pescado_sucursal(
  p_sucursal_destino_id uuid,
  p_cantidad_lb numeric,
  p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_qty numeric(14, 3);
  v_stock_central uuid;
  v_stock_suc uuid;
  v_ant_c numeric(14, 3);
  v_new_c numeric(14, 3);
  v_ant_s numeric(14, 3);
  v_new_s numeric(14, 3);
  v_envio_id uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF NOT public.can_operate_gestion_pescado(v_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para enviar pescado a sucursales';
  END IF;
  IF p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal destino obligatoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_sucursal_destino_id) THEN
    RAISE EXCEPTION 'Sucursal destino no encontrada';
  END IF;

  v_qty := round(COALESCE(p_cantidad_lb, 0)::numeric, 3);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad a enviar debe ser mayor a 0';
  END IF;

  v_nombre := public.pescado_nombre_actor(v_actor);
  v_stock_central := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_ant_c FROM public.pescado_stock_central WHERE id = v_stock_central;
  v_ant_c := COALESCE(v_ant_c, 0);
  IF v_ant_c < v_qty THEN
    RAISE EXCEPTION 'Stock central insuficiente. Disponible: % lb, solicitado: % lb',
      trim(to_char(v_ant_c, 'FM999999990.999')),
      trim(to_char(v_qty, 'FM999999990.999'));
  END IF;
  v_new_c := v_ant_c - v_qty;

  UPDATE public.pescado_stock_central
  SET cantidad_libras = v_new_c, updated_at = now()
  WHERE id = v_stock_central;

  v_stock_suc := public.pescado_asegurar_stock_sucursal(p_sucursal_destino_id);
  SELECT cantidad_libras INTO v_ant_s FROM public.pescado_stock_sucursal WHERE id = v_stock_suc;
  v_ant_s := COALESCE(v_ant_s, 0);
  v_new_s := v_ant_s + v_qty;

  UPDATE public.pescado_stock_sucursal
  SET cantidad_libras = v_new_s, updated_at = now()
  WHERE id = v_stock_suc;

  INSERT INTO public.pescado_envios (
    sucursal_destino_id, cantidad_lb, enviado_por, enviado_por_nombre, notas
  )
  VALUES (
    p_sucursal_destino_id, v_qty, v_actor, v_nombre, NULLIF(btrim(p_notas), '')
  )
  RETURNING id INTO v_envio_id;

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  ) VALUES (
    'ENVIO', 'CENTRAL', p_sucursal_destino_id, v_qty, v_ant_c, v_new_c,
    'envio', v_envio_id, v_actor, v_nombre, 'Salida central por envío a sucursal'
  );

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  ) VALUES (
    'ENVIO', 'SUCURSAL', p_sucursal_destino_id, v_qty, v_ant_s, v_new_s,
    'envio', v_envio_id, v_actor, v_nombre, 'Ingreso sucursal por envío desde central'
  );

  RETURN v_envio_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.devolver_pescado_a_central(
  p_sucursal_id uuid,
  p_cantidad_lb numeric,
  p_cash_shift_id uuid DEFAULT NULL,
  p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_qty numeric(14, 3);
  v_shift_id uuid;
  v_stock_suc uuid;
  v_stock_central uuid;
  v_ant_s numeric(14, 3);
  v_new_s numeric(14, 3);
  v_ant_c numeric(14, 3);
  v_new_c numeric(14, 3);
  v_dev_id uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal obligatoria';
  END IF;
  IF NOT public.can_devolver_pescado_sucursal(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para devolver pescado de esta sucursal';
  END IF;

  v_qty := round(COALESCE(p_cantidad_lb, 0)::numeric, 3);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad a devolver debe ser mayor a 0';
  END IF;

  IF p_cash_shift_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_shifts cs
      WHERE cs.id = p_cash_shift_id AND cs.branch_id = p_sucursal_id
    ) THEN
      RAISE EXCEPTION 'El turno indicado no pertenece a la sucursal';
    END IF;
    v_shift_id := p_cash_shift_id;
  ELSE
    SELECT cs.id INTO v_shift_id
    FROM public.cash_shifts cs
    WHERE cs.branch_id = p_sucursal_id
      AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC
    LIMIT 1;
  END IF;

  v_nombre := public.pescado_nombre_actor(v_actor);
  v_stock_suc := public.pescado_asegurar_stock_sucursal(p_sucursal_id);
  SELECT cantidad_libras INTO v_ant_s FROM public.pescado_stock_sucursal WHERE id = v_stock_suc;
  v_ant_s := COALESCE(v_ant_s, 0);
  IF v_ant_s < v_qty THEN
    RAISE EXCEPTION 'Stock de sucursal insuficiente. Disponible: % lb, solicitado: % lb',
      trim(to_char(v_ant_s, 'FM999999990.999')),
      trim(to_char(v_qty, 'FM999999990.999'));
  END IF;
  v_new_s := v_ant_s - v_qty;

  UPDATE public.pescado_stock_sucursal
  SET cantidad_libras = v_new_s, updated_at = now()
  WHERE id = v_stock_suc;

  v_stock_central := public.pescado_asegurar_stock_central();
  SELECT cantidad_libras INTO v_ant_c FROM public.pescado_stock_central WHERE id = v_stock_central;
  v_ant_c := COALESCE(v_ant_c, 0);
  v_new_c := v_ant_c + v_qty;

  UPDATE public.pescado_stock_central
  SET cantidad_libras = v_new_c, updated_at = now()
  WHERE id = v_stock_central;

  INSERT INTO public.pescado_devoluciones (
    sucursal_id, cash_shift_id, cantidad_lb, registrado_por, registrado_por_nombre, notas
  )
  VALUES (
    p_sucursal_id, v_shift_id, v_qty, v_actor, v_nombre, NULLIF(btrim(p_notas), '')
  )
  RETURNING id INTO v_dev_id;

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  ) VALUES (
    'DEVOLUCION', 'SUCURSAL', p_sucursal_id, v_qty, v_ant_s, v_new_s,
    'devolucion', v_dev_id, v_actor, v_nombre, 'Salida sucursal por devolución a central'
  );

  INSERT INTO public.pescado_movimientos (
    tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva,
    referencia_tipo, referencia_id, registrado_por, registrado_por_nombre, notas
  ) VALUES (
    'DEVOLUCION', 'CENTRAL', p_sucursal_id, v_qty, v_ant_c, v_new_c,
    'devolucion', v_dev_id, v_actor, v_nombre, 'Ingreso central por devolución de sucursal'
  );

  RETURN v_dev_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_stock_pescado()
RETURNS TABLE (
  ambito text,
  sucursal_id uuid,
  sucursal_nombre text,
  cantidad_libras numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT
      'CENTRAL'::text AS ambito,
      NULL::uuid AS sucursal_id,
      'Bodega pescado (central)'::text AS sucursal_nombre,
      c.cantidad_libras
    FROM public.pescado_stock_central c
    WHERE c.codigo = 'PESCADO'

    UNION ALL

    SELECT
      'SUCURSAL'::text,
      s.sucursal_id,
      b.name,
      s.cantidad_libras
    FROM public.pescado_stock_sucursal s
    JOIN public.branches b ON b.id = s.sucursal_id
  ) q
  ORDER BY q.ambito, q.sucursal_nombre;
$$;

REVOKE ALL ON FUNCTION public.registrar_entrega_pescado(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_pescado(numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_recepcion_pescado(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_recepcion_pescado(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.enviar_pescado_sucursal(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enviar_pescado_sucursal(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.devolver_pescado_a_central(uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.devolver_pescado_a_central(uuid, numeric, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.listar_stock_pescado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_stock_pescado() TO authenticated;

NOTIFY pgrst, 'reload schema';
