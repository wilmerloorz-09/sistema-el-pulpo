-- Historial de ajustes manuales de la caja auxiliar (Administración > Caja auxiliar).
-- Antes el guardado reescribía branch_auxiliary_cash_denoms sin dejar rastro.

CREATE TABLE IF NOT EXISTS public.ajustes_caja_auxiliar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('AJUSTE', 'RESTABLECER')),
  motivo text NOT NULL,
  detalle jsonb NOT NULL,
  total_antes numeric(12,2) NOT NULL,
  total_despues numeric(12,2) NOT NULL,
  ajustado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ajustes_caja_auxiliar IS
  'Ajustes manuales del stock de la caja auxiliar: quién, cuándo, motivo y cantidades antes/después por denominación.';

CREATE INDEX IF NOT EXISTS idx_ajustes_caja_auxiliar_branch
  ON public.ajustes_caja_auxiliar (branch_id, created_at DESC);

ALTER TABLE public.ajustes_caja_auxiliar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ajustes_caja_auxiliar_select" ON public.ajustes_caja_auxiliar;
CREATE POLICY "ajustes_caja_auxiliar_select"
ON public.ajustes_caja_auxiliar
FOR SELECT
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

-- Sin escritura directa: todo ajuste pasa por guardar_ajuste_caja_auxiliar para quedar registrado.
DROP POLICY IF EXISTS "branch_auxiliary_cash_manage" ON public.branch_auxiliary_cash;
DROP POLICY IF EXISTS "branch_auxiliary_cash_denoms_manage" ON public.branch_auxiliary_cash_denoms;

CREATE OR REPLACE FUNCTION public.guardar_ajuste_caja_auxiliar(
  p_branch_id uuid,
  p_conteos jsonb,
  p_motivo text,
  p_tipo text DEFAULT 'AJUSTE'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_tipo text := upper(btrim(COALESCE(p_tipo, 'AJUSTE')));
  v_detalle jsonb;
  v_total_antes numeric(12,2);
  v_total_despues numeric(12,2);
  v_ajuste_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal requerida';
  END IF;
  IF NOT public.can_manage_branch_admin(v_actor, p_branch_id) THEN
    RAISE EXCEPTION 'Solo administración de sucursal o administración global puede ajustar la caja auxiliar';
  END IF;
  IF v_tipo NOT IN ('AJUSTE', 'RESTABLECER') THEN
    RAISE EXCEPTION 'Tipo de ajuste no válido';
  END IF;
  IF p_conteos IS NULL OR jsonb_typeof(p_conteos) <> 'array' OR jsonb_array_length(p_conteos) = 0 THEN
    RAISE EXCEPTION 'Las cantidades de la caja auxiliar son obligatorias';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_conteos) c
    WHERE COALESCE(c->>'qty', '') !~ '^[0-9]+$'
       OR COALESCE(c->>'denomination_id', '') = ''
  ) THEN
    RAISE EXCEPTION 'Las cantidades deben ser números enteros mayores o iguales a 0';
  END IF;

  PERFORM public.ensure_branch_auxiliary_cash(p_branch_id);

  INSERT INTO public.branch_auxiliary_cash_denoms (branch_id, denomination_id, qty, is_enabled)
  SELECT p_branch_id, (c->>'denomination_id')::uuid, 0, true
  FROM jsonb_array_elements(p_conteos) c
  ON CONFLICT (branch_id, denomination_id) DO NOTHING;

  PERFORM 1
  FROM public.branch_auxiliary_cash_denoms bacd
  WHERE bacd.branch_id = p_branch_id
  ORDER BY bacd.denomination_id
  FOR UPDATE;

  WITH nuevos AS (
    SELECT DISTINCT ON ((c->>'denomination_id')::uuid)
      (c->>'denomination_id')::uuid AS denomination_id,
      (c->>'qty')::int AS qty,
      COALESCE((c->>'is_enabled')::boolean, true) AS is_enabled
    FROM jsonb_array_elements(p_conteos) c
  ),
  comparado AS (
    SELECT d.id, d.label, d.denomination_type, d.value,
           bacd.qty AS qty_antes, n.qty AS qty_despues,
           bacd.is_enabled AS habilitada_antes, n.is_enabled AS habilitada_despues
    FROM nuevos n
    JOIN public.branch_auxiliary_cash_denoms bacd
      ON bacd.branch_id = p_branch_id AND bacd.denomination_id = n.denomination_id
    JOIN public.denominations d ON d.id = n.denomination_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'denomination_id', id,
      'label', label,
      'tipo', denomination_type,
      'valor', value,
      'qty_antes', qty_antes,
      'qty_despues', qty_despues,
      'habilitada_antes', habilitada_antes,
      'habilitada_despues', habilitada_despues
    ) ORDER BY denomination_type DESC, value DESC)
      FILTER (WHERE qty_antes <> qty_despues OR habilitada_antes <> habilitada_despues), '[]'::jsonb)
  INTO v_detalle
  FROM comparado;

  IF jsonb_array_length(v_detalle) = 0 THEN
    RETURN NULL;
  END IF;

  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo del ajuste (mínimo 3 caracteres)';
  END IF;

  SELECT COALESCE(SUM(bacd.qty * d.value), 0)
  INTO v_total_antes
  FROM public.branch_auxiliary_cash_denoms bacd
  JOIN public.denominations d ON d.id = bacd.denomination_id
  WHERE bacd.branch_id = p_branch_id AND bacd.is_enabled;

  UPDATE public.branch_auxiliary_cash_denoms bacd
  SET qty = n.qty,
      is_enabled = n.is_enabled,
      updated_at = now()
  FROM (
    SELECT DISTINCT ON ((c->>'denomination_id')::uuid)
      (c->>'denomination_id')::uuid AS denomination_id,
      (c->>'qty')::int AS qty,
      COALESCE((c->>'is_enabled')::boolean, true) AS is_enabled
    FROM jsonb_array_elements(p_conteos) c
  ) n
  WHERE bacd.branch_id = p_branch_id
    AND bacd.denomination_id = n.denomination_id
    AND (bacd.qty <> n.qty OR bacd.is_enabled <> n.is_enabled);

  SELECT COALESCE(SUM(bacd.qty * d.value), 0)
  INTO v_total_despues
  FROM public.branch_auxiliary_cash_denoms bacd
  JOIN public.denominations d ON d.id = bacd.denomination_id
  WHERE bacd.branch_id = p_branch_id AND bacd.is_enabled;

  UPDATE public.branch_auxiliary_cash
  SET updated_at = now(),
      updated_by = v_actor
  WHERE branch_id = p_branch_id;

  INSERT INTO public.ajustes_caja_auxiliar (
    branch_id, tipo, motivo, detalle, total_antes, total_despues, ajustado_por
  )
  VALUES (
    p_branch_id, v_tipo, v_motivo, v_detalle, v_total_antes, v_total_despues, v_actor
  )
  RETURNING id INTO v_ajuste_id;

  RETURN v_ajuste_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_ajuste_caja_auxiliar(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_ajuste_caja_auxiliar(uuid, jsonb, text, text) TO authenticated;
