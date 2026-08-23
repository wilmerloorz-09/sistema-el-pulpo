-- =============================================================================
-- QR compartido El Pulpo 1 Mañana + Tarde
-- ---------------------------------------------------------------------------
-- Misma numeración de mesas (visual_order). Un token sirve para ambas
-- sucursales: al escanear se elige el turno OPEN del grupo; si hay dos,
-- gana el de opened_at más reciente.
-- =============================================================================

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS qr_shared_group text;

COMMENT ON COLUMN public.branches.qr_shared_group IS
  'Si dos o más sucursales comparten el mismo valor, sus QR de mesa son intercambiables (resolución por visual_order + turno OPEN más reciente).';

CREATE INDEX IF NOT EXISTS idx_branches_qr_shared_group
  ON public.branches (qr_shared_group)
  WHERE qr_shared_group IS NOT NULL;

-- Pulpo 1 Mañana / Tarde (por branch_code; fallback por nombre)
UPDATE public.branches
SET qr_shared_group = 'el-pulpo-1',
    updated_at = now()
WHERE branch_code IN ('P1M', 'P1T')
   OR name ILIKE 'El Pulpo 1%Mañana%'
   OR name ILIKE 'El Pulpo 1%Manana%'
   OR name ILIKE 'El Pulpo 1%Tarde%';

CREATE OR REPLACE FUNCTION public.qr_shared_peer_branch_ids(p_branch_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mine AS (
    SELECT b.id, b.qr_shared_group
    FROM public.branches b
    WHERE b.id = p_branch_id
  )
  SELECT COALESCE(
    (
      SELECT array_agg(b.id ORDER BY b.name)
      FROM public.branches b
      CROSS JOIN mine m
      WHERE m.qr_shared_group IS NOT NULL
        AND b.qr_shared_group = m.qr_shared_group
        AND COALESCE(b.is_active, true) = true
    ),
    ARRAY[p_branch_id]::uuid[]
  );
$$;

COMMENT ON FUNCTION public.qr_shared_peer_branch_ids(uuid) IS
  'Sucursales del mismo grupo QR; si no hay grupo, solo la sucursal indicada.';

REVOKE ALL ON FUNCTION public.qr_shared_peer_branch_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_shared_peer_branch_ids(uuid) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Resolver token: turno OPEN más reciente del grupo + mesa por visual_order
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token record;
  v_peers uuid[];
  v_shift record;
  v_mesa record;
BEGIN
  SELECT
    t.id,
    t.sucursal_id,
    t.mesa_id,
    rt.visual_order AS mesa_visual_order
  INTO v_token
  FROM public.tokens_qr_mesas t
  INNER JOIN public.restaurant_tables rt
    ON rt.id = t.mesa_id
  WHERE t.activo = true
    AND t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
  LIMIT 1;

  IF v_token.id IS NULL THEN
    RETURN;
  END IF;

  v_peers := public.qr_shared_peer_branch_ids(v_token.sucursal_id);

  SELECT cs.id, cs.branch_id, cs.opened_at
  INTO v_shift
  FROM public.cash_shifts cs
  WHERE cs.branch_id = ANY (v_peers)
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC NULLS LAST, cs.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN;
  END IF;

  SELECT rt.id, rt.name, rt.visual_order
  INTO v_mesa
  FROM public.restaurant_tables rt
  WHERE rt.branch_id = v_shift.branch_id
    AND rt.visual_order = v_token.mesa_visual_order
    AND COALESCE(rt.is_active, true) = true
  ORDER BY rt.name ASC
  LIMIT 1;

  -- Fallback: misma mesa física del token si el visual_order no existe en el peer
  IF v_mesa.id IS NULL AND v_token.sucursal_id = v_shift.branch_id THEN
    SELECT rt.id, rt.name, rt.visual_order
    INTO v_mesa
    FROM public.restaurant_tables rt
    WHERE rt.id = v_token.mesa_id
      AND COALESCE(rt.is_active, true) = true
    LIMIT 1;
  END IF;

  IF v_mesa.id IS NULL THEN
    RETURN;
  END IF;

  token_id := v_token.id;
  sucursal_id := v_shift.branch_id;
  mesa_id := v_mesa.id;
  mesa_nombre := v_mesa.name;
  mesa_visual_order := v_mesa.visual_order;
  turno_id := v_shift.id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.token_qr_mesa_activo(text) IS
  'Resuelve token QR activo contra el turno OPEN más reciente del grupo QR compartido (mesa por visual_order).';

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
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT *
  INTO v_ctx
  FROM public.token_qr_mesa_activo(p_token_seguro);

  IF v_ctx.token_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      WHERE t.token_seguro = NULLIF(trim(COALESCE(p_token_seguro, '')), '')
        AND t.activo = true
    ) THEN
      RAISE EXCEPTION 'No hay un turno abierto para este código QR. El autopedido no está disponible.';
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

-- -----------------------------------------------------------------------------
-- Generar tokens: reutiliza token del grupo por visual_order (un QR para peers)
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
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limite integer := GREATEST(1, LEAST(COALESCE(p_limite, 20), 100));
  v_peers uuid[];
  v_peer uuid;
  v_mesa record;
  v_token text;
  v_existing record;
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

  v_peers := public.qr_shared_peer_branch_ids(p_sucursal_id);

  -- Asegura capacidad de mesas en todos los peers del grupo
  FOREACH v_peer IN ARRAY v_peers
  LOOP
    PERFORM public.ensure_branch_table_capacity(v_peer, v_limite);
  END LOOP;

  FOR v_mesa IN
    SELECT rt.id, rt.name, rt.visual_order
    FROM public.restaurant_tables rt
    WHERE rt.branch_id = p_sucursal_id
    ORDER BY rt.visual_order ASC, rt.name ASC
    LIMIT v_limite
  LOOP
    -- Token ya existente en cualquier peer con el mismo visual_order
    SELECT
      t.id,
      t.token_seguro,
      t.sucursal_id,
      t.mesa_id
    INTO v_existing
    FROM public.tokens_qr_mesas t
    INNER JOIN public.restaurant_tables rt
      ON rt.id = t.mesa_id
    WHERE t.sucursal_id = ANY (v_peers)
      AND rt.visual_order = v_mesa.visual_order
      AND t.activo = true
    ORDER BY
      CASE WHEN t.sucursal_id = p_sucursal_id THEN 0 ELSE 1 END,
      t.creado_en ASC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
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

-- Listado admin: tokens del grupo mapeados a mesas de la sucursal activa
CREATE OR REPLACE FUNCTION public.listar_tokens_qr_mesas_sucursal(p_sucursal_id uuid)
RETURNS TABLE (
  token_id uuid,
  mesa_id uuid,
  mesa_nombre text,
  mesa_visual_order integer,
  token_seguro text,
  activo boolean,
  compartido boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_peers uuid[];
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
    OR public.can_view_branch_admin(v_actor, p_sucursal_id)
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver códigos QR de mesas.';
  END IF;

  v_peers := public.qr_shared_peer_branch_ids(p_sucursal_id);

  RETURN QUERY
  SELECT DISTINCT ON (local_rt.visual_order)
    t.id AS token_id,
    local_rt.id AS mesa_id,
    local_rt.name::text AS mesa_nombre,
    local_rt.visual_order AS mesa_visual_order,
    t.token_seguro,
    t.activo,
    (cardinality(v_peers) > 1) AS compartido
  FROM public.restaurant_tables local_rt
  INNER JOIN public.restaurant_tables peer_rt
    ON peer_rt.visual_order = local_rt.visual_order
   AND peer_rt.branch_id = ANY (v_peers)
  INNER JOIN public.tokens_qr_mesas t
    ON t.mesa_id = peer_rt.id
   AND t.sucursal_id = ANY (v_peers)
   AND t.activo = true
  WHERE local_rt.branch_id = p_sucursal_id
  ORDER BY local_rt.visual_order ASC, t.creado_en ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_tokens_qr_mesas_sucursal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_tokens_qr_mesas_sucursal(uuid) TO authenticated;

-- Anon: token visible si algún peer del grupo tiene turno OPEN
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
      WHERE cs.branch_id = ANY (public.qr_shared_peer_branch_ids(tokens_qr_mesas.sucursal_id))
        AND cs.status = 'OPEN'
    )
  );

-- Menú TABLE anónimo: branch del menú o peer con turno abierto
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
        ON cs.branch_id = ANY (public.qr_shared_peer_branch_ids(t.sucursal_id))
       AND cs.status = 'OPEN'
       AND cs.branch_id = menu_nodes.branch_id
      WHERE t.sucursal_id = ANY (public.qr_shared_peer_branch_ids(menu_nodes.branch_id))
        AND t.activo = true
    )
  );

NOTIFY pgrst, 'reload schema';
