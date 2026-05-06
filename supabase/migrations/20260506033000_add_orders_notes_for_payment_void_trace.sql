-- Ensure payment void auditing can append historical markers to orders.
-- Some deployed databases missed the legacy-compatible orders.notes column
-- while approve_and_void_payment already depends on it.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS notes text;
