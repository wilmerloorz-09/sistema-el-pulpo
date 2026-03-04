
-- Drop all RESTRICTIVE policies and recreate as PERMISSIVE for all admin-managed tables

-- categories
DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated can view categories" ON public.categories;

CREATE POLICY "Authenticated can view categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- subcategories
DROP POLICY IF EXISTS "Admins can delete subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "Admins can insert subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "Admins can update subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "Authenticated can view subcategories" ON public.subcategories;

CREATE POLICY "Authenticated can view subcategories" ON public.subcategories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert subcategories" ON public.subcategories FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update subcategories" ON public.subcategories FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete subcategories" ON public.subcategories FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- products
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;
DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "Authenticated can view products" ON public.products;

CREATE POLICY "Authenticated can view products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- restaurant_tables
DROP POLICY IF EXISTS "Admins can delete tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Admins can insert tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Admins can update tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Authenticated can view tables" ON public.restaurant_tables;

CREATE POLICY "Authenticated can view tables" ON public.restaurant_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert tables" ON public.restaurant_tables FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update tables" ON public.restaurant_tables FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete tables" ON public.restaurant_tables FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- modifiers
DROP POLICY IF EXISTS "Admins can delete modifiers" ON public.modifiers;
DROP POLICY IF EXISTS "Admins can insert modifiers" ON public.modifiers;
DROP POLICY IF EXISTS "Admins can update modifiers" ON public.modifiers;
DROP POLICY IF EXISTS "Authenticated can view modifiers" ON public.modifiers;

CREATE POLICY "Authenticated can view modifiers" ON public.modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert modifiers" ON public.modifiers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update modifiers" ON public.modifiers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete modifiers" ON public.modifiers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- payment_methods
DROP POLICY IF EXISTS "Admins can delete payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can insert payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can update payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Authenticated can view payment methods" ON public.payment_methods;

CREATE POLICY "Authenticated can view payment methods" ON public.payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert payment methods" ON public.payment_methods FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update payment methods" ON public.payment_methods FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete payment methods" ON public.payment_methods FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- denominations
DROP POLICY IF EXISTS "Admins can delete denominations" ON public.denominations;
DROP POLICY IF EXISTS "Admins can insert denominations" ON public.denominations;
DROP POLICY IF EXISTS "Admins can update denominations" ON public.denominations;
DROP POLICY IF EXISTS "Authenticated can view denominations" ON public.denominations;

CREATE POLICY "Authenticated can view denominations" ON public.denominations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert denominations" ON public.denominations FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update denominations" ON public.denominations FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete denominations" ON public.denominations FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- profiles
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Authenticated can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- user_roles
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated can view roles" ON public.user_roles;

CREATE POLICY "Authenticated can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Also fix other tables that had restrictive policies

-- audit_log
DROP POLICY IF EXISTS "Admins can view audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Staff can insert audit log" ON public.audit_log;
CREATE POLICY "Admins can view audit log" ON public.audit_log FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can insert audit log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));

-- cash_movements
DROP POLICY IF EXISTS "Authenticated can view movements" ON public.cash_movements;
DROP POLICY IF EXISTS "Cajeros can insert movements" ON public.cash_movements;
CREATE POLICY "Authenticated can view movements" ON public.cash_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert movements" ON public.cash_movements FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- cash_shift_denoms
DROP POLICY IF EXISTS "Authenticated can view shift denoms" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Cajeros can insert shift denoms" ON public.cash_shift_denoms;
DROP POLICY IF EXISTS "Cajeros can update shift denoms" ON public.cash_shift_denoms;
CREATE POLICY "Authenticated can view shift denoms" ON public.cash_shift_denoms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert shift denoms" ON public.cash_shift_denoms FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Cajeros can update shift denoms" ON public.cash_shift_denoms FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- cash_shifts
DROP POLICY IF EXISTS "Authenticated can view shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cajeros can insert shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cajeros can update shifts" ON public.cash_shifts;
CREATE POLICY "Authenticated can view shifts" ON public.cash_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert shifts" ON public.cash_shifts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Cajeros can update shifts" ON public.cash_shifts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- order_item_modifiers
DROP POLICY IF EXISTS "Authenticated can view item modifiers" ON public.order_item_modifiers;
DROP POLICY IF EXISTS "Staff can delete item modifiers" ON public.order_item_modifiers;
DROP POLICY IF EXISTS "Staff can insert item modifiers" ON public.order_item_modifiers;
DROP POLICY IF EXISTS "Staff can update item modifiers" ON public.order_item_modifiers;
CREATE POLICY "Authenticated can view item modifiers" ON public.order_item_modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert item modifiers" ON public.order_item_modifiers FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update item modifiers" ON public.order_item_modifiers FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete item modifiers" ON public.order_item_modifiers FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- order_items
DROP POLICY IF EXISTS "Authenticated can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff can delete order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff can update order items" ON public.order_items;
CREATE POLICY "Authenticated can view order items" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert order items" ON public.order_items FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update order items" ON public.order_items FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete order items" ON public.order_items FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- orders
DROP POLICY IF EXISTS "Authenticated can view orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can delete orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can update orders" ON public.orders;
CREATE POLICY "Authenticated can view orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update orders" ON public.orders FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete orders" ON public.orders FOR DELETE TO authenticated USING (has_any_role(auth.uid()));

-- payments
DROP POLICY IF EXISTS "Authenticated can view payments" ON public.payments;
DROP POLICY IF EXISTS "Cajeros can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Cajeros can update payments" ON public.payments;
CREATE POLICY "Authenticated can view payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cajeros can insert payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Cajeros can update payments" ON public.payments FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cajero'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- system_settings
DROP POLICY IF EXISTS "Admins can insert settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated can view settings" ON public.system_settings;
CREATE POLICY "Authenticated can view settings" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert settings" ON public.system_settings FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update settings" ON public.system_settings FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- table_splits
DROP POLICY IF EXISTS "Authenticated can view splits" ON public.table_splits;
DROP POLICY IF EXISTS "Staff can delete splits" ON public.table_splits;
DROP POLICY IF EXISTS "Staff can manage splits" ON public.table_splits;
DROP POLICY IF EXISTS "Staff can update splits" ON public.table_splits;
CREATE POLICY "Authenticated can view splits" ON public.table_splits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage splits" ON public.table_splits FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff can update splits" ON public.table_splits FOR UPDATE TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff can delete splits" ON public.table_splits FOR DELETE TO authenticated USING (has_any_role(auth.uid()));
