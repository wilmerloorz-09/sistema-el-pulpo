-- Modifier assignments by menu node

CREATE TABLE IF NOT EXISTS public.menu_node_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.menu_nodes(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.modifiers(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, modifier_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_node_modifiers_node
  ON public.menu_node_modifiers(node_id, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_menu_node_modifiers_modifier
  ON public.menu_node_modifiers(modifier_id);

DROP TRIGGER IF EXISTS update_menu_node_modifiers_updated_at ON public.menu_node_modifiers;
CREATE TRIGGER update_menu_node_modifiers_updated_at
BEFORE UPDATE ON public.menu_node_modifiers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.menu_node_modifiers (
  node_id,
  modifier_id,
  is_active,
  display_order,
  created_at,
  updated_at
)
SELECT
  sm.subcategory_id,
  sm.modifier_id,
  sm.is_active,
  COALESCE(sm.display_order, 0),
  COALESCE(sm.created_at, now()),
  COALESCE(sm.updated_at, now())
FROM public.subcategory_modifiers sm
JOIN public.menu_nodes mn ON mn.id = sm.subcategory_id
ON CONFLICT (node_id, modifier_id) DO UPDATE
SET
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE public.menu_node_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view menu node modifiers" ON public.menu_node_modifiers;
CREATE POLICY "Users can view menu node modifiers"
ON public.menu_node_modifiers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = menu_node_modifiers.node_id
      AND (
        public.is_global_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.active_branch_id = mn.branch_id
        )
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'admin_sucursal', 'VIEW'::public.access_level)
        OR public.has_branch_permission(auth.uid(), mn.branch_id, 'mesas', 'VIEW'::public.access_level)
      )
  )
);

DROP POLICY IF EXISTS "Users can manage menu node modifiers" ON public.menu_node_modifiers;
CREATE POLICY "Users can manage menu node modifiers"
ON public.menu_node_modifiers
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = menu_node_modifiers.node_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = menu_node_modifiers.node_id
      AND public.can_manage_branch_admin(auth.uid(), mn.branch_id)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_node_modifiers TO authenticated;
