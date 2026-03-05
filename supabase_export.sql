-- ============================================================
-- EXPORTACIÓN COMPLETA: Esquema + Datos
-- Proyecto: Picantería El Pulpo
-- Fecha: 2026-03-05
-- ============================================================
-- INSTRUCCIONES:
-- 1. Crea un proyecto en https://supabase.com/dashboard
-- 2. Ve a SQL Editor y ejecuta este script COMPLETO
-- 3. Luego crea los usuarios en Auth → Users (ver sección al final)
-- 4. Actualiza las credenciales en tu app (ya lo hice en el código)
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════

CREATE TYPE public.app_role AS ENUM (
  'admin', 'mesero', 'cajero', 'cocina',
  'despachador_mesas', 'despachador_takeout', 'superadmin'
);

CREATE TYPE public.cash_movement_type AS ENUM ('OPENING', 'PAYMENT_IN', 'CHANGE_OUT');
CREATE TYPE public.cash_shift_status AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE public.order_status AS ENUM ('DRAFT', 'SENT_TO_KITCHEN', 'KITCHEN_DISPATCHED', 'PAID');
CREATE TYPE public.order_type AS ENUM ('DINE_IN', 'TAKEOUT');
CREATE TYPE public.price_mode AS ENUM ('FIXED', 'MANUAL');

-- ═══════════════════════════════════════════════════════════
-- 2. TABLES
-- ═══════════════════════════════════════════════════════════

-- Branches
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  branch_code varchar NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  username text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- User Roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- User Branches
CREATE TABLE public.user_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE
);

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  description text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Subcategories
CREATE TABLE public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  description text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategory_id uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  description text NOT NULL,
  unit_price numeric DEFAULT 0,
  price_mode price_mode NOT NULL DEFAULT 'FIXED',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Modifiers
CREATE TABLE public.modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  description text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Restaurant Tables
CREATE TABLE public.restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  visual_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table Splits
CREATE TABLE public.table_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  split_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Denominations
CREATE TABLE public.denominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  label text NOT NULL,
  value numeric NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

-- Payment Methods
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Orders
CREATE SEQUENCE IF NOT EXISTS orders_order_number_seq;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  table_id uuid REFERENCES public.restaurant_tables(id),
  split_id uuid REFERENCES public.table_splits(id),
  order_type order_type NOT NULL,
  order_number integer NOT NULL DEFAULT nextval('orders_order_number_seq'),
  order_code text,
  status order_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Order Items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  description_snapshot text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  total numeric NOT NULL,
  dispatched_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Order Item Modifiers
CREATE TABLE public.order_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.modifiers(id)
);

-- Payments
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id),
  amount numeric NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cash Shifts
CREATE TABLE public.cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id),
  status cash_shift_status NOT NULL DEFAULT 'OPEN',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text
);

-- Cash Shift Denoms
CREATE TABLE public.cash_shift_denoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.denominations(id),
  qty_initial integer NOT NULL DEFAULT 0,
  qty_current integer NOT NULL DEFAULT 0
);

-- Cash Movements
CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  movement_type cash_movement_type NOT NULL,
  denomination_id uuid REFERENCES public.denominations(id),
  payment_id uuid REFERENCES public.payments(id),
  qty_delta integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit Log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  action text NOT NULL,
  entity_id text,
  user_id uuid REFERENCES public.profiles(id),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- System Settings
CREATE TABLE public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn Challenges
CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  challenge text NOT NULL,
  type text NOT NULL DEFAULT 'registration',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn Credentials
CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_name text DEFAULT 'Dispositivo',
  transports text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════
-- 3. FUNCTIONS
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario'), COALESCE(NEW.raw_user_meta_data->>'username', NEW.email));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_code TEXT;
  v_date_part TEXT;
  v_seq INT;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
BEGIN
  SELECT branch_code INTO v_branch_code FROM public.branches WHERE id = NEW.branch_id;
  IF v_branch_code IS NULL OR v_branch_code = '' THEN v_branch_code := 'XX'; END IF;
  v_date_part := to_char(NOW() AT TIME ZONE 'America/Mexico_City', 'YYMMDD');
  v_day_start := (NOW() AT TIME ZONE 'America/Mexico_City')::date AT TIME ZONE 'America/Mexico_City';
  v_day_end := v_day_start + INTERVAL '1 day';
  SELECT COUNT(*) + 1 INTO v_seq FROM public.orders
  WHERE branch_id = NEW.branch_id AND created_at >= v_day_start AND created_at < v_day_end AND id != NEW.id;
  NEW.order_code := v_branch_code || v_date_part || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. TRIGGERS
-- ═══════════════════════════════════════════════════════════

-- Auto-create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subcategories_updated_at BEFORE UPDATE ON public.subcategories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_restaurant_tables_updated_at BEFORE UPDATE ON public.restaurant_tables FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-generate order code
CREATE TRIGGER generate_order_code_trigger
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_order_code();

-- ═══════════════════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.denominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shift_denoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- Branches
CREATE POLICY "Authenticated can view branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update branches" ON public.branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete branches" ON public.branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'admin'));

-- Profiles
CREATE POLICY "Authenticated can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- User Roles
CREATE POLICY "Authenticated can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- User Branches
CREATE POLICY "Authenticated can view user_branches" ON public.user_branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert user_branches" ON public.user_branches FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins can update user_branches" ON public.user_branches FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins can delete user_branches" ON public.user_branches FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));

-- Categories
CREATE POLICY "Authenticated can view categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Subcategories
CREATE POLICY "Authenticated can view subcategories" ON public.subcategories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert subcategories" ON public.subcategories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update subcategories" ON public.subcategories FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete subcategories" ON public.subcategories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Products
CREATE POLICY "Authenticated can view products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Modifiers
CREATE POLICY "Authenticated can view modifiers" ON public.modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert modifiers" ON public.modifiers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update modifiers" ON public.modifiers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete modifiers" ON public.modifiers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Restaurant Tables
CREATE POLICY "Authenticated can view tables" ON public.restaurant_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert tables" ON public.restaurant_tables FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update tables" ON public.restaurant_tables FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete tables" ON public.restaurant_tables FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Table Splits
CREATE POLICY "Authenticated can view splits" ON public.table_splits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage splits" ON public.table_splits FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update splits" ON public.table_splits FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete splits" ON public.table_splits FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- Denominations
CREATE POLICY "Authenticated can view denominations" ON public.denominations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert denominations" ON public.denominations FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update denominations" ON public.denominations FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete denominations" ON public.denominations FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Payment Methods
CREATE POLICY "Authenticated can view payment methods" ON public.payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert payment methods" ON public.payment_methods FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update payment methods" ON public.payment_methods FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete payment methods" ON public.payment_methods FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Orders
CREATE POLICY "Authenticated can view orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update orders" ON public.orders FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete orders" ON public.orders FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- Order Items
CREATE POLICY "Authenticated can view order items" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert order items" ON public.order_items FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update order items" ON public.order_items FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete order items" ON public.order_items FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- Order Item Modifiers
CREATE POLICY "Authenticated can view item modifiers" ON public.order_item_modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert item modifiers" ON public.order_item_modifiers FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update item modifiers" ON public.order_item_modifiers FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete item modifiers" ON public.order_item_modifiers FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- Payments
CREATE POLICY "Authenticated can view payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Cajeros can update payments" ON public.payments FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));

-- Cash Shifts
CREATE POLICY "Authenticated can view shifts" ON public.cash_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert shifts" ON public.cash_shifts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Cajeros can update shifts" ON public.cash_shifts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));

-- Cash Shift Denoms
CREATE POLICY "Authenticated can view shift denoms" ON public.cash_shift_denoms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert shift denoms" ON public.cash_shift_denoms FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Cajeros can update shift denoms" ON public.cash_shift_denoms FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));

-- Cash Movements
CREATE POLICY "Authenticated can view movements" ON public.cash_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert movements" ON public.cash_movements FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero') OR has_role(auth.uid(), 'admin'));

-- Audit Log
CREATE POLICY "Admins can view audit log" ON public.audit_log FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Staff can insert audit log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));

-- System Settings
CREATE POLICY "Authenticated can view settings" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert settings" ON public.system_settings FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update settings" ON public.system_settings FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- WebAuthn Credentials
CREATE POLICY "Users can view own credentials" ON public.webauthn_credentials FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own credentials" ON public.webauthn_credentials FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own credentials" ON public.webauthn_credentials FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- 6. SEED DATA
-- ═══════════════════════════════════════════════════════════
-- NOTA: Los datos de profiles, user_roles y user_branches
-- dependen de los UUIDs de auth.users. Deberás recrear los
-- usuarios en tu proyecto Supabase y luego ajustar los IDs.
-- A continuación se incluyen los datos del catálogo que NO
-- dependen de auth.users.

-- Branches
INSERT INTO public.branches (id, name, address, branch_code, is_active, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sucursal Principal', 'Dirección principal', 'C1', true, '2026-03-04 20:25:32.33301+00', '2026-03-05 03:03:48.800546+00'),
  ('c9386d9b-d979-487d-ad12-cbc370472adb', 'Sucursal Avenida', 'Avenida', 'C2', true, '2026-03-04 20:33:50.628965+00', '2026-03-05 03:03:40.729398+00');

-- Categories
INSERT INTO public.categories (id, branch_id, description, display_order, is_active) VALUES
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'PLATOS', 1, true),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'BEBIDAS', 2, true),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'VARIOS', 3, true),
  ('9b4611b9-457c-47f3-b603-9f30141f9a63', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'PLATOS', 1, true),
  ('ac87977f-c5f8-4943-b2bc-5ac054fdaac7', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'BEBIDAS', 2, true),
  ('999bda2e-933b-48b4-8f66-c3bb7a4ff314', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'VARIOS', 3, true);

-- Subcategories (Sucursal Principal)
INSERT INTO public.subcategories (id, category_id, description, display_order, is_active) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Encebollado', 1, true),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Ceviche', 2, true),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Arroz con Mariscos', 3, true),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Sopas', 4, true),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'Gaseosas', 1, true),
  ('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', 'Jugos Naturales', 2, true),
  ('b1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', 'Cervezas', 3, true),
  ('b1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000003', 'Extras', 1, true),
  ('b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000003', 'Postres', 2, true);

-- Subcategories (Sucursal Avenida)
INSERT INTO public.subcategories (id, category_id, description, display_order, is_active) VALUES
  ('5e1d2dd5-c960-4bae-9da4-fbd5b0361053', '9b4611b9-457c-47f3-b603-9f30141f9a63', 'Encebollado', 1, true),
  ('86693595-2e20-4a5a-a8de-fba1c432b6c6', '9b4611b9-457c-47f3-b603-9f30141f9a63', 'Ceviche', 2, true),
  ('5159071d-315b-4b5a-8e9b-3570aa3fd4f0', '9b4611b9-457c-47f3-b603-9f30141f9a63', 'Arroz con Mariscos', 3, true),
  ('e650c9f0-75b9-41a5-930f-9436689661b1', '9b4611b9-457c-47f3-b603-9f30141f9a63', 'Sopas', 4, true),
  ('0a317f68-8d64-43f2-be5f-40a7385f81f9', 'ac87977f-c5f8-4943-b2bc-5ac054fdaac7', 'Gaseosas', 1, true),
  ('9b9dec22-4120-4f3b-b88d-5313b913178e', 'ac87977f-c5f8-4943-b2bc-5ac054fdaac7', 'Jugos Naturales', 2, true),
  ('702b3f12-8503-455b-978e-591c3f70cabd', 'ac87977f-c5f8-4943-b2bc-5ac054fdaac7', 'Cervezas', 3, true),
  ('f7d4e5bb-0c31-47a8-9efa-69fd664925a6', '999bda2e-933b-48b4-8f66-c3bb7a4ff314', 'Extras', 1, true),
  ('d73d019a-3151-4a1d-8d77-1e7f1ede017a', '999bda2e-933b-48b4-8f66-c3bb7a4ff314', 'Postres', 2, true);

-- Products (Sucursal Avenida - los de Sucursal Principal tienen IDs del seed original)
INSERT INTO public.products (id, subcategory_id, description, unit_price, price_mode, is_active) VALUES
  ('586c7efe-7e40-485e-9434-ad3ac40b0e29', '5e1d2dd5-c960-4bae-9da4-fbd5b0361053', 'Encebollado de Albacora', 5.00, 'FIXED', true),
  ('84f78a3b-6b88-48a7-a9f9-00bb3e1bef78', '5e1d2dd5-c960-4bae-9da4-fbd5b0361053', 'Encebollado de Camarón', 6.50, 'FIXED', true),
  ('c14a1ca2-c57c-4bb7-b1a4-0c5455be9f15', '5e1d2dd5-c960-4bae-9da4-fbd5b0361053', 'Encebollado Mixto', 7.00, 'FIXED', true),
  ('f6a3c770-5063-480a-a42b-4869afbc45ed', '86693595-2e20-4a5a-a8de-fba1c432b6c6', 'Ceviche de Pescado', 6.00, 'FIXED', true),
  ('c83b1377-1bab-4827-b72a-badec7bf3e23', '86693595-2e20-4a5a-a8de-fba1c432b6c6', 'Ceviche de Camarón', 8.00, 'FIXED', true),
  ('257b067e-6022-4e7d-b9b8-9e97ef2cbd0c', '86693595-2e20-4a5a-a8de-fba1c432b6c6', 'Ceviche Mixto', 9.00, 'FIXED', true),
  ('1f5e06b8-7b58-4429-b3b5-a4cf2ccbc46e', '86693595-2e20-4a5a-a8de-fba1c432b6c6', 'Ceviche de Concha', 10.00, 'FIXED', true),
  ('4f2ffa03-294f-49ce-9b48-c45ab998b8aa', '5159071d-315b-4b5a-8e9b-3570aa3fd4f0', 'Arroz con Camarón', 8.50, 'FIXED', true),
  ('7635a089-37db-4fba-9d79-ff6c21fde34e', '5159071d-315b-4b5a-8e9b-3570aa3fd4f0', 'Arroz Marinero', 10.00, 'FIXED', true),
  ('b2a47a2c-ca07-4f18-90cf-982176f2f996', '0a317f68-8d64-43f2-be5f-40a7385f81f9', 'Coca Cola', 1.50, 'FIXED', true),
  ('6e20d36a-7f6d-45a2-9b15-b2e482966793', '0a317f68-8d64-43f2-be5f-40a7385f81f9', 'Fanta', 1.50, 'FIXED', true),
  ('097ccb33-089b-4a44-9be0-82a549476594', '0a317f68-8d64-43f2-be5f-40a7385f81f9', 'Sprite', 1.50, 'FIXED', true),
  ('14df0aa4-e12e-4945-bf9e-0413d6a2851b', '9b9dec22-4120-4f3b-b88d-5313b913178e', 'Limonada', 2.00, 'FIXED', true),
  ('8740b4b5-6d5b-46eb-b473-c8d23641221b', '9b9dec22-4120-4f3b-b88d-5313b913178e', 'Jugo de Maracuyá', 2.50, 'FIXED', true),
  ('f569b9cf-f3b1-4234-8fab-bdc480dce4b8', '9b9dec22-4120-4f3b-b88d-5313b913178e', 'Jugo de Naranja', 2.50, 'FIXED', true),
  ('ca86f7ae-4dd2-4d2e-95b1-abfadba8ced9', '702b3f12-8503-455b-978e-591c3f70cabd', 'Pilsener', 2.50, 'FIXED', true),
  ('4f5d1675-eb52-4400-89c7-3b3e14bf85f5', '702b3f12-8503-455b-978e-591c3f70cabd', 'Club Verde', 3.00, 'FIXED', true);

-- Modifiers (Sucursal Principal)
INSERT INTO public.modifiers (id, branch_id, description, is_active) VALUES
  ('0606d3e2-7798-43cf-aeb6-004b8416f05e', '00000000-0000-0000-0000-000000000001', 'Sin cebolla', true),
  ('8b947e68-e015-4245-a74a-e2aa5200ce75', '00000000-0000-0000-0000-000000000001', 'Poca cebolla', true),
  ('1874ee26-6f9d-4cd7-8e62-8ed48f4b1c09', '00000000-0000-0000-0000-000000000001', 'Extra cebolla', true),
  ('101e6d8c-75b5-4df4-8a85-45a27394f6f6', '00000000-0000-0000-0000-000000000001', 'Sin yuca', true),
  ('ab36da57-ea2c-41f0-a3e0-78c18752e6a5', '00000000-0000-0000-0000-000000000001', 'Poca yuca', true),
  ('b1543344-89dd-4ca8-88c8-b1fe934917f8', '00000000-0000-0000-0000-000000000001', 'Extra yuca', true),
  ('9ebf1c6d-8a97-4ee0-b314-c6020b7f4591', '00000000-0000-0000-0000-000000000001', 'Sin ají', true),
  ('2b8fa14d-44a0-443c-9fed-a3a99e91d980', '00000000-0000-0000-0000-000000000001', 'Extra ají', true),
  ('8c1b6810-baa1-4323-82fb-8fb605e14932', '00000000-0000-0000-0000-000000000001', 'Sin limón', true),
  ('a7e89ebf-68ee-4a6d-a734-41d3f499660d', '00000000-0000-0000-0000-000000000001', 'Con chifle', true),
  ('31751c65-2ae6-4cd5-850d-1434df84bab2', '00000000-0000-0000-0000-000000000001', 'Sin verde', true),
  ('65b55ea5-a26d-4adf-983b-7031d219e0ce', '00000000-0000-0000-0000-000000000001', 'Extra arroz', true);

-- Modifiers (Sucursal Avenida)
INSERT INTO public.modifiers (id, branch_id, description, is_active) VALUES
  ('4f3630a1-b1e6-4458-938a-9c397c6c2450', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Sin cebolla', true),
  ('770def35-f1d6-4cd1-800d-f945d56ee7a8', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Poca cebolla', true),
  ('5441f764-4cd1-436b-8fbc-c48a5c733499', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Extra cebolla', true),
  ('b228500e-fe88-44ae-b0db-a85669da8209', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Sin yuca', true),
  ('c27694d4-8fb0-4cf5-9c2e-d99f8201dbbd', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Poca yuca', true),
  ('04818a35-a8ae-4487-a071-d90ab88eff04', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Extra yuca', true),
  ('e2df4b23-6dcc-4402-9ec3-cb5d304cfd9f', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Sin ají', true),
  ('eceb79c5-62ab-486e-b35a-fd7039674d41', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Extra ají', true),
  ('a6297bae-5549-4f85-a760-bb9cb7f5ba33', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Sin limón', true),
  ('2284f8f6-c8d2-412f-bc59-3a6dcefcfa07', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Con chifle', true),
  ('dbed1420-3cd8-47d2-a6a8-eee874a39b1e', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Sin verde', true),
  ('9c7c0e95-1073-42f6-94f3-09e4e31937fa', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Extra arroz', true);

-- Restaurant Tables (Sucursal Principal)
INSERT INTO public.restaurant_tables (id, branch_id, name, visual_order, is_active) VALUES
  ('aeb8ab5a-cf8c-4e48-8aa6-825a91bc56ca', '00000000-0000-0000-0000-000000000001', 'Mesa 1', 1, true),
  ('e91a8e60-895d-4b8d-b89a-00776dd3dd40', '00000000-0000-0000-0000-000000000001', 'Mesa 2', 2, true),
  ('a9d06374-e22f-43a7-9592-b068aef54e4d', '00000000-0000-0000-0000-000000000001', 'Mesa 3', 3, true),
  ('2b4b1e7b-f843-4b6d-a027-56241084cbde', '00000000-0000-0000-0000-000000000001', 'Mesa 4', 4, true),
  ('59491496-7154-4d37-b8c2-0b5111746e91', '00000000-0000-0000-0000-000000000001', 'Mesa 5', 5, true),
  ('548f103c-ddbe-4b68-b2e4-25bb4ebf7b25', '00000000-0000-0000-0000-000000000001', 'Mesa 6', 6, true),
  ('dc1f8a50-0ab2-4d8a-8fb5-be481c6e5676', '00000000-0000-0000-0000-000000000001', 'Mesa 7', 7, true),
  ('7c642aee-2f26-4a73-b919-67b45cb2a599', '00000000-0000-0000-0000-000000000001', 'Mesa 8', 8, true),
  ('5edbcb62-bc7e-4ad8-ac4b-c1b6c58601bc', '00000000-0000-0000-0000-000000000001', 'Mesa 9', 9, true),
  ('b1af0b80-1c4b-4f70-8f79-1f2a1cbf1a5b', '00000000-0000-0000-0000-000000000001', 'Mesa 10', 10, true);

-- Restaurant Tables (Sucursal Avenida)
INSERT INTO public.restaurant_tables (id, branch_id, name, visual_order, is_active) VALUES
  ('e18ca149-afd8-4514-9ff2-44303bbf78bf', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 1', 1, true),
  ('548963d5-2f30-46b6-b7cc-75b9374c6233', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 2', 2, true),
  ('de4a917f-f9dc-4416-956a-60d37223c4ee', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 3', 3, true),
  ('809307e9-5361-4498-bf8d-56467035a531', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 4', 4, true),
  ('894ec757-60d4-4093-b4a6-5110f3f4548b', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 5', 5, true),
  ('6d409eaa-c4b6-4e1b-93b7-a53a1cd129a9', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 6', 6, true),
  ('de8b6bcf-764f-428e-9ae0-342c79e6ec75', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 7', 7, true),
  ('b92c0d03-d85e-4a26-b6ed-a59dcd909ae6', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 8', 8, true),
  ('efda0692-f87a-4d2c-b41e-a30c40904d90', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 9', 9, true),
  ('47aff4bb-5428-4f40-8cd4-cd06788c0a66', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Mesa 10', 10, true);

-- Denominations (Sucursal Principal)
INSERT INTO public.denominations (id, branch_id, label, value, display_order, is_active) VALUES
  ('2ff69b3c-a846-4a0d-aac5-0de7c808f15a', '00000000-0000-0000-0000-000000000001', '$0.05', 0.05, 1, true),
  ('2eaa9e6c-ca4a-4c8c-a7d0-d501670a89db', '00000000-0000-0000-0000-000000000001', '$0.10', 0.10, 2, true),
  ('8db8e32b-4d0f-4f31-9545-a5793904dfa0', '00000000-0000-0000-0000-000000000001', '$0.25', 0.25, 3, true),
  ('05b497f9-429b-449b-aa0a-8cebde052b78', '00000000-0000-0000-0000-000000000001', '$0.50', 0.50, 4, true),
  ('7f5929fc-aceb-46b0-91cb-613eee731c4b', '00000000-0000-0000-0000-000000000001', '$1.00', 1.00, 5, true),
  ('58d4fb9d-7ee6-4454-adc4-a20b54beae58', '00000000-0000-0000-0000-000000000001', '$5.00', 5.00, 6, true),
  ('98cf4228-13e1-4fc6-a875-8adc8f6fe460', '00000000-0000-0000-0000-000000000001', '$10.00', 10.00, 7, true),
  ('923d0dab-b92f-4e9d-934d-e7b94f02a975', '00000000-0000-0000-0000-000000000001', '$20.00', 20.00, 8, true),
  ('7b965bc8-e0ff-4a56-9c4f-cfae2519453f', '00000000-0000-0000-0000-000000000001', '$50.00', 50.00, 9, true),
  ('d6a48d86-4999-48c9-8eda-81303a9091cf', '00000000-0000-0000-0000-000000000001', '$100.00', 100.00, 10, true);

-- Payment Methods
INSERT INTO public.payment_methods (id, branch_id, name, is_active) VALUES
  ('d34d59ab-98eb-4376-a0fb-b1b4091785c7', '00000000-0000-0000-0000-000000000001', 'Efectivo', true),
  ('ec68c325-3e85-4d68-9cf3-4f2dabb92010', '00000000-0000-0000-0000-000000000001', 'Tarjeta', true),
  ('53e1287f-782d-4cc5-b236-be5cf196222e', '00000000-0000-0000-0000-000000000001', 'Transferencia', true),
  ('e5bd4b52-d1b9-438b-b70c-c6e18079772e', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Efectivo', true),
  ('0892bf97-75ba-4bb1-9147-9bad56fa353e', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Tarjeta', true),
  ('42937ce2-f89e-45be-af6a-fcb08dc85695', 'c9386d9b-d979-487d-ad12-cbc370472adb', 'Transferencia', true);

-- System Settings
INSERT INTO public.system_settings (key, value) VALUES
  ('high_affluence', '{"enabled": false}'),
  ('restaurant_name', '"Picantería El Pulpo"');

-- ═══════════════════════════════════════════════════════════
-- 7. REALTIME (si lo necesitas)
-- ═══════════════════════════════════════════════════════════
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;

-- ═══════════════════════════════════════════════════════════
-- 8. USUARIOS (crear manualmente en Auth)
-- ═══════════════════════════════════════════════════════════
-- Debes crear estos usuarios en tu Supabase Dashboard → Auth → Users:
--
-- | Email              | Password   | Metadata (full_name, username)         |
-- |--------------------|------------|----------------------------------------|
-- | admin@pulpo.com    | (tu pass)  | full_name: Administrador, username: admin |
-- | mesero1@pulpo.com  | (tu pass)  | full_name: Carlos Mesero, username: mesero1 |
-- | mesero2@pulpo.com  | (tu pass)  | full_name: María Mesera, username: mesero2 |
-- | cajero1@pulpo.com  | (tu pass)  | full_name: Ana Cajera, username: cajero1 |
-- | cocina1@pulpo.com  | (tu pass)  | full_name: Pedro Cocina, username: cocina1 |
-- | super@pulpo.com    | (tu pass)  | full_name: Super Usuario, username: superuser |
--
-- Después de crearlos, inserta sus roles y branches:
-- INSERT INTO public.user_roles (user_id, role) VALUES ('<nuevo_uuid>', 'admin');
-- INSERT INTO public.user_branches (user_id, branch_id) VALUES ('<nuevo_uuid>', '00000000-0000-0000-0000-000000000001');
--
-- Los productos de Sucursal Principal que venían del seed original
-- deben ser insertados también (tienen IDs como a12a0f73..., etc).
-- Si ejecutaste el seed-users edge function, ya los tendrás.
