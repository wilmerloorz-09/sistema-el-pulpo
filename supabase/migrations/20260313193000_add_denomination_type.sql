ALTER TABLE public.denominations
ADD COLUMN IF NOT EXISTS denomination_type text;

UPDATE public.denominations
SET denomination_type = CASE
  WHEN lower(coalesce(label, "")) LIKE 'billete%' THEN 'bill'
  ELSE 'coin'
END
WHERE denomination_type IS NULL;

ALTER TABLE public.denominations
ALTER COLUMN denomination_type SET DEFAULT 'coin';

ALTER TABLE public.denominations
ALTER COLUMN denomination_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'denominations_denomination_type_check'
  ) THEN
    ALTER TABLE public.denominations
    ADD CONSTRAINT denominations_denomination_type_check
    CHECK (denomination_type IN ('coin', 'bill'));
  END IF;
END $$;
