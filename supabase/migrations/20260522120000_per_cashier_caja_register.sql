-- Cada cajero habilitado abre su propia caja (apertura + denominaciones) dentro del mismo turno.

ALTER TABLE public.cash_shift_denoms
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS opening_id uuid REFERENCES public.cash_register_openings(id) ON DELETE CASCADE;

UPDATE public.cash_shift_denoms csd
SET
  cashier_id = COALESCE(
    csd.cashier_id,
    (
      SELECT cro.cashier_id
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = csd.shift_id
        AND cro.status = 'abierta'
      ORDER BY cro.opened_at DESC
      LIMIT 1
    ),
    (SELECT cs.cashier_id FROM public.cash_shifts cs WHERE cs.id = csd.shift_id)
  ),
  opening_id = COALESCE(
    csd.opening_id,
    (
      SELECT cro.id
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = csd.shift_id
        AND cro.status = 'abierta'
      ORDER BY cro.opened_at DESC
      LIMIT 1
    )
  )
WHERE csd.cashier_id IS NULL;

ALTER TABLE public.cash_shift_denoms
  DROP CONSTRAINT IF EXISTS cash_shift_denoms_shift_id_denomination_id_key;

DROP INDEX IF EXISTS public.cash_shift_denoms_shift_id_denomination_id_key;
DROP INDEX IF EXISTS public.ux_cash_shift_denoms_shift_denom;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_shift_denoms_per_cashier
  ON public.cash_shift_denoms (shift_id, cashier_id, denomination_id)
  WHERE cashier_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_cash_register_openings_one_open_per_shift;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_openings_one_open_per_cashier
  ON public.cash_register_openings (shift_id, cashier_id)
  WHERE status = 'abierta';

CREATE OR REPLACE FUNCTION public.sync_shift_caja_status_from_openings(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.cash_shifts cs
  SET caja_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = p_shift_id
        AND cro.status = 'abierta'
    ) THEN 'OPEN'::public.caja_status
    WHEN EXISTS (
      SELECT 1
      FROM public.cash_register_openings cro
      WHERE cro.shift_id = p_shift_id
        AND cro.status = 'cerrada'
    ) THEN 'CLOSED'::public.caja_status
    ELSE 'UNOPENED'::public.caja_status
  END
  WHERE cs.id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_caja_status(
  p_shift_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS public.caja_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN cro.status = 'abierta' THEN 'OPEN'::public.caja_status
    WHEN cro.status = 'cerrada' THEN 'CLOSED'::public.caja_status
    ELSE 'UNOPENED'::public.caja_status
  END
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_user_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;
$$;

-- RETURNS cambió de void a uuid; REPLACE no permite cambiar el tipo de retorno.
DROP FUNCTION IF EXISTS public.open_cash_register(uuid, uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_denoms jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_opening_id uuid := gen_random_uuid();
  v_initial_total numeric(12,2) := 0;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes abrir caja con tu propio usuario autenticado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shift_users
    WHERE shift_id = p_shift_id
      AND user_id = p_cashier_id
      AND is_enabled = true
      AND can_use_caja = true
  ) THEN
    RAISE EXCEPTION 'Tu usuario debe estar habilitado con permiso de Caja en este turno para abrir caja.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto valido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = p_cashier_id
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una caja abierta en este turno. Cierrala antes de abrir otra apertura.';
  END IF;

  INSERT INTO public.cash_register_openings (
    id,
    shift_id,
    branch_id,
    cashier_id,
    status,
    opened_at,
    initial_total
  )
  VALUES (
    v_opening_id,
    p_shift_id,
    p_branch_id,
    p_cashier_id,
    'abierta',
    now(),
    0
  );

  IF COALESCE(jsonb_array_length(COALESCE(p_denoms, '[]'::jsonb)), 0) = 0 THEN
    INSERT INTO public.cash_shift_denoms (
      id,
      shift_id,
      cashier_id,
      opening_id,
      denomination_id,
      qty_initial,
      qty_current
    )
    SELECT
      gen_random_uuid(),
      p_shift_id,
      p_cashier_id,
      v_opening_id,
      d.id,
      0,
      0
    FROM public.denominations d
    WHERE d.is_active = true;
  ELSE
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_denoms, '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.cash_shift_denoms (
        id,
        shift_id,
        cashier_id,
        opening_id,
        denomination_id,
        qty_initial,
        qty_current
      )
      VALUES (
        gen_random_uuid(),
        p_shift_id,
        p_cashier_id,
        v_opening_id,
        v_denomination_id,
        v_qty,
        v_qty
      );
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(COALESCE(d.value, 0) * COALESCE(csd.qty_initial, 0)), 0)
  INTO v_initial_total
  FROM public.cash_shift_denoms csd
  JOIN public.denominations d
    ON d.id = csd.denomination_id
  WHERE csd.shift_id = p_shift_id
    AND csd.cashier_id = p_cashier_id
    AND csd.opening_id = v_opening_id;

  UPDATE public.cash_register_openings
  SET initial_total = v_initial_total
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);

  RETURN v_opening_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening_id uuid;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_cashier_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_cashier_id
    AND cro.status = 'abierta'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una apertura de caja activa para cerrar';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$$;

-- Misma firma RETURNS TABLE que la version actual; no usar DROP (politicas RLS dependen de esta funcion).
CREATE OR REPLACE FUNCTION public.get_my_branch_shift_gate(
  p_branch_id uuid
)
RETURNS TABLE (
  shift_id uuid,
  shift_open boolean,
  user_enabled boolean,
  active_tables_count integer,
  caja_status public.caja_status,
  can_serve_tables boolean,
  can_access_orders boolean,
  can_dispatch_orders boolean,
  can_manage_products boolean,
  can_use_caja boolean,
  can_authorize_order_cancel boolean,
  is_supervisor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_active_tables_count integer := 0;
  v_user_caja_status public.caja_status := 'UNOPENED';
  v_user_row record;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT cs.id, COALESCE(cs.active_tables_count, 0)
  INTO v_shift_id, v_active_tables_count
  FROM public.cash_shifts cs
  WHERE cs.branch_id = p_branch_id
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 0, 'UNOPENED'::public.caja_status, false, false, false, false, false, false, false;
    RETURN;
  END IF;

  SELECT public.get_user_caja_status(v_shift_id, auth.uid())
  INTO v_user_caja_status;

  SELECT
    csu.is_enabled,
    csu.can_serve_tables,
    csu.can_access_orders,
    csu.can_dispatch_orders,
    csu.can_manage_products,
    csu.can_use_caja,
    csu.can_authorize_order_cancel,
    csu.is_supervisor
  INTO v_user_row
  FROM public.cash_shift_users csu
  WHERE csu.shift_id = v_shift_id
    AND csu.user_id = auth.uid();

  RETURN QUERY
  SELECT
    v_shift_id,
    true,
    COALESCE(v_user_row.is_enabled, false),
    v_active_tables_count,
    COALESCE(v_user_caja_status, 'UNOPENED'::public.caja_status),
    COALESCE(v_user_row.can_serve_tables, false),
    COALESCE(v_user_row.can_access_orders, COALESCE(v_user_row.can_serve_tables, false), false),
    COALESCE(v_user_row.can_dispatch_orders, false),
    COALESCE(v_user_row.can_manage_products, COALESCE(v_user_row.can_dispatch_orders, false), false),
    COALESCE(v_user_row.can_use_caja, false),
    COALESCE(v_user_row.can_authorize_order_cancel, false),
    COALESCE(v_user_row.is_supervisor, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_branch_shift_gate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_cash_register_openings(
  p_shift_id uuid
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  cashier_id uuid,
  cashier_name text,
  cashier_username text,
  opened_at timestamptz,
  closed_at timestamptz,
  initial_total numeric,
  notes text,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_por_username text,
  anulada_at timestamptz,
  motivo_anulacion text,
  is_current boolean,
  payment_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno solicitado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = auth.uid()
        AND csu.is_enabled = true
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para ver el historial de caja de este turno';
  END IF;

  RETURN QUERY
  SELECT
    cro.id,
    cro.shift_id,
    cro.status,
    cro.cashier_id,
    cashier.full_name AS cashier_name,
    cashier.username AS cashier_username,
    cro.opened_at,
    cro.closed_at,
    cro.initial_total,
    cro.notes,
    cro.anulada_por,
    annul.full_name AS anulada_por_nombre,
    annul.username AS anulada_por_username,
    cro.anulada_at,
    cro.motivo_anulacion,
    (cro.cashier_id = auth.uid() AND cro.status = 'abierta') AS is_current,
    (
      SELECT COUNT(*)::integer
      FROM public.payments p
      WHERE p.shift_id = p_shift_id
        AND p.created_by = cro.cashier_id
        AND p.created_at >= cro.opened_at
        AND (cro.closed_at IS NULL OR p.created_at <= cro.closed_at)
    ) AS payment_count
  FROM public.cash_register_openings cro
  JOIN public.profiles cashier
    ON cashier.id = cro.cashier_id
  LEFT JOIN public.profiles annul
    ON annul.id = cro.anulada_por
  WHERE cro.shift_id = p_shift_id
  ORDER BY cro.opened_at DESC, cro.created_at DESC;
END;
$$;

-- Movimientos de cobro / cambio: solo la caja del usuario autenticado.
CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja_operativo(
  p_shift_id uuid,
  p_movement_type public.cash_movement_type,
  p_qty_delta integer,
  p_payment_id uuid DEFAULT NULL,
  p_denomination_id uuid DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL
)
RETURNS public.cash_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_row public.cash_movements%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'shift_id es obligatorio';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion';
  END IF;

  IF p_qty_delta IS NULL OR p_qty_delta <= 0 THEN
    RAISE EXCEPTION 'qty_delta debe ser mayor a 0';
  END IF;

  SELECT cs.branch_id, cs.status
  INTO v_branch_id, v_shift_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF v_shift_status <> 'OPEN' THEN
    RAISE EXCEPTION 'El turno no esta abierto';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_shift_id
      AND cro.cashier_id = v_actor
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Debes abrir tu caja con tu arqueo inicial antes de registrar cobros';
  END IF;

  IF p_movement_type IN ('PAYMENT_IN', 'CHANGE_OUT') AND p_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment_id es obligatorio para este movimiento (PAYMENT_IN/CHANGE_OUT)';
  END IF;

  IF p_movement_type IN ('PAYMENT_IN', 'CHANGE_OUT') AND p_denomination_id IS NULL THEN
    RAISE EXCEPTION 'denomination_id es obligatorio para este movimiento';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = v_actor
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para registrar movimientos de cobro en esta caja';
  END IF;

  IF p_movement_type = 'PAYMENT_IN' THEN
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current + p_qty_delta
    WHERE csd.shift_id = p_shift_id
      AND csd.cashier_id = v_actor
      AND csd.denomination_id = p_denomination_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La denominacion recibida no existe en tu caja actual';
    END IF;
  ELSIF p_movement_type = 'CHANGE_OUT' THEN
    UPDATE public.cash_shift_denoms csd
    SET qty_current = csd.qty_current - p_qty_delta
    WHERE csd.shift_id = p_shift_id
      AND csd.cashier_id = v_actor
      AND csd.denomination_id = p_denomination_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La denominacion del cambio no existe en tu caja actual';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.cash_shift_denoms csd
      WHERE csd.shift_id = p_shift_id
        AND csd.cashier_id = v_actor
        AND csd.denomination_id = p_denomination_id
        AND csd.qty_current < 0
    ) THEN
      RAISE EXCEPTION 'No hay suficientes unidades en tu caja para entregar el cambio';
    END IF;
  END IF;

  INSERT INTO public.cash_movements (
    id,
    shift_id,
    movement_type,
    denomination_id,
    qty_delta,
    payment_id,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    p_shift_id,
    p_movement_type,
    p_denomination_id,
    p_qty_delta,
    p_payment_id,
    COALESCE(p_created_at, now())
  )
  RETURNING *
  INTO v_row;

  RETURN v_row;
END;
$$;

-- Entradas/salidas/cambio de denominacion en caja del usuario.
CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja(
  p_turno_id uuid,
  p_tipo text,
  p_monto numeric,
  p_motivo text,
  p_detail jsonb DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  branch_id uuid,
  movement_type text,
  amount numeric,
  reason text,
  movement_detail jsonb,
  recorded_by uuid,
  recorded_by_name text,
  recorded_by_username text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_shift_status public.cash_shift_status;
  v_tipo text := lower(NULLIF(btrim(COALESCE(p_tipo, '')), ''));
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_inserted_id uuid;
  v_from_total numeric := 0;
  v_to_total numeric := 0;
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
  v_actor uuid := auth.uid();
BEGIN
  IF p_turno_id IS NULL THEN
    RAISE EXCEPTION 'turno_id es obligatorio';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion';
  END IF;

  IF v_tipo IS NULL OR v_tipo NOT IN ('entrada', 'salida', 'cambio_denominacion') THEN
    RAISE EXCEPTION 'El tipo de movimiento no es valido';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para registrar el movimiento';
  END IF;

  SELECT cs.branch_id, cs.status
  INTO v_branch_id, v_shift_status
  FROM public.cash_shifts cs
  WHERE cs.id = p_turno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF v_shift_status <> 'OPEN' THEN
    RAISE EXCEPTION 'El turno no esta abierto';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_openings cro
    WHERE cro.shift_id = p_turno_id
      AND cro.cashier_id = v_actor
      AND cro.status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Debes abrir tu caja antes de registrar movimientos';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_turno_id
        AND csu.user_id = v_actor
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para registrar movimientos en esta caja';
  END IF;

  IF v_tipo = 'cambio_denominacion' THEN
    IF p_detail IS NULL THEN
      RAISE EXCEPTION 'Debes indicar el detalle de denominaciones del cambio';
    END IF;

    SELECT COALESCE(SUM(COALESCE((entry ->> 'total')::numeric, 0)), 0)
    INTO v_from_total
    FROM jsonb_array_elements(COALESCE(p_detail -> 'from', '[]'::jsonb)) AS entry;

    SELECT COALESCE(SUM(COALESCE((entry ->> 'total')::numeric, 0)), 0)
    INTO v_to_total
    FROM jsonb_array_elements(COALESCE(p_detail -> 'to', '[]'::jsonb)) AS entry;

    IF v_from_total <= 0 OR v_to_total <= 0 THEN
      RAISE EXCEPTION 'El detalle del cambio debe incluir denominaciones que salen y entran a caja';
    END IF;

    IF ABS(v_from_total - p_monto) > 0.01 OR ABS(v_to_total - p_monto) > 0.01 THEN
      RAISE EXCEPTION 'El detalle del cambio no cuadra con el monto registrado';
    END IF;

    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_detail -> 'from', '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.cash_shift_denoms
      SET qty_current = qty_current - v_qty
      WHERE shift_id = p_turno_id
        AND cashier_id = v_actor
        AND denomination_id = v_denomination_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La denominacion que quieres cambiar no existe en tu caja actual';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.cash_shift_denoms
        WHERE shift_id = p_turno_id
          AND cashier_id = v_actor
          AND denomination_id = v_denomination_id
          AND qty_current < 0
      ) THEN
        RAISE EXCEPTION 'No hay suficientes unidades en tu caja para cambiar la denominacion seleccionada';
      END IF;
    END LOOP;

    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_detail -> 'to', '[]'::jsonb))
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.cash_shift_denoms
      SET qty_current = qty_current + v_qty
      WHERE shift_id = p_turno_id
        AND cashier_id = v_actor
        AND denomination_id = v_denomination_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La denominacion que ingresa no existe en tu caja actual';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.cash_register_movements (
    shift_id,
    branch_id,
    movement_type,
    amount,
    reason,
    movement_detail,
    recorded_by
  )
  VALUES (
    p_turno_id,
    v_branch_id,
    v_tipo,
    p_monto,
    v_motivo,
    p_detail,
    v_actor
  )
  RETURNING public.cash_register_movements.id INTO v_inserted_id;

  RETURN QUERY
  SELECT
    m.id,
    m.shift_id,
    m.branch_id,
    m.movement_type,
    m.amount,
    m.reason,
    m.movement_detail,
    m.recorded_by,
    p.full_name,
    p.username,
    m.created_at
  FROM public.cash_register_movements m
  LEFT JOIN public.profiles p ON p.id = m.recorded_by
  WHERE m.id = v_inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_shift_caja_status_from_openings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_caja_status(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.annul_cash_opening(
  p_opening_id uuid,
  p_admin_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_branch_id uuid;
  v_cashier_id uuid;
  v_payment_count integer := 0;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_opening_id IS NULL THEN
    RAISE EXCEPTION 'opening_id es obligatorio';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de al menos 10 caracteres';
  END IF;

  SELECT cro.shift_id, cro.branch_id, cro.cashier_id
  INTO v_shift_id, v_branch_id, v_cashier_id
  FROM public.cash_register_openings cro
  WHERE cro.id = p_opening_id
    AND cro.status = 'abierta';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La apertura ya no esta disponible para anular';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para anular aperturas de caja en esta sucursal';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_payment_count
  FROM public.payments p
  WHERE p.shift_id = v_shift_id
    AND p.created_by = v_cashier_id
    AND p.created_at >= (
      SELECT cro.opened_at
      FROM public.cash_register_openings cro
      WHERE cro.id = p_opening_id
    );

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'No se puede anular la apertura porque existen cobros registrados en esta caja';
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'anulada',
      anulada_por = COALESCE(p_admin_id, auth.uid()),
      anulada_at = now(),
      motivo_anulacion = v_reason
  WHERE id = p_opening_id
    AND status = 'abierta';

  DELETE FROM public.cash_shift_denoms
  WHERE opening_id = p_opening_id
     OR (shift_id = v_shift_id AND cashier_id = v_cashier_id);

  PERFORM public.sync_shift_caja_status_from_openings(v_shift_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.annul_cash_opening(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
