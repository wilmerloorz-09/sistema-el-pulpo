ALTER TABLE public.branches
ADD COLUMN IF NOT EXISTS workflow_mode text NOT NULL DEFAULT 'DISPATCH_THEN_CASH';

UPDATE public.branches
SET workflow_mode = 'DISPATCH_THEN_CASH'
WHERE workflow_mode IS NULL
   OR workflow_mode NOT IN ('DISPATCH_THEN_CASH', 'CASH_THEN_DISPATCH');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branches_workflow_mode_chk'
      AND conrelid = 'public.branches'::regclass
  ) THEN
    ALTER TABLE public.branches
    ADD CONSTRAINT branches_workflow_mode_chk
    CHECK (workflow_mode IN ('DISPATCH_THEN_CASH', 'CASH_THEN_DISPATCH'));
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
