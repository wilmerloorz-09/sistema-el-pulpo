ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS qr_shared_group text;
COMMENT ON COLUMN public.branches.qr_shared_group IS
  ''Si dos o mas sucursales comparten el mismo valor, sus QR de mesa son intercambiables.'';
CREATE INDEX IF NOT EXISTS idx_branches_qr_shared_group
  ON public.branches (qr_shared_group)
  WHERE qr_shared_group IS NOT NULL;
UPDATE public.branches
SET qr_shared_group = ''el-pulpo-1'', updated_at = now()
WHERE branch_code IN (''P1M'', ''P1T'')
   OR name ILIKE ''El Pulpo 1%Mañana%''
   OR name ILIKE ''El Pulpo 1%Manana%''
   OR name ILIKE ''El Pulpo 1%Tarde%'';
