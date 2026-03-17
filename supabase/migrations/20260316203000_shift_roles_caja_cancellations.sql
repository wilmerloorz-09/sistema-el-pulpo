-- Migracion funcional para Roles de Turno, Estado de Caja en el Turno y Trazabilidad de Anulaciones
-- Aplica a cash_shift_users, orders, y cash_shifts (caja_status).

-- 1. Ampliar cash_shift_users con nuevos permisos operativos por turno
ALTER TABLE public.cash_shift_users 
  ADD COLUMN IF NOT EXISTS can_serve_tables boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_dispatch_orders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_use_caja boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_authorize_order_cancel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_supervisor boolean NOT NULL DEFAULT false;

-- Saneamiento de datos historicos:
-- si un usuario estaba habilitado en el turno pero no tenia ningun rol operativo,
-- lo dejamos con rol de mesas para no romper la restriccion nueva.
UPDATE public.cash_shift_users
SET can_serve_tables = true
WHERE is_enabled = true
  AND COALESCE(can_serve_tables, false) = false
  AND COALESCE(can_dispatch_orders, false) = false
  AND COALESCE(can_use_caja, false) = false
  AND COALESCE(is_supervisor, false) = false;

-- Si el usuario esta habilitado para el turno, obligamos a que tenga al menos una capacidad operativa activa
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_csu_operational_if_enabled'
      AND conrelid = 'public.cash_shift_users'::regclass
  ) THEN
    ALTER TABLE public.cash_shift_users
      ADD CONSTRAINT chk_csu_operational_if_enabled 
      CHECK (
        is_enabled = false OR (
          can_serve_tables = true OR 
          can_dispatch_orders = true OR 
          can_use_caja = true OR 
          is_supervisor = true
        )
      );
  END IF;
END$$;

-- 2. Trazabilidad de anulaciones en orders
ALTER TABLE public.orders 
  ADD COLUMN cancel_requested_by uuid REFERENCES public.profiles(id),
  ADD COLUMN cancel_requested_at timestamptz;

-- (Notar que orders ya tiene cancelled_by, cancelled_at y cancellation_reason añadidos en previas migraciones)
-- Renombramos cancellation_reason a cancel_reason si es posible o asumimos cancellation_reason de aquí en adelante.
-- Migracion previa 20260305140000 indica que ya existen:
-- cancelled_at
-- cancelled_by
-- cancellation_reason
-- cancelled_from_status

-- 3. Estado de la caja dentro del turno
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'caja_status') THEN
    CREATE TYPE public.caja_status AS ENUM ('UNOPENED', 'OPEN', 'CLOSED');
  END IF;
END$$;

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS caja_status caja_status NOT NULL DEFAULT 'UNOPENED';

-- 4. Modificar RPC `open_cash_shift_with_tables` y aislar la apertura de Caja.
-- (Ver script RPCs a continuacion)
