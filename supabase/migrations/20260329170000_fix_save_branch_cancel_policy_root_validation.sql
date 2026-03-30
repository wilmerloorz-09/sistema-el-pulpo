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

    SELECT EXISTS (
      SELECT 1
      FROM public.menu_nodes mn
      WHERE mn.id = v_menu_node_id
        AND mn.branch_id = p_branch_id
        AND mn.node_type = 'category'
        AND mn.depth = 0
        AND mn.parent_id IS NULL
        AND mn.is_active = true
    )
    INTO v_is_primary_root_category;

    IF NOT v_is_primary_root_category THEN
      CONTINUE;
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

GRANT EXECUTE ON FUNCTION public.save_branch_cancel_policy(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
