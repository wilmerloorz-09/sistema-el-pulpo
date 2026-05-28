-- Requerida por apply_shift_caja_configuration (plantilla por cajero).
-- Idempotente: seguro si ya aplicaste 20260604120000_secondary_caja_individual_template.sql.

ALTER TABLE public.cash_shift_users
  ADD COLUMN IF NOT EXISTS secondary_caja_template_id uuid
  REFERENCES public.cash_register_templates(id);

COMMENT ON COLUMN public.cash_shift_users.secondary_caja_template_id IS
  'Plantilla de arqueo asignada a este cajero en el turno.';

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
