-- Verifica que create_dine_in_order esté acotado al turno OPEN (migración 20260603120000).
-- Ejecutar en SQL Editor de Supabase después de aplicar la migración.
-- migration_20260603120000_applied debe ser true.

SELECT
  position('o.cash_shift_id = v_shift_id' in pg_get_functiondef(
    'public.create_dine_in_order(uuid,uuid,uuid,boolean)'::regprocedure
  )) > 0 AS migration_20260603120000_applied,
  CASE
    WHEN position('o.cash_shift_id = v_shift_id' in pg_get_functiondef(
      'public.create_dine_in_order(uuid,uuid,uuid,boolean)'::regprocedure
    )) > 0
    THEN 'create_dine_in_order filtra ocupación por turno abierto.'
    ELSE 'FALTA migración 20260603120000: aplicar supabase/migrations/20260603120000_scope_table_busy_check_to_open_shift.sql'
  END AS message;
