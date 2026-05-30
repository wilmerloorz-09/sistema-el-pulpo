ALTER TABLE public.cash_shift_users DROP CONSTRAINT IF EXISTS chk_csu_operational_if_enabled;

ALTER TABLE public.cash_shift_users
  ADD CONSTRAINT chk_csu_operational_if_enabled 
  CHECK (
    is_enabled = false OR (
      can_serve_tables = true OR 
      can_dispatch_orders = true OR 
      can_use_caja = true OR 
      is_supervisor = true OR
      can_pack_orders = true
    )
  );

NOTIFY pgrst, 'reload schema';
