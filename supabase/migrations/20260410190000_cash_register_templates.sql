CREATE TABLE IF NOT EXISTS public.cash_register_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_register_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT cash_register_templates_branch_name_unique UNIQUE (branch_id, name)
);

CREATE TABLE IF NOT EXISTS public.cash_register_template_denoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.cash_register_templates(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.denominations(id) ON DELETE RESTRICT,
  qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_register_template_denoms_qty_non_negative CHECK (qty >= 0),
  CONSTRAINT cash_register_template_denoms_unique UNIQUE (template_id, denomination_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_register_templates_branch_id
  ON public.cash_register_templates(branch_id);

CREATE INDEX IF NOT EXISTS idx_cash_register_template_denoms_template_id
  ON public.cash_register_template_denoms(template_id);

DROP TRIGGER IF EXISTS update_cash_register_templates_updated_at ON public.cash_register_templates;
CREATE TRIGGER update_cash_register_templates_updated_at
BEFORE UPDATE ON public.cash_register_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cash_register_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_register_template_denoms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view cash register templates by branch permission" ON public.cash_register_templates;
CREATE POLICY "Users can view cash register templates by branch permission"
ON public.cash_register_templates
FOR SELECT
TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Users can insert cash register templates by branch permission" ON public.cash_register_templates;
CREATE POLICY "Users can insert cash register templates by branch permission"
ON public.cash_register_templates
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Users can update cash register templates by branch permission" ON public.cash_register_templates;
CREATE POLICY "Users can update cash register templates by branch permission"
ON public.cash_register_templates
FOR UPDATE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Users can delete cash register templates by branch permission" ON public.cash_register_templates;
CREATE POLICY "Users can delete cash register templates by branch permission"
ON public.cash_register_templates
FOR DELETE
TO authenticated
USING (public.can_manage_branch_admin(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Users can view cash register template denoms by branch permission" ON public.cash_register_template_denoms;
CREATE POLICY "Users can view cash register template denoms by branch permission"
ON public.cash_register_template_denoms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND (
        public.can_operate_cash_branch(auth.uid(), crt.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), crt.branch_id)
      )
  )
);

DROP POLICY IF EXISTS "Users can insert cash register template denoms by branch permission" ON public.cash_register_template_denoms;
CREATE POLICY "Users can insert cash register template denoms by branch permission"
ON public.cash_register_template_denoms
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND public.can_manage_branch_admin(auth.uid(), crt.branch_id)
  )
);

DROP POLICY IF EXISTS "Users can update cash register template denoms by branch permission" ON public.cash_register_template_denoms;
CREATE POLICY "Users can update cash register template denoms by branch permission"
ON public.cash_register_template_denoms
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND public.can_manage_branch_admin(auth.uid(), crt.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND public.can_manage_branch_admin(auth.uid(), crt.branch_id)
  )
);

DROP POLICY IF EXISTS "Users can delete cash register template denoms by branch permission" ON public.cash_register_template_denoms;
CREATE POLICY "Users can delete cash register template denoms by branch permission"
ON public.cash_register_template_denoms
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_register_templates crt
    WHERE crt.id = cash_register_template_denoms.template_id
      AND public.can_manage_branch_admin(auth.uid(), crt.branch_id)
  )
);
