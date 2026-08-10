-- =============================================================================
-- Realtime multi-sucursal: branch_id en order_ready_events / order_dispatch_events
-- =============================================================================
-- Bajo carga (varios turnos OPEN) NO ejecutar este archivo entero de una vez:
-- ADD COLUMN / CREATE INDEX / FK pelean AccessExclusiveLock con Realtime.
-- Preferir el runbook paso a paso (ver comentarios) o horario en valle de tráfico.
--
-- order_ready_events / order_dispatch_events YA están en supabase_realtime;
-- no hacer ALTER PUBLICATION aquí.
-- =============================================================================

-- Opcional al inicio de cada paso en el SQL Editor:
--   SET lock_timeout = '3s';
--   SET statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Paso 1 — columnas SIN FK (correr cada ALTER por separado; reintentar si deadlock)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_ready_events
  ADD COLUMN IF NOT EXISTS branch_id uuid;

ALTER TABLE public.order_dispatch_events
  ADD COLUMN IF NOT EXISTS branch_id uuid;

COMMENT ON COLUMN public.order_ready_events.branch_id IS
  'Denormalizado desde orders.branch_id para filtrar Realtime por sucursal.';

COMMENT ON COLUMN public.order_dispatch_events.branch_id IS
  'Denormalizado desde orders.branch_id para filtrar Realtime por sucursal.';

-- ---------------------------------------------------------------------------
-- Paso 2 — backfill (cada UPDATE por separado)
-- ---------------------------------------------------------------------------
UPDATE public.order_ready_events e
SET branch_id = o.branch_id
FROM public.orders o
WHERE e.order_id = o.id
  AND e.branch_id IS NULL;

UPDATE public.order_dispatch_events e
SET branch_id = o.branch_id
FROM public.orders o
WHERE e.order_id = o.id
  AND e.branch_id IS NULL;

-- ---------------------------------------------------------------------------
-- Paso 3 — índices
-- En SQL Editor de Supabase (fuera de migración transaccional), preferir:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ...
-- Aquí se deja CREATE INDEX normal para `supabase db push` / migrate.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_ready_events_branch_id
  ON public.order_ready_events (branch_id);

CREATE INDEX IF NOT EXISTS idx_order_dispatch_events_branch_id
  ON public.order_dispatch_events (branch_id);

-- ---------------------------------------------------------------------------
-- Paso 4 — FK (NOT VALID + VALIDATE = menos bloqueo que REFERENCES en ADD COLUMN)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_ready_events_branch_id_fkey'
  ) THEN
    ALTER TABLE public.order_ready_events
      ADD CONSTRAINT order_ready_events_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.order_ready_events
  VALIDATE CONSTRAINT order_ready_events_branch_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_dispatch_events_branch_id_fkey'
  ) THEN
    ALTER TABLE public.order_dispatch_events
      ADD CONSTRAINT order_dispatch_events_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.order_dispatch_events
  VALIDATE CONSTRAINT order_dispatch_events_branch_id_fkey;

-- ---------------------------------------------------------------------------
-- Paso 5 — triggers (relleno automático en INSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_ready_events_set_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT o.branch_id INTO NEW.branch_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_ready_events_set_branch_id ON public.order_ready_events;
CREATE TRIGGER trg_order_ready_events_set_branch_id
  BEFORE INSERT OR UPDATE OF order_id ON public.order_ready_events
  FOR EACH ROW
  EXECUTE FUNCTION public.order_ready_events_set_branch_id();

CREATE OR REPLACE FUNCTION public.order_dispatch_events_set_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT o.branch_id INTO NEW.branch_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_dispatch_events_set_branch_id ON public.order_dispatch_events;
CREATE TRIGGER trg_order_dispatch_events_set_branch_id
  BEFORE INSERT OR UPDATE OF order_id ON public.order_dispatch_events
  FOR EACH ROW
  EXECUTE FUNCTION public.order_dispatch_events_set_branch_id();

CREATE OR REPLACE FUNCTION public.orders_sync_ready_dispatch_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    UPDATE public.order_ready_events
    SET branch_id = NEW.branch_id
    WHERE order_id = NEW.id;

    UPDATE public.order_dispatch_events
    SET branch_id = NEW.branch_id
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_ready_dispatch_branch_id ON public.orders;
CREATE TRIGGER trg_orders_sync_ready_dispatch_branch_id
  AFTER UPDATE OF branch_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_sync_ready_dispatch_branch_id();
