-- Una misma orden puede participar en varias campañas activas (una predicción por campaña).

ALTER TABLE public.predicciones_clientes
  DROP CONSTRAINT IF EXISTS predicciones_orden_unica;

ALTER TABLE public.predicciones_clientes
  ADD CONSTRAINT predicciones_orden_campana_unica UNIQUE (orden_id, campana_id);

COMMENT ON CONSTRAINT predicciones_orden_campana_unica ON public.predicciones_clientes IS
  'Una orden solo puede tener una participación por campaña.';
