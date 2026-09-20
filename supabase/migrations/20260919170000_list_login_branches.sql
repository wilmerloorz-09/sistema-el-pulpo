-- Sucursales visibles en la pantalla de login (antes de autenticarse).

CREATE OR REPLACE FUNCTION public.list_login_branches()
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name
  FROM public.branches b
  WHERE b.is_active = true
  ORDER BY b.name ASC;
$$;

REVOKE ALL ON FUNCTION public.list_login_branches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_login_branches() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
