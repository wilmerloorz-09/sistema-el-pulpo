-- Add event timestamp columns to orders and order_items for tracking state changes

-- orders: sent_to_kitchen_at, ready_at, dispatched_at, paid_at (cancelled_at already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'sent_to_kitchen_at') THEN
    ALTER TABLE public.orders ADD COLUMN sent_to_kitchen_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'ready_at') THEN
    ALTER TABLE public.orders ADD COLUMN ready_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'dispatched_at') THEN
    ALTER TABLE public.orders ADD COLUMN dispatched_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'paid_at') THEN
    ALTER TABLE public.orders ADD COLUMN paid_at timestamptz;
  END IF;
END $$;

-- order_items: sent_to_kitchen_at, ready_at (dispatched_at and cancelled_at already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'sent_to_kitchen_at') THEN
    ALTER TABLE public.order_items ADD COLUMN sent_to_kitchen_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'ready_at') THEN
    ALTER TABLE public.order_items ADD COLUMN ready_at timestamptz;
  END IF;
END $$;
