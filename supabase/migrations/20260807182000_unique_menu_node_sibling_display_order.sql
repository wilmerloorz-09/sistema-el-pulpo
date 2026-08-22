-- Garantiza que dos nodos hermanos del arbol de menu no compartan display_order.
-- Aplica por sucursal + menu_scope + parent_id. Para categorias raiz, parent_id
-- es NULL, por eso el indice usa COALESCE(parent_id, uuid cero).

WITH normalized AS (
  SELECT
    mn.id,
    ROW_NUMBER() OVER (
      PARTITION BY mn.branch_id, mn.menu_scope, mn.parent_id
      ORDER BY COALESCE(NULLIF(mn.display_order, 0), 2147483647), mn.created_at, mn.id
    ) AS new_display_order
  FROM public.menu_nodes mn
)
UPDATE public.menu_nodes mn
SET
  display_order = normalized.new_display_order,
  updated_at = now()
FROM normalized
WHERE mn.id = normalized.id
  AND mn.display_order IS DISTINCT FROM normalized.new_display_order;

CREATE OR REPLACE FUNCTION public.ensure_unique_menu_node_display_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_order integer;
BEGIN
  IF COALESCE(NEW.display_order, 0) <= 0 THEN
    SELECT COALESCE(MAX(mn.display_order), 0) + 1
    INTO v_next_order
    FROM public.menu_nodes mn
    WHERE mn.branch_id = NEW.branch_id
      AND mn.menu_scope = NEW.menu_scope
      AND mn.parent_id IS NOT DISTINCT FROM NEW.parent_id
      AND mn.id IS DISTINCT FROM NEW.id;

    NEW.display_order := COALESCE(v_next_order, 1);
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.branch_id = NEW.branch_id
      AND mn.menu_scope = NEW.menu_scope
      AND mn.parent_id IS NOT DISTINCT FROM NEW.parent_id
      AND mn.display_order = NEW.display_order
      AND mn.id IS DISTINCT FROM NEW.id
  ) THEN
    SELECT COALESCE(MAX(mn.display_order), 0) + 1
    INTO v_next_order
    FROM public.menu_nodes mn
    WHERE mn.branch_id = NEW.branch_id
      AND mn.menu_scope = NEW.menu_scope
      AND mn.parent_id IS NOT DISTINCT FROM NEW.parent_id
      AND mn.id IS DISTINCT FROM NEW.id;

    NEW.display_order := COALESCE(v_next_order, NEW.display_order);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unique_menu_node_display_order ON public.menu_nodes;
CREATE TRIGGER trg_unique_menu_node_display_order
BEFORE INSERT OR UPDATE OF branch_id, menu_scope, parent_id, display_order
ON public.menu_nodes
FOR EACH ROW
EXECUTE FUNCTION public.ensure_unique_menu_node_display_order();

DROP INDEX IF EXISTS public.uq_menu_nodes_sibling_display_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_nodes_sibling_display_order
ON public.menu_nodes (
  branch_id,
  menu_scope,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  display_order
);

NOTIFY pgrst, 'reload schema';
