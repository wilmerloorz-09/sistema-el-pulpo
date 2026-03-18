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
  v_caja_status public.caja_status;
  v_tipo text := lower(NULLIF(btrim(COALESCE(p_tipo, '')), ''));
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_inserted_id uuid;
  v_from_total numeric := 0;
  v_to_total numeric := 0;
  v_entry jsonb;
  v_denomination_id uuid;
  v_qty integer;
BEGIN
  IF p_turno_id IS NULL THEN
    RAISE EXCEPTION 'turno_id es obligatorio';
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

  SELECT cs.branch_id, cs.status, cs.caja_status
  INTO v_branch_id, v_shift_status, v_caja_status
  FROM public.cash_shifts AS cs
  WHERE cs.id = p_turno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno de caja solicitado';
  END IF;

  IF v_shift_status <> 'OPEN' OR v_caja_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Solo puedes registrar movimientos con una caja abierta';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), v_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users AS csu
      WHERE csu.shift_id = p_turno_id
        AND csu.user_id = auth.uid()
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

    SELECT COALESCE(SUM(COALESCE((entry.value ->> 'total')::numeric, 0)), 0)
    INTO v_from_total
    FROM jsonb_array_elements(COALESCE(p_detail -> 'from', '[]'::jsonb)) AS entry(value);

    SELECT COALESCE(SUM(COALESCE((entry.value ->> 'total')::numeric, 0)), 0)
    INTO v_to_total
    FROM jsonb_array_elements(COALESCE(p_detail -> 'to', '[]'::jsonb)) AS entry(value);

    IF v_from_total <= 0 OR v_to_total <= 0 THEN
      RAISE EXCEPTION 'El detalle del cambio debe incluir denominaciones que salen y entran a caja';
    END IF;

    IF ABS(v_from_total - p_monto) > 0.01 OR ABS(v_to_total - p_monto) > 0.01 THEN
      RAISE EXCEPTION 'El detalle del cambio no cuadra con el monto registrado';
    END IF;

    FOR v_entry IN
      SELECT entry.value
      FROM jsonb_array_elements(COALESCE(p_detail -> 'from', '[]'::jsonb)) AS entry(value)
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.cash_shift_denoms AS csd
      SET qty_current = csd.qty_current - v_qty
      WHERE csd.shift_id = p_turno_id
        AND csd.denomination_id = v_denomination_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La denominacion que quieres cambiar no existe en la caja actual';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.cash_shift_denoms AS csd
        WHERE csd.shift_id = p_turno_id
          AND csd.denomination_id = v_denomination_id
          AND csd.qty_current < 0
      ) THEN
        RAISE EXCEPTION 'No hay suficientes unidades en caja para cambiar la denominacion seleccionada';
      END IF;
    END LOOP;

    FOR v_entry IN
      SELECT entry.value
      FROM jsonb_array_elements(COALESCE(p_detail -> 'to', '[]'::jsonb)) AS entry(value)
    LOOP
      v_denomination_id := NULLIF(v_entry ->> 'denomination_id', '')::uuid;
      v_qty := GREATEST(COALESCE((v_entry ->> 'qty')::integer, 0), 0);

      IF v_denomination_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.cash_shift_denoms AS csd
      SET qty_current = csd.qty_current + v_qty
      WHERE csd.shift_id = p_turno_id
        AND csd.denomination_id = v_denomination_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La denominacion que ingresa no existe en la caja actual';
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
    ROUND(p_monto::numeric, 2),
    v_motivo,
    p_detail,
    auth.uid()
  )
  RETURNING cash_register_movements.id
  INTO v_inserted_id;

  RETURN QUERY
  SELECT
    crm.id,
    crm.shift_id,
    crm.branch_id,
    crm.movement_type,
    crm.amount,
    crm.reason,
    crm.movement_detail,
    crm.recorded_by,
    recorder.full_name AS recorded_by_name,
    recorder.username AS recorded_by_username,
    crm.created_at
  FROM public.cash_register_movements AS crm
  JOIN public.profiles AS recorder
    ON recorder.id = crm.recorded_by
  WHERE crm.id = v_inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja(uuid, text, numeric, text, jsonb) TO authenticated;
