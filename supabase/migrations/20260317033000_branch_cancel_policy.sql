CREATE TABLE IF NOT EXISTS public.branch_cancel_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_node_id uuid NOT NULL REFERENCES public.menu_nodes(id) ON DELETE CASCADE,
  is_kitchen_plate boolean NOT NULL DEFAULT false,
  allow_direct_cancel boolean NOT NULL DEFAULT false,
  updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_branch_cancel_policy_branch_node UNIQUE (branch_id, menu_node_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_cancel_policy_branch_id
  ON public.branch_cancel_policy(branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_cancel_policy_menu_node_id
  ON public.branch_cancel_policy(menu_node_id);

CREATE OR REPLACE FUNCTION public.validate_branch_cancel_policy_node()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_node record;
BEGIN
  SELECT mn.id, mn.branch_id, mn.node_type
  INTO v_node
  FROM public.menu_nodes mn
  WHERE mn.id = NEW.menu_node_id;

  IF v_node.id IS NULL THEN
    RAISE EXCEPTION 'El nodo de menu indicado no existe';
  END IF;

  IF v_node.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'La politica debe pertenecer a la misma sucursal del nodo';
  END IF;

  IF v_node.node_type <> 'category' THEN
    RAISE EXCEPTION 'La politica de anulacion directa solo se puede configurar sobre categorias raiz';
  END IF;

  IF NEW.menu_node_id IS DISTINCT FROM v_node.id OR v_node.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Nodo invalido para la politica';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.menu_nodes parent
    WHERE parent.id = v_node.id
      AND (parent.depth <> 0 OR parent.parent_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'La politica de anulacion directa solo se puede configurar sobre categorias de nivel 0';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_branch_cancel_policy_node ON public.branch_cancel_policy;
CREATE TRIGGER trg_validate_branch_cancel_policy_node
BEFORE INSERT OR UPDATE OF branch_id, menu_node_id
ON public.branch_cancel_policy
FOR EACH ROW
EXECUTE FUNCTION public.validate_branch_cancel_policy_node();

DROP TRIGGER IF EXISTS update_branch_cancel_policy_updated_at ON public.branch_cancel_policy;
CREATE TRIGGER update_branch_cancel_policy_updated_at
BEFORE UPDATE ON public.branch_cancel_policy
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.branch_cancel_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branch cancel policy can be viewed by branch admins" ON public.branch_cancel_policy;
CREATE POLICY "Branch cancel policy can be viewed by branch admins"
ON public.branch_cancel_policy
FOR SELECT
TO authenticated
USING (
  public.can_manage_branch_admin(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Branch cancel policy can be managed directly by global admins" ON public.branch_cancel_policy;
CREATE POLICY "Branch cancel policy can be managed directly by global admins"
ON public.branch_cancel_policy
FOR ALL
TO authenticated
USING (
  public.is_global_admin(auth.uid())
)
WITH CHECK (
  public.is_global_admin(auth.uid())
);

GRANT SELECT ON public.branch_cancel_policy TO authenticated;

DROP FUNCTION IF EXISTS public.list_branch_cancel_policy_nodes(uuid);
CREATE OR REPLACE FUNCTION public.list_branch_cancel_policy_nodes(
  p_branch_id uuid
)
RETURNS TABLE (
  menu_node_id uuid,
  menu_node_name text,
  parent_id uuid,
  depth integer,
  descendant_product_count integer,
  is_primary_root_category boolean,
  is_kitchen_plate boolean,
  allow_direct_cancel boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar anulaciones directas en esta sucursal';
  END IF;

  RETURN QUERY
  SELECT
    mn.id AS menu_node_id,
    mn.name AS menu_node_name,
    mn.parent_id,
    mn.depth,
    children.descendant_product_count,
    mn.id = first_root.first_root_category_id AS is_primary_root_category,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(bcp.allow_direct_cancel, true) AS allow_direct_cancel
  FROM public.menu_nodes mn
  JOIN LATERAL (
    WITH RECURSIVE descendants AS (
      SELECT child.id, child.parent_id, child.node_type
      FROM public.menu_nodes child
      WHERE child.parent_id = mn.id

      UNION ALL

      SELECT next_child.id, next_child.parent_id, next_child.node_type
      FROM public.menu_nodes next_child
      JOIN descendants d ON d.id = next_child.parent_id
    )
    SELECT COUNT(*)::integer AS descendant_product_count
    FROM descendants
    WHERE node_type = 'product'
  ) children ON true
  CROSS JOIN LATERAL (
    SELECT root.id AS first_root_category_id
    FROM public.menu_nodes root
    WHERE root.branch_id = p_branch_id
      AND root.node_type = 'category'
      AND root.depth = 0
      AND root.parent_id IS NULL
      AND root.is_active = true
    ORDER BY root.display_order, root.name, root.id
    LIMIT 1
  ) first_root
  LEFT JOIN public.branch_cancel_policy bcp
    ON bcp.branch_id = p_branch_id
   AND bcp.menu_node_id = mn.id
  WHERE mn.branch_id = p_branch_id
    AND mn.node_type = 'category'
    AND mn.is_active = true
    AND mn.depth = 0
    AND mn.parent_id IS NULL
  ORDER BY mn.depth, mn.display_order, mn.name;
END;
$$;

DROP FUNCTION IF EXISTS public.save_branch_cancel_policy(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.save_branch_cancel_policy(
  p_branch_id uuid,
  p_policies jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_global_admin boolean := public.is_global_admin(auth.uid());
  v_entry jsonb;
  v_menu_node_id uuid;
  v_is_kitchen_plate boolean;
  v_allow_direct_cancel boolean;
  v_existing public.branch_cancel_policy%ROWTYPE;
  v_existing_kitchen boolean;
  v_existing_allow boolean;
  v_is_primary_root_category boolean;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id es obligatorio';
  END IF;

  IF jsonb_typeof(COALESCE(p_policies, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'policies debe ser un arreglo JSON';
  END IF;

  IF NOT public.can_manage_branch_admin(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'No tienes permisos para configurar anulaciones directas en esta sucursal';
  END IF;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb))
  LOOP
    v_menu_node_id := NULLIF(v_entry->>'menu_node_id', '')::uuid;
    v_is_kitchen_plate := COALESCE((v_entry->>'is_kitchen_plate')::boolean, false);
    v_allow_direct_cancel := COALESCE((v_entry->>'allow_direct_cancel')::boolean, false);

    IF v_menu_node_id IS NULL THEN
      RAISE EXCEPTION 'Cada politica debe incluir menu_node_id';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.menu_nodes mn
      WHERE mn.id = v_menu_node_id
        AND mn.branch_id = p_branch_id
        AND mn.node_type = 'category'
        AND mn.depth = 0
        AND mn.parent_id IS NULL
    ) THEN
      RAISE EXCEPTION 'El nodo indicado no es una categoria raiz valida para esta sucursal';
    END IF;

    SELECT v_menu_node_id = root.id
    INTO v_is_primary_root_category
    FROM (
      SELECT mn.id
      FROM public.menu_nodes mn
      WHERE mn.branch_id = p_branch_id
        AND mn.node_type = 'category'
        AND mn.depth = 0
        AND mn.parent_id IS NULL
        AND mn.is_active = true
      ORDER BY mn.display_order, mn.name, mn.id
      LIMIT 1
    ) root;

    SELECT *
    INTO v_existing
    FROM public.branch_cancel_policy bcp
    WHERE bcp.branch_id = p_branch_id
      AND bcp.menu_node_id = v_menu_node_id;

    v_existing_kitchen := COALESCE(v_existing.is_kitchen_plate, false);
    v_existing_allow := COALESCE(v_existing.allow_direct_cancel, false);

    IF NOT v_is_global_admin THEN
      IF COALESCE(v_is_primary_root_category, false) THEN
        RAISE EXCEPTION 'La primera categoria de nivel 0 solo puede ser editada por un administrador general';
      END IF;

      IF v_is_kitchen_plate IS DISTINCT FROM v_existing_kitchen THEN
        RAISE EXCEPTION 'Solo un administrador general puede cambiar si una categoria es plato de cocina';
      END IF;

    END IF;

    IF NOT v_is_kitchen_plate AND NOT v_allow_direct_cancel THEN
      DELETE FROM public.branch_cancel_policy
      WHERE branch_id = p_branch_id
        AND menu_node_id = v_menu_node_id;
    ELSE
      INSERT INTO public.branch_cancel_policy (
        branch_id,
        menu_node_id,
        is_kitchen_plate,
        allow_direct_cancel,
        updated_by
      )
      VALUES (
        p_branch_id,
        v_menu_node_id,
        v_is_kitchen_plate,
        v_allow_direct_cancel,
        auth.uid()
      )
      ON CONFLICT (branch_id, menu_node_id)
      DO UPDATE SET
        is_kitchen_plate = EXCLUDED.is_kitchen_plate,
        allow_direct_cancel = EXCLUDED.allow_direct_cancel,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.get_branch_cancel_policy_for_product(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_branch_cancel_policy_for_product(
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS TABLE (
  policy_menu_node_id uuid,
  policy_menu_node_name text,
  is_kitchen_plate boolean,
  allow_direct_cancel boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active_branch_id = p_branch_id
    )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para consultar esta politica de anulacion';
  END IF;

  RETURN QUERY
  WITH RECURSIVE ancestors AS (
    SELECT mn.id, mn.parent_id, mn.name, mn.depth, mn.node_type
    FROM public.menu_nodes mn
    WHERE mn.id = p_product_id
      AND mn.branch_id = p_branch_id
      AND mn.node_type = 'product'

    UNION ALL

    SELECT parent.id, parent.parent_id, parent.name, parent.depth, parent.node_type
    FROM public.menu_nodes parent
    JOIN ancestors child ON child.parent_id = parent.id
  )
  SELECT
    root.id AS policy_menu_node_id,
    root.name AS policy_menu_node_name,
    COALESCE(bcp.is_kitchen_plate, false) AS is_kitchen_plate,
    COALESCE(bcp.allow_direct_cancel, true) AS allow_direct_cancel
  FROM ancestors root
  LEFT JOIN public.branch_cancel_policy bcp
    ON bcp.branch_id = p_branch_id
   AND bcp.menu_node_id = root.id
  WHERE root.node_type = 'category'
    AND root.depth = 0
    AND root.parent_id IS NULL
  ORDER BY root.depth, root.name
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_branch_cancel_policy_nodes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_branch_cancel_policy(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_cancel_policy_for_product(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
