-- Impide productos de menu_nodes sin enlace válido a public.products.
-- Si falta o está huérfano, intenta sync_menu_node_to_legacy_product;
-- si aún así queda inválido, aborta la transacción.

CREATE OR REPLACE FUNCTION public.menu_node_has_valid_legacy_product(
  p_legacy_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_legacy_product_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = p_legacy_product_id
    );
$$;

CREATE OR REPLACE FUNCTION public.trg_menu_nodes_ensure_product_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.node_type IS DISTINCT FROM 'product' THEN
    RETURN NEW;
  END IF;

  -- Ya válido: no tocar (evita recursión al UPDATE de legacy desde sync).
  IF public.menu_node_has_valid_legacy_product(NEW.legacy_product_id) THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_menu_node_to_legacy_product(NEW.id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_nodes mn
    WHERE mn.id = NEW.id
      AND public.menu_node_has_valid_legacy_product(mn.legacy_product_id)
  ) THEN
    RAISE EXCEPTION
      'No se puede guardar el producto de menu "%" (%) sin enlace valido a products. Revisa categoria espejo / sync.',
      NEW.name,
      NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_nodes_ensure_product_legacy ON public.menu_nodes;

CREATE TRIGGER trg_menu_nodes_ensure_product_legacy
  AFTER INSERT OR UPDATE OF
    node_type,
    legacy_product_id,
    name,
    parent_id,
    price,
    is_active,
    menu_scope,
    branch_id
  ON public.menu_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_menu_nodes_ensure_product_legacy();

-- Sanea cualquier producto activo que haya quedado inválido (defensa + backfill).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT mn.id
    FROM public.menu_nodes mn
    WHERE mn.node_type = 'product'
      AND NOT public.menu_node_has_valid_legacy_product(mn.legacy_product_id)
  LOOP
    BEGIN
      PERFORM public.sync_menu_node_to_legacy_product(r.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo auto-reparar menu_node %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
