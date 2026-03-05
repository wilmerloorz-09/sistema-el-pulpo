-- migration to add CANCELLED state to order_status enum
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'CANCELLED';
