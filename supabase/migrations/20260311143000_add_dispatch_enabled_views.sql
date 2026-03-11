ALTER TABLE public.dispatch_config
ADD COLUMN IF NOT EXISTS table_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.dispatch_config
ADD COLUMN IF NOT EXISTS takeout_enabled boolean NOT NULL DEFAULT true;

UPDATE public.dispatch_config
SET table_enabled = COALESCE(table_enabled, true),
    takeout_enabled = COALESCE(takeout_enabled, true);

NOTIFY pgrst, 'reload schema';
