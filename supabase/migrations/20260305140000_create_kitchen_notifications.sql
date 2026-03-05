-- Create kitchen_notifications table for real-time kitchen alerts
CREATE TABLE IF NOT EXISTS public.kitchen_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('ITEM_CANCELLED', 'ORDER_CANCELLED')),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number integer NOT NULL,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  message text NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Indexes for performance
  INDEX idx_order_id (order_id),
  INDEX idx_branch_id (branch_id),
  INDEX idx_created_at (created_at)
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.kitchen_notifications ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users to read notifications
CREATE POLICY "Allow read all from authenticated users on kitchen notifications"
  ON public.kitchen_notifications
  FOR SELECT
  TO authenticated
  USING (true);

-- Create policy for inserting notifications
CREATE POLICY "Allow insert for authenticated users on kitchen notifications"
  ON public.kitchen_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

-- Enable Realtime for this table (needed for subscriptions)
ALTER TABLE public.kitchen_notifications REPLICA IDENTITY FULL;

-- Create operational_losses table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.operational_losses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  cancelled_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Indexes for performance and analytics
  INDEX idx_order_id (order_id),
  INDEX idx_branch_id (branch_id),
  INDEX idx_created_at (created_at),
  INDEX idx_reason (reason)
);

-- Enable RLS for operational_losses
ALTER TABLE public.operational_losses ENABLE ROW LEVEL SECURITY;

-- Create policies for operational_losses
CREATE POLICY "Allow read all from authenticated users on operational losses"
  ON public.operational_losses
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert for authenticated users on operational losses"
  ON public.operational_losses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

-- Add new columns to orders table if they don't exist
-- (These columns were already added in previous migrations but we verify here)
DO $$ 
BEGIN
  -- Add cancelled_at column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz;
  END IF;

  -- Add cancelled_by column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'cancelled_by'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN cancelled_by uuid REFERENCES public.profiles(id);
  END IF;

  -- Add cancellation_reason column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN cancellation_reason text;
  END IF;

  -- Add cancelled_from_status column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'cancelled_from_status'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN cancelled_from_status text;
  END IF;

END $$;

-- Add new columns to order_items table if they don't exist
DO $$ 
BEGIN
  -- Add status column if not exists (should already exist from previous migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_items' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN status text DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'DISPATCHED', 'PAID', 'CANCELLED'));
  END IF;

  -- Add cancelled_at column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_items' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN cancelled_at timestamptz;
  END IF;

  -- Add cancelled_by column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_items' AND column_name = 'cancelled_by'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN cancelled_by uuid REFERENCES public.profiles(id);
  END IF;

  -- Add cancellation_reason column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_items' AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN cancellation_reason text;
  END IF;

  -- Add cancelled_from_status column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_items' AND column_name = 'cancelled_from_status'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN cancelled_from_status text;
  END IF;

END $$;
