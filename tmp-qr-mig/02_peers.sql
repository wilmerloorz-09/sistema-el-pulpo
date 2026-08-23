CREATE OR REPLACE FUNCTION public.qr_shared_peer_branch_ids(p_branch_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH mine AS (
    SELECT b.id, b.qr_shared_group
    FROM public.branches b
    WHERE b.id = p_branch_id
  )
  SELECT COALESCE(
    (
      SELECT array_agg(b.id ORDER BY b.name)
      FROM public.branches b
      CROSS JOIN mine m
      WHERE m.qr_shared_group IS NOT NULL
        AND b.qr_shared_group = m.qr_shared_group
        AND COALESCE(b.is_active, true) = true
    ),
    ARRAY[p_branch_id]::uuid[]
  );
$fn$;

REVOKE ALL ON FUNCTION public.qr_shared_peer_branch_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_shared_peer_branch_ids(uuid) TO anon, authenticated;
