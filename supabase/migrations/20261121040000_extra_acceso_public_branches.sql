-- Listado público (anon) de sucursales con turno OPEN para /extra-acceso.

CREATE OR REPLACE FUNCTION public.list_extra_acceso_open_branches()
RETURNS TABLE (
  id uuid,
  nombre text,
  codigo text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    b.id,
    b.name::text AS nombre,
    COALESCE(b.branch_code, b.display_code)::text AS codigo
  FROM public.branches b
  WHERE b.is_active IS TRUE
    AND EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.branch_id = b.id
        AND cs.status = 'OPEN'
    )
  ORDER BY b.name;
$$;

CREATE OR REPLACE FUNCTION public.extra_acceso_branch_has_packer(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.cash_shift_users csu
      ON csu.shift_id = cs.id
    WHERE cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
      AND csu.is_enabled IS TRUE
      AND csu.can_pack_orders IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.list_extra_acceso_open_branches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extra_acceso_branch_has_packer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_extra_acceso_open_branches() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_acceso_branch_has_packer(uuid) TO anon, authenticated;
