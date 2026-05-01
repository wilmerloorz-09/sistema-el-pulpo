ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_workflow_mode_chk;

ALTER TABLE public.branches
  ALTER COLUMN workflow_mode SET DEFAULT 'CASH_THEN_DISPATCH';

UPDATE public.branches
SET workflow_mode = 'CASH_THEN_DISPATCH'
WHERE workflow_mode IS DISTINCT FROM 'CASH_THEN_DISPATCH';

ALTER TABLE public.branches
  ADD CONSTRAINT branches_workflow_mode_chk
  CHECK (workflow_mode = 'CASH_THEN_DISPATCH');
