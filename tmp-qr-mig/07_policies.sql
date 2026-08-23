DROP POLICY IF EXISTS tokens_qr_mesas_select_anon ON public.tokens_qr_mesas;
CREATE POLICY tokens_qr_mesas_select_anon
  ON public.tokens_qr_mesas
  FOR SELECT
  TO anon
  USING (
    activo = true
    AND EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.branch_id = ANY (public.qr_shared_peer_branch_ids(tokens_qr_mesas.sucursal_id))
        AND cs.status = 'OPEN'
    )
  );

DROP POLICY IF EXISTS menu_nodes_select_anon_autopedido_qr ON public.menu_nodes;
CREATE POLICY menu_nodes_select_anon_autopedido_qr
  ON public.menu_nodes
  FOR SELECT
  TO anon
  USING (
    menu_nodes.is_active = true
    AND menu_nodes.menu_scope = 'TABLE'
    AND EXISTS (
      SELECT 1
      FROM public.tokens_qr_mesas t
      INNER JOIN public.cash_shifts cs
        ON cs.branch_id = ANY (public.qr_shared_peer_branch_ids(t.sucursal_id))
       AND cs.status = 'OPEN'
       AND cs.branch_id = menu_nodes.branch_id
      WHERE t.sucursal_id = ANY (public.qr_shared_peer_branch_ids(menu_nodes.branch_id))
        AND t.activo = true
    )
  );

NOTIFY pgrst, 'reload schema';
