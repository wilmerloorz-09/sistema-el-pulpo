-- Sexo del comensal (M/F), obligatorio junto a la cédula.

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS sexo char(1);

UPDATE public.clientes
SET sexo = 'M'
WHERE sexo IS NULL;

ALTER TABLE public.clientes
  ALTER COLUMN sexo SET NOT NULL;

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_sexo_chk;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_sexo_chk CHECK (sexo IN ('M', 'F'));

COMMENT ON COLUMN public.clientes.sexo IS 'M = masculino, F = femenino.';

NOTIFY pgrst, 'reload schema';
