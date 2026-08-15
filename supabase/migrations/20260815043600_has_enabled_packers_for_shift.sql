-- Detectar si el turno tiene al menos un Empaquetador habilitado.
CREATE OR REPLACE FUNCTION public.has_enabled_packers_for_shift(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shift_users csu
    WHERE csu.shift_id = p_shift_id
      AND csu.is_enabled IS TRUE
      AND csu.can_pack_orders IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.has_enabled_packers_for_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_enabled_packers_for_shift(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
