ALTER TABLE public.cash_shift_users
ADD COLUMN IF NOT EXISTS can_edit_orders boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS can_double_session boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS secondary_session_id text;

UPDATE public.cash_shift_users
SET can_double_session = false
WHERE COALESCE(can_use_caja, false) = false
  AND COALESCE(can_double_session, false) = true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_shift_users_has_capability_chk'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
    DROP CONSTRAINT cash_shift_users_has_capability_chk;
  END IF;
END;
$$;

ALTER TABLE public.cash_shift_users
ADD CONSTRAINT cash_shift_users_has_capability_chk
CHECK (
  can_serve_tables = true OR
  can_access_orders = true OR
  can_edit_orders = true OR
  can_dispatch_orders = true OR
  can_manage_products = true OR
  can_use_caja = true OR
  can_authorize_order_cancel = true OR
  is_supervisor = true
);

CREATE OR REPLACE FUNCTION public.claim_cash_session_slot(
  p_shift_id uuid,
  p_session_id text
)
RETURNS TABLE (
  last_session_id text,
  secondary_session_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_shift_user public.cash_shift_users%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para tomar el control de Caja.';
  END IF;

  IF p_shift_id IS NULL OR NULLIF(BTRIM(COALESCE(p_session_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'El turno y la sesion son obligatorios.';
  END IF;

  SELECT *
  INTO v_shift_user
  FROM public.cash_shift_users
  WHERE shift_id = p_shift_id
    AND user_id = v_actor_id
    AND is_enabled = true
    AND can_use_caja = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu usuario no tiene permiso de Caja en este turno.';
  END IF;

  IF COALESCE(v_shift_user.can_double_session, false) THEN
    IF v_shift_user.last_session_id = p_session_id OR v_shift_user.secondary_session_id = p_session_id THEN
      NULL;
    ELSIF NULLIF(BTRIM(COALESCE(v_shift_user.last_session_id, '')), '') IS NULL THEN
      UPDATE public.cash_shift_users
      SET last_session_id = p_session_id
      WHERE id = v_shift_user.id;
    ELSIF NULLIF(BTRIM(COALESCE(v_shift_user.secondary_session_id, '')), '') IS NULL THEN
      UPDATE public.cash_shift_users
      SET secondary_session_id = p_session_id
      WHERE id = v_shift_user.id;
    ELSE
      RAISE EXCEPTION 'Este usuario ya tiene 2 sesiones activas en Caja para este turno.';
    END IF;
  ELSE
    UPDATE public.cash_shift_users
    SET last_session_id = p_session_id,
        secondary_session_id = NULL
    WHERE id = v_shift_user.id;
  END IF;

  RETURN QUERY
  SELECT
    csu.last_session_id,
    csu.secondary_session_id
  FROM public.cash_shift_users csu
  WHERE csu.id = v_shift_user.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_cash_session_slot(uuid, text) TO authenticated;
