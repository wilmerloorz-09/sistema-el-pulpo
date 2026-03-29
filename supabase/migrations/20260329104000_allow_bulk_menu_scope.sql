ALTER TABLE public.menu_nodes
  DROP CONSTRAINT IF EXISTS menu_nodes_menu_scope_check;

ALTER TABLE public.menu_nodes
  ADD CONSTRAINT menu_nodes_menu_scope_check
  CHECK (menu_scope IN ('TABLE', 'TAKEOUT', 'BULK'));

NOTIFY pgrst, 'reload schema';
