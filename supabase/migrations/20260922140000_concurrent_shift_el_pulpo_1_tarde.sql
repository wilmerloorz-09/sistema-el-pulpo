-- Excepción de turno concurrente: pasar de Local Principal (pruebas) a El Pulpo 1 - Tarde (P1T).

CREATE OR REPLACE FUNCTION public.allows_concurrent_open_shift(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true
      AND (
        upper(COALESCE(b.branch_code, '')) = 'P1T'
        OR lower(b.name) = 'el pulpo 1 - tarde'
        OR lower(b.name) LIKE 'el pulpo 1 - tarde%'
      )
  );
$$;

COMMENT ON FUNCTION public.allows_concurrent_open_shift(uuid) IS
  'True solo para El Pulpo 1 - Tarde (P1T). Permite habilitar usuarios que ya tienen turno abierto en otra sucursal.';
