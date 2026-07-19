-- Cuentas destino de El Pulpo, mascara por banco de origen y auditoria inmutable
-- de comprobantes de transferencia aceptados por el cajero.

ALTER TABLE public.bancos
  ADD COLUMN IF NOT EXISTS mascara_cuenta_destino text NOT NULL DEFAULT 'XXXXXX####';

ALTER TABLE public.bancos
  DROP CONSTRAINT IF EXISTS bancos_mascara_cuenta_destino_chk;
ALTER TABLE public.bancos
  ADD CONSTRAINT bancos_mascara_cuenta_destino_chk
  CHECK (
    mascara_cuenta_destino ~ '^[Xx*# .-]+$'
    AND mascara_cuenta_destino LIKE '%#%'
  );

COMMENT ON COLUMN public.bancos.mascara_cuenta_destino IS
  'Mascara usada por comprobantes emitidos desde este banco. # = digito visible a comparar; X o * = digito oculto; separadores se ignoran.';

CREATE TABLE IF NOT EXISTS public.cuentas_bancarias_destino (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_id uuid NOT NULL REFERENCES public.bancos(id) ON DELETE RESTRICT,
  numero_cuenta text NOT NULL,
  numero_cuenta_normalizado text GENERATED ALWAYS AS (
    regexp_replace(numero_cuenta, '[^0-9]', '', 'g')
  ) STORED,
  tipo_cuenta text NOT NULL DEFAULT 'AHORROS'
    CHECK (tipo_cuenta IN ('AHORROS', 'CORRIENTE')),
  titular text NOT NULL,
  identificacion_titular text,
  alias text,
  sucursal_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  activa boolean NOT NULL DEFAULT true,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cuentas_bancarias_destino_numero_chk
    CHECK (length(regexp_replace(numero_cuenta, '[^0-9]', '', 'g')) BETWEEN 4 AND 34),
  CONSTRAINT cuentas_bancarias_destino_titular_chk
    CHECK (length(trim(titular)) >= 3),
  CONSTRAINT cuentas_bancarias_destino_identificacion_chk
    CHECK (
      identificacion_titular IS NULL
      OR length(regexp_replace(identificacion_titular, '[^0-9]', '', 'g')) BETWEEN 10 AND 13
    ),
  CONSTRAINT cuentas_bancarias_destino_banco_numero_unico
    UNIQUE (banco_id, numero_cuenta_normalizado)
);

COMMENT ON TABLE public.cuentas_bancarias_destino IS
  'Cuentas de El Pulpo autorizadas para recibir transferencias; sucursal_id NULL significa todas las sucursales.';
COMMENT ON COLUMN public.cuentas_bancarias_destino.sucursal_id IS
  'Sucursal que puede recibir en esta cuenta; NULL aplica a todas.';

CREATE INDEX IF NOT EXISTS idx_cuentas_bancarias_destino_activas
  ON public.cuentas_bancarias_destino (sucursal_id, activa, banco_id);

CREATE OR REPLACE FUNCTION public.cuentas_bancarias_destino_actualizar_marca_tiempo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizada_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuentas_bancarias_destino_actualizar_marca_tiempo
  ON public.cuentas_bancarias_destino;
CREATE TRIGGER trg_cuentas_bancarias_destino_actualizar_marca_tiempo
BEFORE UPDATE ON public.cuentas_bancarias_destino
FOR EACH ROW
EXECUTE FUNCTION public.cuentas_bancarias_destino_actualizar_marca_tiempo();

ALTER TABLE public.cuentas_bancarias_destino ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view cuentas bancarias destino"
  ON public.cuentas_bancarias_destino;
CREATE POLICY "Authenticated view cuentas bancarias destino"
ON public.cuentas_bancarias_destino
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Global Admin manage cuentas bancarias destino"
  ON public.cuentas_bancarias_destino;
CREATE POLICY "Global Admin manage cuentas bancarias destino"
ON public.cuentas_bancarias_destino
FOR ALL TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.validaciones_comprobantes_transferencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cuenta_bancaria_destino_id uuid REFERENCES public.cuentas_bancarias_destino(id) ON DELETE RESTRICT,
  estado text NOT NULL
    CHECK (estado IN ('VALIDADO', 'CON_NOVEDADES', 'NO_VERIFICABLE')),
  analisis_ia jsonb NOT NULL DEFAULT '{}'::jsonb,
  validaciones jsonb NOT NULL DEFAULT '{}'::jsonb,
  novedades jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(novedades) = 'array'),
  motivo_aceptacion text,
  validado_por_usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validaciones_comprobantes_motivo_chk CHECK (
    estado = 'VALIDADO'
    OR length(trim(COALESCE(motivo_aceptacion, ''))) >= 5
  )
);

COMMENT ON TABLE public.validaciones_comprobantes_transferencia IS
  'Snapshot inmutable del analisis IA y de la decision humana al aceptar una transferencia.';
COMMENT ON COLUMN public.validaciones_comprobantes_transferencia.validaciones IS
  'Resultado por regla: banco destino, titular, cuenta enmascarada, fecha y monto.';
COMMENT ON COLUMN public.validaciones_comprobantes_transferencia.motivo_aceptacion IS
  'Motivo obligatorio cuando el usuario acepta con novedades o datos no verificables.';

CREATE INDEX IF NOT EXISTS idx_validaciones_comprobantes_sucursal_fecha
  ON public.validaciones_comprobantes_transferencia (sucursal_id, validado_en DESC);
CREATE INDEX IF NOT EXISTS idx_validaciones_comprobantes_estado
  ON public.validaciones_comprobantes_transferencia (estado, validado_en DESC);

ALTER TABLE public.validaciones_comprobantes_transferencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operadores ven validaciones comprobantes"
  ON public.validaciones_comprobantes_transferencia;
CREATE POLICY "Operadores ven validaciones comprobantes"
ON public.validaciones_comprobantes_transferencia
FOR SELECT TO authenticated
USING (
  public.can_operate_cash_branch(auth.uid(), sucursal_id)
  OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
  OR public.is_global_admin(auth.uid())
);

DROP POLICY IF EXISTS "Cajeros registran validaciones comprobantes"
  ON public.validaciones_comprobantes_transferencia;
CREATE POLICY "Cajeros registran validaciones comprobantes"
ON public.validaciones_comprobantes_transferencia
FOR INSERT TO authenticated
WITH CHECK (
  validado_por_usuario_id = auth.uid()
  AND (
    public.can_operate_cash_branch(auth.uid(), sucursal_id)
    OR public.can_manage_branch_admin(auth.uid(), sucursal_id)
    OR public.is_global_admin(auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.orders o ON o.id = p.order_id
    WHERE p.id = pago_id
      AND p.created_by = auth.uid()
      AND o.branch_id = sucursal_id
  )
);

-- Reemplaza la version vigente para que pago + auditoria se registren en la misma
-- transaccion cuando se usa el camino rapido de Caja.
CREATE OR REPLACE FUNCTION public.register_payment_with_items(
  p_payments jsonb,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay jsonb;
  v_banco_id uuid;
  v_numero text;
BEGIN
  FOR v_pay IN SELECT value FROM jsonb_array_elements(p_payments)
  LOOP
    IF auth.uid() IS NULL OR NULLIF(v_pay->>'created_by', '')::uuid <> auth.uid() THEN
      RAISE EXCEPTION 'No autorizado para registrar el pago'
        USING ERRCODE = '42501';
    END IF;

    v_banco_id := NULLIF(v_pay->>'banco_id', '')::uuid;
    v_numero := NULLIF(TRIM(v_pay->>'numero_transferencia'), '');

    IF v_banco_id IS NOT NULL AND v_numero IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.banco_id = v_banco_id
          AND lower(trim(p.numero_transferencia)) = lower(v_numero)
      ) THEN
        RAISE EXCEPTION 'transferencia duplicada: %', v_numero
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.payments (
    id,
    order_id,
    payment_method_id,
    amount,
    change_amount,
    notes,
    banco_id,
    numero_transferencia,
    created_by,
    created_at
  )
  SELECT
    (p->>'id')::uuid,
    (p->>'order_id')::uuid,
    (p->>'payment_method_id')::uuid,
    (p->>'amount')::numeric,
    NULLIF(p->>'change_amount', '')::numeric,
    p->>'notes',
    NULLIF(p->>'banco_id', '')::uuid,
    NULLIF(TRIM(p->>'numero_transferencia'), ''),
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p;

  INSERT INTO public.validaciones_comprobantes_transferencia (
    pago_id,
    sucursal_id,
    cuenta_bancaria_destino_id,
    estado,
    analisis_ia,
    validaciones,
    novedades,
    motivo_aceptacion,
    validado_por_usuario_id,
    validado_en
  )
  SELECT
    (p->>'id')::uuid,
    o.branch_id,
    NULLIF(p->'validacion_transferencia'->>'cuenta_bancaria_destino_id', '')::uuid,
    p->'validacion_transferencia'->>'estado',
    COALESCE(p->'validacion_transferencia'->'analisis_ia', '{}'::jsonb),
    COALESCE(p->'validacion_transferencia'->'validaciones', '{}'::jsonb),
    COALESCE(p->'validacion_transferencia'->'novedades', '[]'::jsonb),
    NULLIF(TRIM(p->'validacion_transferencia'->>'motivo_aceptacion'), ''),
    (p->>'created_by')::uuid,
    COALESCE((p->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(p_payments) AS p
  JOIN public.orders o ON o.id = (p->>'order_id')::uuid
  WHERE jsonb_typeof(p->'validacion_transferencia') = 'object';

  INSERT INTO public.payment_items (
    id,
    payment_id,
    order_item_id,
    quantity_paid,
    unit_price,
    total_amount
  )
  SELECT
    (i->>'id')::uuid,
    (i->>'payment_id')::uuid,
    (i->>'order_item_id')::uuid,
    (i->>'quantity_paid')::numeric,
    (i->>'unit_price')::numeric,
    (i->>'total_amount')::numeric
  FROM jsonb_array_elements(p_items) AS i;
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment_with_items(jsonb, jsonb) TO authenticated;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
