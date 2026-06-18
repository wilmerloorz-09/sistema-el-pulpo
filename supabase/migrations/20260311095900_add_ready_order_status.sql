-- Add 'READY' value to order_status enum (missing from original migrations)
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'READY';
