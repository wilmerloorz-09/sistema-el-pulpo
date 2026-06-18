-- Create dispatch_config and dispatch_assignments tables (missing from original migrations)

CREATE TABLE IF NOT EXISTS public.dispatch_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE UNIQUE,
  dispatch_mode text NOT NULL DEFAULT 'INDIVIDUAL',
  table_enabled boolean NOT NULL DEFAULT true,
  takeout_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  dispatch_config_id uuid REFERENCES public.dispatch_config(id) ON DELETE CASCADE,
  dispatch_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
