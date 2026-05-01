ALTER TABLE public.branches
  ALTER COLUMN workflow_mode SET DEFAULT 'DISPATCH_THEN_CASH';

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_workflow_mode_chk;

ALTER TABLE public.branches
  ADD CONSTRAINT branches_workflow_mode_chk
  CHECK (workflow_mode IN ('DISPATCH_THEN_CASH', 'CASH_THEN_DISPATCH'));
