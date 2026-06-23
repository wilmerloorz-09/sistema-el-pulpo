import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  const { error: authError } = await s.auth.signInWithPassword({
    email: 'ivonne@hotmail.com',
    password: '12345678'
  });
  if (authError) {
    console.error("Auth failed:", authError.message);
    return;
  }

  const branchId = '3ea2076c-1cda-4583-913b-e23be6819201'; // Local Principal (Chone)
  const shiftId = 'e7bc2a64-3461-4387-ae5d-2c8790e153c2'; // Open shift

  const { data: orders, error: errOrders } = await s
    .from('orders')
    .select(`
      id,
      order_number,
      order_code,
      status,
      order_type,
      branch_id,
      cash_shift_id,
      created_at,
      created_by,
      is_special,
      is_tray_order,
      table_order_position,
      notes,
      profiles:profiles!orders_created_by_fkey (id, full_name, first_name, username),
      order_items (
        id,
        total
      )
    `)
    .eq('branch_id', branchId)
    .eq('order_type', 'TAKEOUT')
    .eq('is_special', false)
    .eq('is_tray_order', false)
    .eq('cash_shift_id', shiftId)
    .in('status', ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID", "KITCHEN_DISPATCHED"]);

  if (errOrders) {
    console.error("Error fetching orders:", errOrders);
    return;
  }

  // Map them to SiblingOrder structure exactly as fetchTakeoutSiblingOrders does:
  const siblingOrders = orders.map(sibling => ({
    id: sibling.id,
    order_number: sibling.order_number,
    order_code: sibling.order_code ?? null,
    status: sibling.status ?? null,
    created_by_name: sibling.profiles ? (sibling.profiles.full_name || sibling.profiles.first_name || sibling.profiles.username || "Usuario") : "Usuario",
    table_order_position: Number(sibling.table_order_position ?? 0) || null,
    created_at: sibling.created_at ?? null,
    item_count: Array.isArray(sibling.order_items) ? sibling.order_items.length : 0,
    total: Array.isArray(sibling.order_items)
      ? sibling.order_items.reduce((sum, item) => sum + Number(item.total ?? 0), 0)
      : 0,
  }));

  // Compare/sort using compareSiblingOrderTabs:
  function compareSiblingOrderTabs(left, right) {
    const byTime = String(left.created_at ?? "").localeCompare(String(right.created_at ?? ""));
    if (byTime !== 0) return byTime;
    const leftPos = Number(left.table_order_position ?? Number.MAX_SAFE_INTEGER);
    const rightPos = Number(right.table_order_position ?? Number.MAX_SAFE_INTEGER);
    if (leftPos !== rightPos) return leftPos - rightPos;
    return String(left.id).localeCompare(String(right.id));
  }

  siblingOrders.sort(compareSiblingOrderTabs);

  // Apply the frontend filter:
  // orders.filter((order) => order.status !== "DRAFT" || Number(order.item_count ?? 0) > 0)
  const filteredOrders = siblingOrders.filter(order => order.status !== "DRAFT" || Number(order.item_count ?? 0) > 0);

  console.log("\n=== ALL SIBLING ORDERS (SORTED) ===");
  siblingOrders.forEach((o, index) => {
    console.log(`[#${index + 1}] ID: ${o.id}`);
    console.log(`      Code/Num: ${o.order_code} / ${o.order_number}`);
    console.log(`      Status: ${o.status}`);
    console.log(`      Item count: ${o.item_count}`);
    console.log(`      Total: $${o.total}`);
    console.log(`      Created by: ${o.created_by_name}`);
    console.log(`      Created at: ${o.created_at}`);
    console.log(`      Table order position: ${o.table_order_position}`);
    console.log(`      Passes frontend filter: ${o.status !== "DRAFT" || o.item_count > 0 ? "YES" : "NO"}`);
    console.log("--------------------------------------------------");
  });

  console.log("\n=== FILTERED ORDERS SHOWN IN UI ===");
  filteredOrders.forEach((o, index) => {
    console.log(`Card #${index + 1} in UI:`);
    console.log(`   Order Ref name: ${o.order_code ? o.order_code : 'Orden ' + (index + 1)}`);
    console.log(`   Status: ${o.status}`);
    console.log(`   Items: ${o.item_count}`);
    console.log(`   Total: $${o.total}`);
    console.log(`   Creator: ${o.created_by_name}`);
  });
}

run();
