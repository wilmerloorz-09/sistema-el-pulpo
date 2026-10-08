-- Aprobación de cierres de caja: cada cierre queda PENDIENTE hasta que el administrador general
-- lo revisa (puede corregir las cantidades contadas) y lo aprueba desde "Cierres de caja".

ALTER TABLE public.cash_register_openings
  ADD COLUMN IF NOT EXISTS aprobacion_estado text NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS aprobado_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS aprobado_en timestamptz;

ALTER TABLE public.cash_register_openings
  DROP CONSTRAINT IF EXISTS cash_register_openings_aprobacion_estado_chk;
ALTER TABLE public.cash_register_openings
  ADD CONSTRAINT cash_register_openings_aprobacion_estado_chk
  CHECK (aprobacion_estado IN ('PENDIENTE', 'APROBADO'));

COMMENT ON COLUMN public.cash_register_openings.aprobacion_estado IS
  'PENDIENTE al cerrar la caja; APROBADO cuando el administrador general revisa el conteo.';

-- Los cierres existentes se consideran aprobados (sin aprobador registrado).
UPDATE public.cash_register_openings
SET aprobacion_estado = 'APROBADO'
WHERE status = 'cerrada'
  AND aprobacion_estado <> 'APROBADO';

-- Todo cierre (normal, forzado o por limpieza de turno) vuelve a quedar pendiente.
CREATE OR REPLACE FUNCTION public.cash_register_openings_reiniciar_aprobacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cerrada' AND OLD.status IS DISTINCT FROM 'cerrada' THEN
    NEW.aprobacion_estado := 'PENDIENTE';
    NEW.aprobado_por := NULL;
    NEW.aprobado_en := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cash_register_openings_reiniciar_aprobacion ON public.cash_register_openings;
CREATE TRIGGER trg_cash_register_openings_reiniciar_aprobacion
BEFORE UPDATE OF status ON public.cash_register_openings
FOR EACH ROW
EXECUTE FUNCTION public.cash_register_openings_reiniciar_aprobacion();

CREATE OR REPLACE FUNCTION public.puede_aprobar_cierres_caja(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_global_admin(COALESCE(p_user_id, auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_roles ubr
      INNER JOIN public.roles r ON r.id = ubr.role_id AND r.is_active = true
      INNER JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.access_level = 'MANAGE'
      INNER JOIN public.modules m ON m.id = rp.module_id AND m.code = 'admin_global'
      WHERE ubr.user_id = COALESCE(p_user_id, auth.uid())
        AND ubr.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_global_roles ugr
      INNER JOIN public.roles r ON r.id = ugr.role_id AND r.is_active = true
      INNER JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.access_level = 'MANAGE'
      INNER JOIN public.modules m ON m.id = rp.module_id AND m.code = 'admin_global'
      WHERE ugr.user_id = COALESCE(p_user_id, auth.uid())
        AND ugr.is_active = true
    );
$function$;

REVOKE ALL ON FUNCTION public.puede_aprobar_cierres_caja(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.puede_aprobar_cierres_caja(uuid) TO authenticated;

-- p_conteos: [{ denomination_id, qty_system, qty_counted }]. La cantidad del sistema ya guardada no se modifica.
CREATE OR REPLACE FUNCTION public.aprobar_cierre_caja(p_apertura_id uuid, p_conteos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_apertura public.cash_register_openings%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.puede_aprobar_cierres_caja(v_actor) THEN
    RAISE EXCEPTION 'Solo el administrador general puede aprobar cierres de caja';
  END IF;

  SELECT * INTO v_apertura
  FROM public.cash_register_openings
  WHERE id = p_apertura_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cierre de caja no encontrado';
  END IF;
  IF v_apertura.status <> 'cerrada' THEN
    RAISE EXCEPTION 'La caja aún no está cerrada';
  END IF;
  IF v_apertura.aprobacion_estado = 'APROBADO' THEN
    RAISE EXCEPTION 'Este cierre de caja ya fue aprobado';
  END IF;

  IF p_conteos IS NULL OR jsonb_typeof(p_conteos) <> 'array' THEN
    RAISE EXCEPTION 'El conteo de cierre es obligatorio';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_conteos) AS c
    WHERE COALESCE(c->>'qty_counted', '') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'Las cantidades contadas deben ser números enteros mayores o iguales a 0';
  END IF;

  INSERT INTO public.conteos_cierre_caja (
    apertura_id, turno_id, sucursal_id, denominacion_id,
    denominacion_nombre, denominacion_tipo, denominacion_valor,
    cantidad_sistema, cantidad_contada, registrado_por
  )
  SELECT
    v_apertura.id, v_apertura.shift_id, v_apertura.branch_id, d.id,
    d.label, d.denomination_type, d.value,
    agg.qty_system, agg.qty_counted, v_actor
  FROM (
    SELECT
      (c->>'denomination_id')::uuid AS denomination_id,
      SUM(GREATEST(0, COALESCE((c->>'qty_system')::int, 0)))::int AS qty_system,
      SUM((c->>'qty_counted')::int)::int AS qty_counted
    FROM jsonb_array_elements(p_conteos) AS c
    GROUP BY (c->>'denomination_id')::uuid
  ) agg
  JOIN public.denominations d ON d.id = agg.denomination_id
  ON CONFLICT (apertura_id, denominacion_id) DO UPDATE
    SET cantidad_contada = EXCLUDED.cantidad_contada;

  UPDATE public.cash_register_openings
  SET aprobacion_estado = 'APROBADO',
      aprobado_por = v_actor,
      aprobado_en = now()
  WHERE id = v_apertura.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.aprobar_cierre_caja(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprobar_cierre_caja(uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer);

CREATE FUNCTION public.list_closed_cash_register_openings(p_branch_id uuid, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 150)
 RETURNS TABLE(id uuid, shift_id uuid, branch_id uuid, cashier_id uuid, cashier_name text, cashier_username text, opened_at timestamp with time zone, closed_at timestamp with time zone, initial_total numeric, final_total numeric, collected_total numeric, notes text, shift_number integer, shift_code text, shift_opened_at timestamp with time zone, shift_status text, aprobacion_estado text, aprobado_por_nombre text, aprobado_en timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 150), 500));
BEGIN
  SET LOCAL statement_timeout = '30s';

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'El rango de fechas es obligatorio';
  END IF;
  IF p_desde > p_hasta THEN
    RAISE EXCEPTION 'El rango de fechas es invalido';
  END IF;

  IF NOT public.can_view_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'Solo administradores pueden consultar cierres de caja historicos';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      cro.id,
      cro.shift_id,
      cro.branch_id,
      cro.cashier_id,
      cro.opened_at,
      cro.closed_at,
      cro.initial_total,
      cro.notes,
      cro.aprobacion_estado,
      cro.aprobado_por,
      cro.aprobado_en,
      cs.shift_number,
      cs.shift_code,
      cs.opened_at AS shift_opened_at,
      cs.status::text AS shift_status,
      COALESCE(NULLIF(TRIM(cashier.full_name), ''), cashier.alias, cashier.username, 'Sin nombre')::text AS cashier_name,
      COALESCE(cashier.username, cashier.alias, '')::text AS cashier_username
    FROM public.cash_register_openings cro
    JOIN public.cash_shifts cs
      ON cs.id = cro.shift_id
    JOIN public.profiles cashier
      ON cashier.id = cro.cashier_id
    WHERE cro.branch_id = p_branch_id
      AND cro.status = 'cerrada'
      AND cro.closed_at IS NOT NULL
      AND (
        (cro.opened_at >= p_desde AND cro.opened_at <= p_hasta)
        OR (cro.closed_at >= p_desde AND cro.closed_at <= p_hasta)
      )
      AND (p_shift_id IS NULL OR cro.shift_id = p_shift_id)
      AND (p_cashier_id IS NULL OR cro.cashier_id = p_cashier_id)
      -- Excluir ruido de auto-cierre admin sin cobros (rápido por notes)
      AND COALESCE(cro.notes, '') NOT ILIKE '%Auto-cierre: admin sin cobros%'
    ORDER BY cro.closed_at DESC, cro.opened_at DESC
    LIMIT (v_limit * 3)
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    WHERE NOT (
      public.can_manage_branch_admin(c.cashier_id, c.branch_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.cash_shift_users csu
        WHERE csu.shift_id = c.shift_id
          AND csu.user_id = c.cashier_id
          AND csu.is_enabled = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.shift_id = c.shift_id
          AND p.created_by = c.cashier_id
          AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
          AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
          AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
        LIMIT 1
      )
    )
    ORDER BY c.closed_at DESC, c.opened_at DESC
    LIMIT v_limit
  ),
  pay_totals AS (
    SELECT
      f.id AS opening_id,
      COALESCE(SUM(p.amount), 0)::numeric AS collected_total,
      COALESCE(SUM(p.amount) FILTER (
        WHERE lower(btrim(COALESCE(pm.name, ''))) = 'efectivo'
      ), 0)::numeric AS cash_total
    FROM filtered f
    LEFT JOIN public.payments p
      ON p.shift_id = f.shift_id
     AND p.created_by = f.cashier_id
     AND p.created_at >= f.opened_at
     AND p.created_at <= f.closed_at
     AND lower(COALESCE(p.status, '')) NOT IN ('voided', 'reversed')
     AND COALESCE(p.notes, '') NOT ILIKE '%VOIDED:%'
     AND COALESCE(p.notes, '') NOT ILIKE '%REVERSED:%'
    LEFT JOIN public.payment_methods pm
      ON pm.id = p.payment_method_id
    GROUP BY f.id
  ),
  mov_totals AS (
    SELECT
      f.id AS opening_id,
      COALESCE(SUM(
        CASE
          WHEN crm.movement_type = 'entrada' THEN crm.amount
          WHEN crm.movement_type = 'salida' THEN -crm.amount
          ELSE 0
        END
      ), 0)::numeric AS movement_net
    FROM filtered f
    LEFT JOIN public.cash_register_movements crm
      ON crm.shift_id = f.shift_id
     AND crm.recorded_by = f.cashier_id
     AND crm.created_at >= f.opened_at
     AND crm.created_at <= f.closed_at
    GROUP BY f.id
  )
  SELECT
    f.id,
    f.shift_id,
    f.branch_id,
    f.cashier_id,
    f.cashier_name,
    f.cashier_username,
    f.opened_at,
    f.closed_at,
    f.initial_total,
    (
      f.initial_total
      + COALESCE(pt.cash_total, 0)
      + COALESCE(mt.movement_net, 0)
    ) AS final_total,
    COALESCE(pt.collected_total, 0) AS collected_total,
    f.notes,
    f.shift_number,
    f.shift_code,
    f.shift_opened_at,
    f.shift_status,
    f.aprobacion_estado,
    CASE
      WHEN approver.id IS NULL THEN NULL
      ELSE COALESCE(NULLIF(TRIM(approver.full_name), ''), approver.alias, approver.username)::text
    END AS aprobado_por_nombre,
    f.aprobado_en
  FROM filtered f
  LEFT JOIN pay_totals pt ON pt.opening_id = f.id
  LEFT JOIN mov_totals mt ON mt.opening_id = f.id
  LEFT JOIN public.profiles approver ON approver.id = f.aprobado_por
  ORDER BY f.closed_at DESC, f.opened_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_closed_cash_register_openings(uuid, timestamptz, timestamptz, uuid, uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
