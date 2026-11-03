-- =============================================================================
-- Caja Chica: fondo por sucursal (P1 Mañana/Tarde comparten vía inventario
-- efectiva), egresos con foto, reposiciones y permiso por usuario/sucursal.
-- =============================================================================

INSERT INTO public.modules (code, name, description, is_active)
VALUES (
  'caja_chica',
  'Caja Chica',
  'Fondo de caja chica por sucursal: egresos, reposiciones y comprobantes',
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.can_operate_caja_chica(
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
    public.is_global_admin(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.inventario_sucursales_compartidas(p_branch_id) AS s(id)
      WHERE public.can_manage_branch_admin(p_user_id, s.id)
         OR public.has_branch_permission(
              p_user_id, s.id, 'caja_chica', 'OPERATE'::public.access_level
            )
         OR public.has_branch_permission(
              p_user_id, s.id, 'caja_chica', 'MANAGE'::public.access_level
            )
         OR EXISTS (
              SELECT 1
              FROM public.user_branch_modules ubm
              JOIN public.modules m ON m.id = ubm.module_id
              WHERE ubm.user_id = p_user_id
                AND ubm.branch_id = s.id
                AND ubm.is_active = true
                AND m.code = 'caja_chica'
                AND m.is_active = true
            )
    );
$$;

REVOKE ALL ON FUNCTION public.can_operate_caja_chica(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_operate_caja_chica(uuid, uuid) TO authenticated;

-- ---- Tablas ----

CREATE TABLE IF NOT EXISTS public.caja_chica_fondos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  saldo numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT caja_chica_fondos_saldo_chk CHECK (saldo >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_chica_fondos_sucursal_uniq UNIQUE (sucursal_id)
);

COMMENT ON TABLE public.caja_chica_fondos IS
  'Saldo actual de caja chica. sucursal_id = inventario_sucursal_efectiva (P1 Mañana/Tarde comparten).';

CREATE TABLE IF NOT EXISTS public.caja_chica_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  tipo text NOT NULL
    CONSTRAINT caja_chica_movimientos_tipo_chk CHECK (tipo IN ('EGRESO', 'REPOSICION')),
  monto numeric(14, 2) NOT NULL
    CONSTRAINT caja_chica_movimientos_monto_chk CHECK (monto > 0),
  concepto text NOT NULL,
  notas text,
  saldo_antes numeric(14, 2) NOT NULL,
  saldo_despues numeric(14, 2) NOT NULL,
  nombre_bucket text,
  ruta_objeto text,
  nombre_archivo text,
  tipo_mime text,
  tamano_bytes integer
    CONSTRAINT caja_chica_movimientos_tamano_chk CHECK (tamano_bytes IS NULL OR tamano_bytes > 0),
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrado_por_nombre text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_chica_movimientos_ruta_unica UNIQUE (ruta_objeto),
  CONSTRAINT caja_chica_movimientos_egreso_foto_chk CHECK (
    tipo <> 'EGRESO'
    OR (
      ruta_objeto IS NOT NULL
      AND length(trim(ruta_objeto)) > 0
      AND nombre_bucket IS NOT NULL
      AND tamano_bytes IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.caja_chica_movimientos IS
  'Historial de egresos y reposiciones de caja chica. Egreso exige foto de comprobante.';

CREATE INDEX IF NOT EXISTS idx_caja_chica_movimientos_sucursal_creado
  ON public.caja_chica_movimientos (sucursal_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_caja_chica_movimientos_tipo
  ON public.caja_chica_movimientos (sucursal_id, tipo, creado_en DESC);

-- Redirigir inserts a la sucursal dueña del inventario (P1 compartido).
CREATE OR REPLACE FUNCTION public.trg_caja_chica_redirigir_sucursal_efectiva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.sucursal_id := public.inventario_sucursal_efectiva(NEW.sucursal_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_chica_fondos_sucursal_efectiva ON public.caja_chica_fondos;
CREATE TRIGGER trg_caja_chica_fondos_sucursal_efectiva
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.caja_chica_fondos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_caja_chica_redirigir_sucursal_efectiva();

DROP TRIGGER IF EXISTS trg_caja_chica_movimientos_sucursal_efectiva ON public.caja_chica_movimientos;
CREATE TRIGGER trg_caja_chica_movimientos_sucursal_efectiva
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.caja_chica_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_caja_chica_redirigir_sucursal_efectiva();

ALTER TABLE public.caja_chica_fondos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_chica_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caja_chica_fondos_select ON public.caja_chica_fondos;
CREATE POLICY caja_chica_fondos_select
ON public.caja_chica_fondos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(caja_chica_fondos.sucursal_id) AS s(id)
    WHERE public.can_operate_caja_chica(auth.uid(), s.id)
  )
);

DROP POLICY IF EXISTS caja_chica_movimientos_select ON public.caja_chica_movimientos;
CREATE POLICY caja_chica_movimientos_select
ON public.caja_chica_movimientos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventario_sucursales_compartidas(caja_chica_movimientos.sucursal_id) AS s(id)
    WHERE public.can_operate_caja_chica(auth.uid(), s.id)
  )
);

-- Sin INSERT/UPDATE/DELETE directos: solo RPCs SECURITY DEFINER.

-- ---- Storage ----

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-caja-chica',
  'comprobantes-caja-chica',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated read comprobantes-caja-chica" ON storage.objects;
CREATE POLICY "Authenticated read comprobantes-caja-chica"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprobantes-caja-chica'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_operate_caja_chica(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Upload comprobantes-caja-chica" ON storage.objects;
CREATE POLICY "Upload comprobantes-caja-chica"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprobantes-caja-chica'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_operate_caja_chica(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Delete comprobantes-caja-chica" ON storage.objects;
CREATE POLICY "Delete comprobantes-caja-chica"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'comprobantes-caja-chica'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND (
    public.is_global_admin(auth.uid())
    OR public.can_manage_branch_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

-- ---- RPCs ----

CREATE OR REPLACE FUNCTION public.caja_chica_obtener_estado(p_sucursal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_saldo numeric(14, 2);
  v_nombre text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal requerida';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  SELECT b.name INTO v_nombre
  FROM public.branches b
  WHERE b.id = v_efectiva;

  SELECT f.saldo INTO v_saldo
  FROM public.caja_chica_fondos f
  WHERE f.sucursal_id = v_efectiva;

  RETURN jsonb_build_object(
    'sucursal_id', p_sucursal_id,
    'sucursal_efectiva_id', v_efectiva,
    'sucursal_efectiva_nombre', COALESCE(v_nombre, ''),
    'saldo', COALESCE(v_saldo, 0),
    'comparten', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name), '[]'::jsonb)
      FROM public.inventario_sucursales_compartidas(p_sucursal_id) AS s(id)
      JOIN public.branches b ON b.id = s.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_obtener_estado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_obtener_estado(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_listar_movimientos(
  p_sucursal_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  sucursal_id uuid,
  tipo text,
  monto numeric,
  concepto text,
  notas text,
  saldo_antes numeric,
  saldo_despues numeric,
  ruta_objeto text,
  nombre_bucket text,
  registrado_por_nombre text,
  creado_en timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  RETURN QUERY
  SELECT
    m.id,
    m.sucursal_id,
    m.tipo,
    m.monto,
    m.concepto,
    m.notas,
    m.saldo_antes,
    m.saldo_despues,
    m.ruta_objeto,
    m.nombre_bucket,
    m.registrado_por_nombre,
    m.creado_en
  FROM public.caja_chica_movimientos m
  WHERE m.sucursal_id = v_efectiva
  ORDER BY m.creado_en DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_listar_movimientos(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_listar_movimientos(uuid, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.caja_chica_registrar_movimiento(
  p_sucursal_id uuid,
  p_tipo text,
  p_monto numeric,
  p_concepto text,
  p_notas text DEFAULT NULL,
  p_movimiento_id uuid DEFAULT NULL,
  p_ruta_objeto text DEFAULT NULL,
  p_nombre_archivo text DEFAULT NULL,
  p_tipo_mime text DEFAULT NULL,
  p_tamano_bytes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_efectiva uuid;
  v_tipo text := upper(trim(COALESCE(p_tipo, '')));
  v_monto numeric(14, 2) := round(COALESCE(p_monto, 0), 2);
  v_concepto text := nullif(trim(COALESCE(p_concepto, '')), '');
  v_notas text := nullif(trim(COALESCE(p_notas, '')), '');
  v_saldo_antes numeric(14, 2);
  v_saldo_despues numeric(14, 2);
  v_mov_id uuid := COALESCE(p_movimiento_id, gen_random_uuid());
  v_nombre text;
  v_bucket text := 'comprobantes-caja-chica';
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal requerida';
  END IF;
  IF NOT public.can_operate_caja_chica(v_actor, p_sucursal_id) THEN
    RAISE EXCEPTION 'No tienes permiso para caja chica en esta sucursal';
  END IF;
  IF v_tipo NOT IN ('EGRESO', 'REPOSICION') THEN
    RAISE EXCEPTION 'Tipo inválido (EGRESO o REPOSICION)';
  END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;
  IF v_concepto IS NULL THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;
  IF v_tipo = 'EGRESO' THEN
    IF p_ruta_objeto IS NULL OR length(trim(p_ruta_objeto)) = 0 THEN
      RAISE EXCEPTION 'El egreso requiere foto del comprobante';
    END IF;
    IF p_tamano_bytes IS NULL OR p_tamano_bytes <= 0 THEN
      RAISE EXCEPTION 'El egreso requiere foto del comprobante';
    END IF;
  END IF;

  v_efectiva := public.inventario_sucursal_efectiva(p_sucursal_id);

  SELECT COALESCE(
    (SELECT trim(concat_ws(' ', p.first_name, p.last_name)) FROM public.profiles p WHERE p.id = v_actor),
    (SELECT p.full_name FROM public.profiles p WHERE p.id = v_actor),
    (SELECT p.username FROM public.profiles p WHERE p.id = v_actor),
    'Usuario'
  ) INTO v_nombre;

  INSERT INTO public.caja_chica_fondos (sucursal_id, saldo)
  VALUES (v_efectiva, 0)
  ON CONFLICT (sucursal_id) DO NOTHING;

  SELECT f.saldo INTO v_saldo_antes
  FROM public.caja_chica_fondos f
  WHERE f.sucursal_id = v_efectiva
  FOR UPDATE;

  v_saldo_antes := COALESCE(v_saldo_antes, 0);

  IF v_tipo = 'EGRESO' THEN
    IF v_monto > v_saldo_antes THEN
      RAISE EXCEPTION 'Saldo insuficiente (disponible: %)', v_saldo_antes;
    END IF;
    v_saldo_despues := v_saldo_antes - v_monto;
  ELSE
    v_saldo_despues := v_saldo_antes + v_monto;
  END IF;

  UPDATE public.caja_chica_fondos
  SET saldo = v_saldo_despues,
      actualizado_en = now()
  WHERE sucursal_id = v_efectiva;

  INSERT INTO public.caja_chica_movimientos (
    id,
    sucursal_id,
    tipo,
    monto,
    concepto,
    notas,
    saldo_antes,
    saldo_despues,
    nombre_bucket,
    ruta_objeto,
    nombre_archivo,
    tipo_mime,
    tamano_bytes,
    registrado_por,
    registrado_por_nombre
  ) VALUES (
    v_mov_id,
    v_efectiva,
    v_tipo,
    v_monto,
    v_concepto,
    v_notas,
    v_saldo_antes,
    v_saldo_despues,
    CASE WHEN p_ruta_objeto IS NOT NULL AND length(trim(p_ruta_objeto)) > 0 THEN v_bucket ELSE NULL END,
    nullif(trim(COALESCE(p_ruta_objeto, '')), ''),
    nullif(trim(COALESCE(p_nombre_archivo, '')), ''),
    nullif(trim(COALESCE(p_tipo_mime, '')), ''),
    p_tamano_bytes,
    v_actor,
    v_nombre
  );

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'sucursal_efectiva_id', v_efectiva,
    'tipo', v_tipo,
    'monto', v_monto,
    'saldo_antes', v_saldo_antes,
    'saldo_despues', v_saldo_despues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_chica_registrar_movimiento(uuid, text, numeric, text, text, uuid, text, text, text, integer) TO authenticated;

-- Inyectar permiso caja_chica en get_my_access_context (si aún no está).
DO $$
DECLARE
  def text;
  inject text;
  marker text := 'RETURN jsonb_build_object(';
  idx int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_my_access_context'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF def IS NULL THEN
    RAISE EXCEPTION 'get_my_access_context no encontrada';
  END IF;

  IF position('can_operate_caja_chica' in def) > 0 THEN
    RAISE NOTICE 'get_my_access_context ya incluye caja_chica';
    RETURN;
  END IF;

  inject := $i$
  IF v_active_branch IS NOT NULL AND public.can_operate_caja_chica(v_user_id, v_active_branch) THEN
    v_permissions := COALESCE(v_permissions, '{}'::jsonb)
      || jsonb_build_object('caja_chica', 'OPERATE');
  END IF;

$i$;

  -- lastIndexOf(marker)
  idx := length(def) - position(reverse(marker) in reverse(def)) - length(marker) + 2;
  IF idx <= 1 THEN
    RAISE EXCEPTION 'No se pudo localizar RETURN en get_my_access_context';
  END IF;

  def := substr(def, 1, idx - 1) || inject || substr(def, idx);
  EXECUTE def;
  RAISE NOTICE 'get_my_access_context parcheada con caja_chica';
END;
$$;
