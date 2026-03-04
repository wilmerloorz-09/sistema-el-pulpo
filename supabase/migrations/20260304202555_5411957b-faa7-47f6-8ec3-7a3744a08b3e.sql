
-- Add branch_id to categories
ALTER TABLE public.categories ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.categories SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.categories ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.categories ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to modifiers
ALTER TABLE public.modifiers ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.modifiers SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.modifiers ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.modifiers ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to restaurant_tables
ALTER TABLE public.restaurant_tables ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.restaurant_tables SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.restaurant_tables ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.restaurant_tables ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to orders
ALTER TABLE public.orders ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.orders SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.orders ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to cash_shifts
ALTER TABLE public.cash_shifts ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.cash_shifts SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.cash_shifts ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.cash_shifts ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to denominations
ALTER TABLE public.denominations ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.denominations SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.denominations ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.denominations ALTER COLUMN branch_id DROP DEFAULT;

-- Add branch_id to payment_methods
ALTER TABLE public.payment_methods ADD COLUMN branch_id uuid REFERENCES public.branches(id) DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.payment_methods SET branch_id = '00000000-0000-0000-0000-000000000001' WHERE branch_id IS NULL;
ALTER TABLE public.payment_methods ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.payment_methods ALTER COLUMN branch_id DROP DEFAULT;
