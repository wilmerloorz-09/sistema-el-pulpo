-- =============================================================================
-- Autopedidos QR en mesa
-- ---------------------------------------------------------------------------
-- Permite que un comensal escanee un QR físico de mesa, vea el menú TABLE y
-- envíe un borrador pendiente de aprobación del personal del turno.
--
-- Seguridad:
-- - Lectura anónima acotada de tokens activos y catálogo TABLE vía RLS + helpers.
-- - Escritura de órdenes/ítems anónima SOLO a través de RPCs SECURITY DEFINER
--   que validan token_seguro + turno OPEN (mismo patrón que promociones públicas).
-- - Políticas INSERT TO anon documentan el contrato; el camino operativo real
--   es crear_orden_autopedido_qr (evita inserts directos sin validación fuerte).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla de tokens QR por mesa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tokens_qr_mesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  token_seguro text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tokens_qr_mesas_token_seguro_chk CHECK (char_length(token_seguro) >= 24),
  CONSTRAINT tokens_qr_mesas_sucursal_mesa_unica UNIQUE (sucursal_id, mesa_id),
  CONSTRAINT tokens_qr_mesas_token_unico UNIQUE (token_seguro)
);

COMMENT ON TABLE public.tokens_qr_mesas IS
  'Tokens públicos por mesa física para autopedido QR. La URL es /qr-pedido/:token_seguro.';

CREATE INDEX IF NOT EXISTS idx_tokens_qr_mesas_sucursal_activo
  ON public.tokens_qr_mesas (sucursal_id, activo)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_tokens_qr_mesas_mesa
  ON public.tokens_qr_mesas (mesa_id);

CREATE OR REPLACE FUNCTION public.tokens_qr_mesas_actualizar_marca_tiempo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tokens_qr_mesas_actualizar_marca_tiempo ON public.tokens_qr_mesas;
CREATE TRIGGER trg_tokens_qr_mesas_actualizar_marca_tiempo
  BEFORE UPDATE ON public.tokens_qr_mesas
  FOR EACH ROW
  EXECUTE FUNCTION public.tokens_qr_mesas_actualizar_marca_tiempo();

-- -----------------------------------------------------------------------------
-- 2. Columnas en orders
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS es_autopedido_qr boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS estado_aprobacion_qr text NOT NULL DEFAULT 'PENDIENTE';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS token_qr_id uuid REFERENCES public.tokens_qr_mesas(id) ON DELETE SET NULL;

-- Relajar created_by solo para autopedidos QR (el comensal no es usuario auth).
ALTER TABLE public.orders
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_created_by_autopedido_chk;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_created_by_autopedido_chk
  CHECK (es_autopedido_qr = true OR created_by IS NOT NULL);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_estado_aprobacion_qr_chk;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_estado_aprobacion_qr_chk
  CHECK (estado_aprobacion_qr IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));

-- Órdenes no-QR siempre quedan como APROBADO (no entran al panel de pendientes).
UPDATE public.orders
SET estado_aprobacion_qr = 'APROBADO'
WHERE COALESCE(es_autopedido_qr, false) = false
  AND estado_aprobacion_qr IS DISTINCT FROM 'APROBADO';

CREATE INDEX IF NOT EXISTS idx_orders_autopedido_pendiente
  ON public.orders (branch_id, estado_aprobacion_qr, created_at DESC)
  WHERE es_autopedido_qr = true AND estado_aprobacion_qr = 'PENDIENTE';

COMMENT ON COLUMN public.orders.es_autopedido_qr IS
  'true si la orden fue creada por un comensal vía QR de mesa.';
COMMENT ON COLUMN public.orders.estado_aprobacion_qr IS
  'PENDIENTE | APROBADO | RECHAZADO. Solo aplica cuando es_autopedido_qr = true.';
COMMENT ON COLUMN public.orders.token_qr_id IS
  'Token QR usado al crear el autopedido (auditoría).';

-- Órdenes normales (no QR) deben quedar APROBADO automáticamente.
CREATE OR REPLACE FUNCTION public.orders_normalizar_estado_aprobacion_qr()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.es_autopedido_qr, false) IS NOT TRUE THEN
    NEW.estado_aprobacion_qr := 'APROBADO';
  ELSIF NEW.estado_aprobacion_qr IS NULL THEN
    NEW.estado_aprobacion_qr := 'PENDIENTE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_normalizar_estado_aprobacion_qr ON public.orders;
CREATE TRIGGER trg_orders_normalizar_estado_aprobacion_qr
  BEFORE INSERT OR UPDATE OF es_autopedido_qr, estado_aprobacion_qr
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_normalizar_estado_aprobacion_qr();

-- -----------------------------------------------------------------------------
-- 3. Helpers de validación (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.token_qr_mesa_activo(p_token_seguro text)
RETURNS TABLE (
  token_id uuid,
  sucursal_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  turno_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS token_id,
    t.sucursal_id,
    t.mesa_id,
    rt.name AS mesa_nombre,
    rt.visual_order AS mesa_visual_order,
    cs.id AS turno_id
  FROM public.tokens_qr_mesas t
  INNER JOIN public.restaurant_tables rt
    ON rt.id = t.mesa_id
   AND rt.branch_id = t.sucursal_id
  INNER JOIN public.cash_shifts cs
    ON cs.branch_id = t.sucursal_id
   AND cs.status = 'OPEN'
  WHERE t.activo = true
    AND t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
    AND rt.is_active = true
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.token_qr_mesa_activo(text) IS
  'Resuelve token QR activo solo si hay turno OPEN en la sucursal y la mesa está activa.';

CREATE OR REPLACE FUNCTION public.usuario_puede_gestionar_autopedidos_qr(
  p_user_id uuid DEFAULT auth.uid(),
  p_sucursal_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    INNER JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    WHERE cs.status = 'OPEN'
      AND csu.user_id = COALESCE(p_user_id, auth.uid())
      AND csu.is_enabled = true
      AND (
        csu.can_serve_tables = true
        OR csu.can_access_orders = true
        OR csu.can_use_caja = true
        OR csu.is_supervisor = true
      )
      AND (p_sucursal_id IS NULL OR cs.branch_id = p_sucursal_id)
  )
  OR public.is_global_admin(COALESCE(p_user_id, auth.uid()))
  OR (
    p_sucursal_id IS NOT NULL
    AND public.can_manage_branch_admin(COALESCE(p_user_id, auth.uid()), p_sucursal_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. RLS: tokens_qr_mesas
-- -----------------------------------------------------------------------------
ALTER TABLE public.tokens_qr_mesas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tokens_qr_mesas_select_anon ON public.tokens_qr_mesas;
CREATE POLICY tokens_qr_mesas_select_anon
  ON public.tokens_qr_mesas
  FOR SELECT
  TO anon
  USING (
    activo = true
    AND EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.branch_id = tokens_qr_mesas.sucursal_id
        AND cs.status = 'OPEN'
    )
  );

DROP POLICY IF EXISTS tokens_qr_mesas_select_authenticated ON public.tokens_qr_mesas;
CREATE POLICY tokens_qr_mesas_select_authenticated
  ON public.tokens_qr_mesas
  FOR SELECT
  TO authenticated
  USING (
    public.is_global_admin(auth.uid())
    OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active_branch_id = tokens_qr_mesas.sucursal_id
    )
  );

DROP POLICY IF EXISTS tokens_qr_mesas_admin_write ON public.tokens_qr_mesas;
CREATE POLICY tokens_qr_mesas_admin_write
  ON public.tokens_qr_mesas
  FOR ALL
  TO authenticated
  USING (
    public.is_global_admin(auth.uid())
    OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  )
  WITH CHECK (
    public.is_global_admin(auth.uid())
    OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  );

GRANT SELECT ON public.tokens_qr_mesas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tokens_qr_mesas TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS: menu_nodes (lectura anónima TABLE con turno abierto + token activo)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS menu_nodes_select_anon_autopedido_qr ON public.menu_nodes;
CREATE POLICY menu_nodes_select_anon_autopedido_qr
  ON public.menu_nodes
  FOR SELECT
  TO anon
  USING (
    menu_nodes.is_active = true
    AND menu_nodes.menu_scope = 'TABLE'
    AND EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      INNER JOIN public.cash_shifts cs
        ON cs.branch_id = t.sucursal_id
       AND cs.status = 'OPEN'
      WHERE t.sucursal_id = menu_nodes.branch_id
        AND t.activo = true
    )
  );

GRANT SELECT ON public.menu_nodes TO anon;

-- Lectura anónima de modificadores del menú mesa (heredados en cliente).
DROP POLICY IF EXISTS modifiers_select_anon_autopedido_qr ON public.modifiers;
CREATE POLICY modifiers_select_anon_autopedido_qr
  ON public.modifiers
  FOR SELECT
  TO anon
  USING (
    modifiers.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      INNER JOIN public.cash_shifts cs
        ON cs.branch_id = t.sucursal_id
       AND cs.status = 'OPEN'
      WHERE t.sucursal_id = modifiers.branch_id
        AND t.activo = true
    )
  );

GRANT SELECT ON public.modifiers TO anon;

DROP POLICY IF EXISTS menu_node_modifiers_select_anon_autopedido_qr ON public.menu_node_modifiers;
CREATE POLICY menu_node_modifiers_select_anon_autopedido_qr
  ON public.menu_node_modifiers
  FOR SELECT
  TO anon
  USING (
    COALESCE(menu_node_modifiers.is_active, true) = true
    AND EXISTS (
      SELECT 1
      FROM public.menu_nodes mn
      INNER JOIN public.tokens_qr_mesas t
        ON t.sucursal_id = mn.branch_id
       AND t.activo = true
      INNER JOIN public.cash_shifts cs
        ON cs.branch_id = t.sucursal_id
       AND cs.status = 'OPEN'
      WHERE mn.id = menu_node_modifiers.node_id
        AND mn.menu_scope = 'TABLE'
    )
  );

GRANT SELECT ON public.menu_node_modifiers TO anon;

-- -----------------------------------------------------------------------------
-- 6. RLS: orders / order_items (anon controlado)
-- -----------------------------------------------------------------------------
-- Contrato: solo filas es_autopedido_qr con token válido y turno OPEN.
-- El frontend público NO debe insertar directo: usar crear_orden_autopedido_qr.
DROP POLICY IF EXISTS orders_insert_anon_autopedido_qr ON public.orders;
CREATE POLICY orders_insert_anon_autopedido_qr
  ON public.orders
  FOR INSERT
  TO anon
  WITH CHECK (
    es_autopedido_qr = true
    AND estado_aprobacion_qr = 'PENDIENTE'
    AND status = 'DRAFT'
    AND order_type = 'DINE_IN'
    AND menu_scope = 'TABLE'
    AND COALESCE(is_special, false) = false
    AND COALESCE(is_tray_order, false) = false
    AND token_qr_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      INNER JOIN public.cash_shifts cs
        ON cs.branch_id = t.sucursal_id
       AND cs.status = 'OPEN'
      WHERE t.id = orders.token_qr_id
        AND t.activo = true
        AND t.sucursal_id = orders.branch_id
        AND t.mesa_id = orders.table_id
        AND cs.id = orders.cash_shift_id
    )
  );

DROP POLICY IF EXISTS orders_select_anon_autopedido_qr ON public.orders;
CREATE POLICY orders_select_anon_autopedido_qr
  ON public.orders
  FOR SELECT
  TO anon
  USING (
    es_autopedido_qr = true
    AND estado_aprobacion_qr = 'PENDIENTE'
    AND token_qr_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      WHERE t.id = orders.token_qr_id
        AND t.activo = true
    )
  );

GRANT SELECT, INSERT ON public.orders TO anon;

DROP POLICY IF EXISTS order_items_insert_anon_autopedido_qr ON public.order_items;
CREATE POLICY order_items_insert_anon_autopedido_qr
  ON public.order_items
  FOR INSERT
  TO anon
  WITH CHECK (
    status = 'DRAFT'
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      INNER JOIN public.tokens_qr_mesas t
        ON t.id = o.token_qr_id
       AND t.activo = true
      INNER JOIN public.cash_shifts cs
        ON cs.id = o.cash_shift_id
       AND cs.status = 'OPEN'
      WHERE o.id = order_items.order_id
        AND o.es_autopedido_qr = true
        AND o.estado_aprobacion_qr = 'PENDIENTE'
        AND o.status = 'DRAFT'
    )
  );

DROP POLICY IF EXISTS order_items_select_anon_autopedido_qr ON public.order_items;
CREATE POLICY order_items_select_anon_autopedido_qr
  ON public.order_items
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.es_autopedido_qr = true
        AND o.estado_aprobacion_qr = 'PENDIENTE'
    )
  );

GRANT SELECT, INSERT ON public.order_items TO anon;

DROP POLICY IF EXISTS order_item_modifiers_insert_anon_autopedido_qr ON public.order_item_modifiers;
CREATE POLICY order_item_modifiers_insert_anon_autopedido_qr
  ON public.order_item_modifiers
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.order_items oi
      INNER JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_modifiers.order_item_id
        AND o.es_autopedido_qr = true
        AND o.estado_aprobacion_qr = 'PENDIENTE'
        AND o.status = 'DRAFT'
    )
  );

GRANT SELECT, INSERT ON public.order_item_modifiers TO anon;

-- -----------------------------------------------------------------------------
-- 7. RPC: resolver contexto del token
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_contexto_token_qr_mesa(p_token_seguro text)
RETURNS TABLE (
  token_id uuid,
  sucursal_id uuid,
  sucursal_nombre text,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  turno_id uuid,
  turno_abierto boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT *
  INTO v_ctx
  FROM public.token_qr_mesa_activo(p_token_seguro);

  IF v_ctx.token_id IS NULL THEN
    -- Distinguir token inválido vs sin turno abierto
    IF EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      WHERE t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
        AND t.activo = true
    ) THEN
      RAISE EXCEPTION 'No hay un turno abierto en esta sucursal. El autopedido no está disponible.';
    END IF;
    RAISE EXCEPTION 'Código QR inválido o inactivo.';
  END IF;

  RETURN QUERY
  SELECT
    v_ctx.token_id,
    v_ctx.sucursal_id,
    b.name::text AS sucursal_nombre,
    v_ctx.mesa_id,
    v_ctx.mesa_nombre,
    v_ctx.mesa_visual_order,
    v_ctx.turno_id,
    true AS turno_abierto
  FROM public.branches b
  WHERE b.id = v_ctx.sucursal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolver_contexto_token_qr_mesa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_contexto_token_qr_mesa(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC: menú TABLE para autopedido (sin BULK / empaque)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obtener_menu_autopedido_qr(p_token_seguro text)
RETURNS TABLE (
  id uuid,
  branch_id uuid,
  parent_id uuid,
  name text,
  node_type text,
  menu_scope text,
  display_order integer,
  depth integer,
  price numeric,
  image_url text,
  is_active boolean,
  legacy_product_id uuid,
  manual_price_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  RETURN QUERY
  SELECT
    mn.id,
    mn.branch_id,
    mn.parent_id,
    mn.name,
    mn.node_type::text,
    mn.menu_scope::text,
    mn.display_order,
    mn.depth,
    mn.price,
    mn.image_url,
    mn.is_active,
    mn.legacy_product_id,
    COALESCE(mn.manual_price_enabled, false) AS manual_price_enabled
  FROM public.menu_nodes mn
  WHERE mn.branch_id = v_ctx.sucursal_id
    AND mn.menu_scope = 'TABLE'
    AND mn.is_active = true
    AND COALESCE(mn.is_tray_category, false) = false
  ORDER BY mn.depth, mn.display_order, mn.name;
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_menu_autopedido_qr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_menu_autopedido_qr(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.obtener_modificadores_autopedido_qr(p_token_seguro text)
RETURNS TABLE (
  menu_node_id uuid,
  modifier_id uuid,
  display_order integer,
  modifier_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  RETURN QUERY
  SELECT
    mnm.node_id AS menu_node_id,
    mnm.modifier_id,
    COALESCE(mnm.display_order, 0) AS display_order,
    m.description AS modifier_name
  FROM public.menu_node_modifiers mnm
  INNER JOIN public.menu_nodes mn
    ON mn.id = mnm.node_id
  INNER JOIN public.modifiers m
    ON m.id = mnm.modifier_id
  WHERE mn.branch_id = v_ctx.sucursal_id
    AND mn.menu_scope = 'TABLE'
    AND mn.is_active = true
    AND COALESCE(mnm.is_active, true) = true
    AND m.is_active = true
    AND m.branch_id = v_ctx.sucursal_id
  ORDER BY mnm.display_order, m.description;
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_modificadores_autopedido_qr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_modificadores_autopedido_qr(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. RPC: cliente (buscar / registrar) con token válido
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_cliente_autopedido_qr(
  p_token_seguro text,
  p_cedula text
)
RETURNS TABLE (
  id uuid,
  cedula varchar,
  sexo char,
  nombres varchar,
  apellidos varchar,
  celular varchar,
  correo varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_cedula text := NULLIF(trim(COALESCE(p_cedula, '')), '');
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  IF v_cedula IS NULL OR v_cedula !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'La cédula debe tener exactamente 10 dígitos.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.cedula,
    c.sexo,
    c.nombres,
    c.apellidos,
    c.celular,
    c.correo
  FROM public.clientes c
  WHERE c.cedula = v_cedula
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_cliente_autopedido_qr(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_cliente_autopedido_qr(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.registrar_cliente_autopedido_qr(
  p_token_seguro text,
  p_cedula text,
  p_nombres text,
  p_apellidos text,
  p_celular text,
  p_sexo char,
  p_correo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_id uuid;
  v_cedula text := NULLIF(trim(COALESCE(p_cedula, '')), '');
  v_nombres text := NULLIF(trim(COALESCE(p_nombres, '')), '');
  v_apellidos text := NULLIF(trim(COALESCE(p_apellidos, '')), '');
  v_celular text := NULLIF(trim(COALESCE(p_celular, '')), '');
  v_correo text := NULLIF(trim(COALESCE(p_correo, '')), '');
  v_sexo char := upper(NULLIF(trim(COALESCE(p_sexo::text, '')), ''))::char;
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  IF v_cedula IS NULL OR v_cedula !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'La cédula debe tener exactamente 10 dígitos.';
  END IF;
  IF v_nombres IS NULL OR v_nombres !~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$' THEN
    RAISE EXCEPTION 'Los nombres solo pueden contener letras y espacios.';
  END IF;
  IF v_apellidos IS NULL OR v_apellidos !~ '^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ ]+$' THEN
    RAISE EXCEPTION 'Los apellidos solo pueden contener letras y espacios.';
  END IF;
  IF v_celular IS NULL OR v_celular !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'El celular debe tener exactamente 10 dígitos.';
  END IF;
  IF v_sexo IS NULL OR v_sexo NOT IN ('M', 'F') THEN
    RAISE EXCEPTION 'El sexo debe ser M o F.';
  END IF;
  IF v_correo IS NOT NULL AND v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo no tiene un formato válido.';
  END IF;

  SELECT c.id INTO v_id FROM public.clientes c WHERE c.cedula = v_cedula;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.clientes (
    cedula, sexo, nombres, apellidos, celular, correo, creado_por
  ) VALUES (
    v_cedula, v_sexo, v_nombres, v_apellidos, v_celular, v_correo, NULL
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_cliente_autopedido_qr(text, text, text, text, text, char, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cliente_autopedido_qr(text, text, text, text, text, char, text) TO anon, authenticated;

-- Política: permitir INSERT anónimo en clientes solo vía RPC (SECURITY DEFINER
-- bypasea RLS). No se abre INSERT TO anon directo sobre clientes.

-- -----------------------------------------------------------------------------
-- 10. RPC: crear orden + ítems (camino seguro del comensal)
-- -----------------------------------------------------------------------------
-- p_items: jsonb array
-- [
--   {
--     "menu_node_id": "uuid",
--     "quantity": 1,
--     "item_note": "...",
--     "modifier_ids": ["uuid", ...]
--   }
-- ]
CREATE OR REPLACE FUNCTION public.crear_orden_autopedido_qr(
  p_token_seguro text,
  p_items jsonb,
  p_cliente_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_order_id uuid;
  v_position integer;
  v_item jsonb;
  v_node record;
  v_product_id uuid;
  v_qty integer;
  v_unit_price numeric(10,2);
  v_item_id uuid;
  v_modifier_id uuid;
  v_description text;
  v_note text;
  v_items_count integer := 0;
BEGIN
  SELECT * INTO v_ctx FROM public.token_qr_mesa_activo(p_token_seguro);
  IF v_ctx.token_id IS NULL THEN
    RAISE EXCEPTION 'Código QR inválido, inactivo o sin turno abierto.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al pedido.';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id
  ) THEN
    RAISE EXCEPTION 'El cliente indicado no existe.';
  END IF;

  -- Posición dentro de la mesa (soporta varias órdenes por mesa).
  SELECT COALESCE(MAX(o.table_order_position), 0) + 1
  INTO v_position
  FROM public.orders o
  WHERE o.table_id = v_ctx.mesa_id
    AND o.cash_shift_id = v_ctx.turno_id
    AND o.status IN ('DRAFT', 'SENT_TO_KITCHEN', 'READY', 'PAID');

  INSERT INTO public.orders (
    branch_id,
    table_id,
    table_order_position,
    table_name_snapshot,
    order_type,
    menu_scope,
    status,
    is_special,
    is_tray_order,
    created_by,
    cash_shift_id,
    cliente_id,
    es_autopedido_qr,
    estado_aprobacion_qr,
    token_qr_id,
    total
  ) VALUES (
    v_ctx.sucursal_id,
    v_ctx.mesa_id,
    v_position,
    v_ctx.mesa_nombre,
    'DINE_IN',
    'TABLE',
    'DRAFT',
    false,
    false,
    NULL,
    v_ctx.turno_id,
    p_cliente_id,
    true,
    'PENDIENTE',
    v_ctx.token_id,
    0
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::integer, 1));
    v_note := NULLIF(trim(COALESCE(v_item->>'item_note', '')), '');

    SELECT
      mn.id,
      mn.branch_id,
      mn.menu_scope,
      mn.node_type,
      mn.name,
      mn.is_active,
      mn.legacy_product_id,
      mn.price,
      COALESCE(mn.manual_price_enabled, false) AS manual_price_enabled
    INTO v_node
    FROM public.menu_nodes mn
    WHERE mn.id = NULLIF(v_item->>'menu_node_id', '')::uuid
      AND mn.branch_id = v_ctx.sucursal_id
      AND mn.menu_scope = 'TABLE'
      AND mn.node_type = 'product'
      AND mn.is_active = true
      AND COALESCE(mn.is_tray_category, false) = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no está disponible en el menú de mesas.';
    END IF;

    v_product_id := COALESCE(v_node.legacy_product_id, v_node.id);

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id AND p.is_active = true
    ) THEN
      RAISE EXCEPTION 'El producto "%" no tiene ficha legacy activa.', v_node.name;
    END IF;

    IF v_node.manual_price_enabled THEN
      v_unit_price := ROUND(COALESCE((v_item->>'unit_price')::numeric, v_node.price, 0), 2);
    ELSE
      v_unit_price := ROUND(COALESCE(v_node.price, 0), 2);
    END IF;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'El producto "%" no tiene un precio válido.', v_node.name;
    END IF;

    v_description := COALESCE(NULLIF(trim(v_node.name), ''), 'Producto');

    INSERT INTO public.order_items (
      order_id,
      product_id,
      description_snapshot,
      quantity,
      unit_price,
      total,
      status,
      item_note
    ) VALUES (
      v_order_id,
      v_product_id,
      v_description,
      v_qty,
      v_unit_price,
      ROUND((v_qty * v_unit_price)::numeric, 2),
      'DRAFT',
      v_note
    )
    RETURNING id INTO v_item_id;

    IF jsonb_typeof(COALESCE(v_item->'modifier_ids', '[]'::jsonb)) = 'array' THEN
      FOR v_modifier_id IN
        SELECT NULLIF(x, '')::uuid
        FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_ids', '[]'::jsonb)) AS x
        WHERE NULLIF(x, '') IS NOT NULL
      LOOP
        IF NOT EXISTS (
          SELECT 1
          FROM public.modifiers m
          WHERE m.id = v_modifier_id
            AND m.branch_id = v_ctx.sucursal_id
            AND m.is_active = true
        ) THEN
          RAISE EXCEPTION 'Uno de los modificadores seleccionados no es válido.';
        END IF;

        INSERT INTO public.order_item_modifiers (id, order_item_id, modifier_id)
        VALUES (gen_random_uuid(), v_item_id, v_modifier_id);
      END LOOP;
    END IF;

    v_items_count := v_items_count + 1;
  END LOOP;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Debes agregar al menos un producto al pedido.';
  END IF;

  -- Recalcular total (también lo hará trg_sync_order_total si existe).
  UPDATE public.orders o
  SET total = COALESCE((
    SELECT ROUND(SUM(oi.total)::numeric, 2)
    FROM public.order_items oi
    WHERE oi.order_id = o.id
      AND oi.status IS DISTINCT FROM 'CANCELLED'
  ), 0)
  WHERE o.id = v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_orden_autopedido_qr(text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_orden_autopedido_qr(text, jsonb, uuid) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Admin: generar/actualizar tokens para mesas de la sucursal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_tokens_qr_mesas_sucursal(
  p_sucursal_id uuid,
  p_limite integer DEFAULT 20
)
RETURNS TABLE (
  token_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  token_seguro text,
  creado boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limite integer := GREATEST(1, LEAST(COALESCE(p_limite, 20), 100));
  v_mesa record;
  v_token text;
  v_existing public.tokens_qr_mesas%ROWTYPE;
  v_creado boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'sucursal_id es obligatorio';
  END IF;

  IF NOT (
    public.is_global_admin(v_actor)
    OR public.can_manage_branch_admin(v_actor, p_sucursal_id)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para generar códigos QR de mesas.';
  END IF;

  FOR v_mesa IN
    SELECT rt.id, rt.name, rt.visual_order
    FROM public.restaurant_tables rt
    WHERE rt.branch_id = p_sucursal_id
    ORDER BY rt.visual_order ASC, rt.name ASC
    LIMIT v_limite
  LOOP
    SELECT * INTO v_existing
    FROM public.tokens_qr_mesas t
    WHERE t.sucursal_id = p_sucursal_id
      AND t.mesa_id = v_mesa.id;

    IF FOUND THEN
      -- Reactivar y conservar el mismo token (estable para QR físicos impresos).
      UPDATE public.tokens_qr_mesas
      SET activo = true,
          actualizado_en = now()
      WHERE id = v_existing.id;

      token_id := v_existing.id;
      mesa_id := v_mesa.id;
      mesa_nombre := v_mesa.name;
      mesa_visual_order := v_mesa.visual_order;
      token_seguro := v_existing.token_seguro;
      creado := false;
      RETURN NEXT;
    ELSE
      -- 64 hex chars sin depender de pgcrypto.gen_random_bytes
      v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
      INSERT INTO public.tokens_qr_mesas (
        sucursal_id, mesa_id, token_seguro, activo
      ) VALUES (
        p_sucursal_id, v_mesa.id, v_token, true
      )
      RETURNING id INTO token_id;

      mesa_id := v_mesa.id;
      mesa_nombre := v_mesa.name;
      mesa_visual_order := v_mesa.visual_order;
      token_seguro := v_token;
      creado := true;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generar_tokens_qr_mesas_sucursal(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generar_tokens_qr_mesas_sucursal(uuid, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 12. POS: listar / contar pendientes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contar_autopedidos_pendientes(p_sucursal_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT public.usuario_puede_gestionar_autopedidos_qr(v_actor, p_sucursal_id) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM public.orders o
  WHERE o.branch_id = p_sucursal_id
    AND o.es_autopedido_qr = true
    AND o.estado_aprobacion_qr = 'PENDIENTE'
    AND o.status = 'DRAFT';

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.contar_autopedidos_pendientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contar_autopedidos_pendientes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_autopedidos_pendientes(p_sucursal_id uuid)
RETURNS TABLE (
  orden_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  cliente_id uuid,
  cliente_nombre text,
  total numeric,
  creado_en timestamptz,
  items jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT public.usuario_puede_gestionar_autopedidos_qr(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permisos para ver autopedidos pendientes.';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS orden_id,
    o.table_id AS mesa_id,
    COALESCE(rt.name, o.table_name_snapshot, 'Mesa')::text AS mesa_nombre,
    COALESCE(rt.visual_order, 0) AS mesa_visual_order,
    o.cliente_id,
    CASE
      WHEN c.id IS NULL THEN NULL
      ELSE trim(concat_ws(' ', c.nombres, c.apellidos))
    END AS cliente_nombre,
    COALESCE(o.total, 0)::numeric AS total,
    o.created_at AS creado_en,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'description', oi.description_snapshot,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'total', oi.total,
          'item_note', oi.item_note,
          'modifiers', COALESCE((
            SELECT jsonb_agg(m.description ORDER BY m.description)
            FROM public.order_item_modifiers oim
            INNER JOIN public.modifiers m ON m.id = oim.modifier_id
            WHERE oim.order_item_id = oi.id
          ), '[]'::jsonb)
        )
        ORDER BY oi.created_at
      )
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.status IS DISTINCT FROM 'CANCELLED'
    ), '[]'::jsonb) AS items
  FROM public.orders o
  LEFT JOIN public.restaurant_tables rt ON rt.id = o.table_id
  LEFT JOIN public.clientes c ON c.id = o.cliente_id
  WHERE o.branch_id = p_sucursal_id
    AND o.es_autopedido_qr = true
    AND o.estado_aprobacion_qr = 'PENDIENTE'
    AND o.status = 'DRAFT'
  ORDER BY COALESCE(rt.visual_order, 0), o.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_autopedidos_pendientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_autopedidos_pendientes(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 13. POS: aprobar / rechazar
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprobar_autopedido_qr(p_orden_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_status public.order_status,
  submitted_item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_result record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_orden_id IS NULL THEN
    RAISE EXCEPTION 'orden_id es obligatorio';
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_orden_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF COALESCE(v_order.es_autopedido_qr, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'La orden no es un autopedido QR.';
  END IF;

  IF v_order.estado_aprobacion_qr <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El autopedido ya fue resuelto (%).', v_order.estado_aprobacion_qr;
  END IF;

  IF v_order.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar autopedidos en borrador.';
  END IF;

  IF NOT public.usuario_puede_gestionar_autopedidos_qr(v_actor, v_order.branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para aprobar autopedidos.';
  END IF;

  -- Asignar creador operativo al mesero/cajero que aprueba.
  UPDATE public.orders
  SET created_by = COALESCE(created_by, v_actor),
      estado_aprobacion_qr = 'APROBADO',
      updated_at = now()
  WHERE id = p_orden_id;

  -- Integra al workflow normal: DRAFT -> SENT_TO_KITCHEN (+ order_code/number).
  SELECT s.order_id, s.order_status, s.submitted_item_count
  INTO v_result
  FROM public.submit_order_draft_items(p_orden_id) s
  LIMIT 1;

  order_id := v_result.order_id;
  order_status := v_result.order_status;
  submitted_item_count := v_result.submitted_item_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_autopedido_qr(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprobar_autopedido_qr(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rechazar_autopedido_qr(
  p_orden_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_motivo text := NULLIF(trim(COALESCE(p_motivo, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_orden_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada.';
  END IF;

  IF COALESCE(v_order.es_autopedido_qr, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'La orden no es un autopedido QR.';
  END IF;

  IF v_order.estado_aprobacion_qr <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El autopedido ya fue resuelto (%).', v_order.estado_aprobacion_qr;
  END IF;

  IF v_order.status NOT IN ('DRAFT') THEN
    RAISE EXCEPTION 'Solo se pueden rechazar autopedidos en borrador.';
  END IF;

  IF NOT public.usuario_puede_gestionar_autopedidos_qr(v_actor, v_order.branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para rechazar autopedidos.';
  END IF;

  UPDATE public.order_items
  SET status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancelled_from_status = status,
      cancellation_reason = COALESCE(v_motivo, 'Autopedido QR rechazado')
  WHERE order_id = p_orden_id
    AND status IS DISTINCT FROM 'CANCELLED';

  UPDATE public.orders
  SET status = 'CANCELLED',
      estado_aprobacion_qr = 'RECHAZADO',
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancelled_from_status = status::text,
      cancellation_reason = COALESCE(v_motivo, 'Autopedido QR rechazado'),
      created_by = COALESCE(created_by, v_actor),
      updated_at = now()
  WHERE id = p_orden_id;

  RETURN p_orden_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rechazar_autopedido_qr(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rechazar_autopedido_qr(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 14. Grants auxiliares
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.token_qr_mesa_activo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.token_qr_mesa_activo(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.usuario_puede_gestionar_autopedidos_qr(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_puede_gestionar_autopedidos_qr(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
