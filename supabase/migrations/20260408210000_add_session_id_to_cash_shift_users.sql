-- Add last_session_id to cash_shift_users table
ALTER TABLE public.cash_shift_users 
ADD COLUMN IF NOT EXISTS last_session_id TEXT;

-- Update the touch function to keep it synced (redundant but safe)
CREATE OR REPLACE FUNCTION public.touch_cash_shift_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
