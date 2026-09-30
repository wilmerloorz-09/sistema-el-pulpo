-- Cierre de caja con conteo por denominación: cantidad del sistema vs. cantidad contada
-- por el cajero. Se guarda en la misma transacción que cierra la apertura.

CREATE TABLE IF NOT EXISTS public.cash_register_closing_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_id uuid NOT NULL REFERENCES public.cash_register_openings(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.denominations(id),
  denomination_label text NOT NULL,
  denomination_type text,
  denomination_value numeric(12, 2) NOT NULL,
  qty_system integer NOT NULL CHECK (qty_system >= 0),
  qty_counted integer NOT NULL CHECK (qty_counted >= 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_register_closing_counts_opening_denom_uniq UNIQUE (opening_id, denomination_id)
);

COMMENT ON TABLE public.cash_register_closing_counts IS
  'Conteo de cierre de caja por denominación: cantidad del sistema y cantidad contada por el cajero.';

CREATE INDEX IF NOT EXISTS idx_cash_register_closing_counts_shift
  ON public.cash_register_closing_counts (shift_id);

ALTER TABLE public.cash_register_closing_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cierre conteo select" ON public.cash_register_closing_counts;
CREATE POLICY "Cierre conteo select"
ON public.cash_register_closing_counts
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
);

-- Se reemplaza la firma (nuevo parámetro p_counts) para evitar dos overloads ambiguos en PostgREST.
DROP FUNCTION IF EXISTS public.close_cash_register(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_branch_id uuid,
  p_notes text DEFAULT NULL::text,
  p_counts jsonb DEFAULT NULL::jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_opening_id uuid;
  v_other_real_open int := 0;
  v_unpaid_count int := 0;
  v_unpaid_preview text := '';
  v_blockers jsonb;
BEGIN
  IF p_shift_id IS NULL OR p_cashier_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'shift_id, cashier_id y branch_id son obligatorios';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_cashier_id THEN
    RAISE EXCEPTION 'Solo puedes cerrar la caja con tu propio usuario autenticado';
  END IF;

  IF NOT (
    public.can_manage_branch_admin(auth.uid(), p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.cash_shift_users csu
      WHERE csu.shift_id = p_shift_id
        AND csu.user_id = p_cashier_id
        AND csu.is_enabled = true
        AND csu.can_use_caja = true
    )
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permisos para usar la caja en este turno';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    WHERE cs.id = p_shift_id
      AND cs.branch_id = p_branch_id
      AND cs.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'No se encontro un turno abierto para cerrar caja';
  END IF;

  SELECT cro.id
  INTO v_opening_id
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.cashier_id = p_cashier_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
  ORDER BY cro.opened_at DESC, cro.created_at DESC
  LIMIT 1;

  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'No tienes una apertura de caja activa para cerrar';
  END IF;

  SELECT COUNT(*)::int
  INTO v_other_real_open
  FROM public.cash_register_openings cro
  WHERE cro.shift_id = p_shift_id
    AND cro.status = 'abierta'
    AND cro.register_role <> 'auxiliary'
    AND cro.id <> v_opening_id
    AND (
      NOT public.can_manage_branch_admin(cro.cashier_id, cro.branch_id)
      OR public.admin_opening_has_active_charges(cro.shift_id, cro.cashier_id)
    );

  IF v_other_real_open = 0 THEN
    v_blockers := public.get_branch_shift_closure_blockers(p_branch_id);
    v_unpaid_count := jsonb_array_length(COALESCE(v_blockers -> 'unpaid_orders', '[]'::jsonb));

    IF v_unpaid_count > 0 THEN
      SELECT string_agg(x.order_ref || ' (' || x.label || ')', ', ' ORDER BY x.order_ref)
      INTO v_unpaid_preview
      FROM (
        SELECT r.order_ref, r.label
        FROM jsonb_to_recordset(v_blockers -> 'unpaid_orders')
          AS r(order_id uuid, order_ref text, label text, status text)
        ORDER BY r.order_ref
        LIMIT 20
      ) x;

      RAISE EXCEPTION
        'No puedes cerrar la caja porque es la última abierta y aún hay órdenes por cobrar.%s%s',
        E'\n\nÓrdenes sin pagar: ' || COALESCE(v_unpaid_preview, ''),
        CASE
          WHEN v_unpaid_count > 20 THEN E'\n… y ' || (v_unpaid_count - 20)::text || ' más'
          ELSE ''
        END;
    END IF;
  END IF;

  IF p_counts IS NOT NULL AND jsonb_typeof(p_counts) = 'array' THEN
    INSERT INTO public.cash_register_closing_counts (
      opening_id, shift_id, branch_id, denomination_id,
      denomination_label, denomination_type, denomination_value,
      qty_system, qty_counted, created_by
    )
    SELECT
      v_opening_id, p_shift_id, p_branch_id, d.id,
      d.label, d.denomination_type, d.value,
      GREATEST(0, COALESCE((c->>'qty_system')::int, 0)),
      GREATEST(0, COALESCE((c->>'qty_counted')::int, (c->>'qty_system')::int, 0)),
      p_cashier_id
    FROM jsonb_array_elements(p_counts) AS c
    JOIN public.denominations d ON d.id = (c->>'denomination_id')::uuid
    ON CONFLICT (opening_id, denomination_id) DO UPDATE
      SET qty_system = EXCLUDED.qty_system,
          qty_counted = EXCLUDED.qty_counted,
          created_at = now();
  END IF;

  UPDATE public.cash_register_openings
  SET status = 'cerrada',
      closed_at = now(),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_opening_id;

  PERFORM public.sync_shift_caja_status_from_openings(p_shift_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, uuid, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
