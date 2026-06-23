import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://apmsuigcveqtjzbpfihb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ';
const s = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Checking active/recent cash shifts...");
  const { data: shifts, error: errShifts } = await s
    .from('cash_shifts')
    .select('id, status, opened_at, closed_at, branch_id')
    .order('opened_at', { ascending: false })
    .limit(5);

  if (errShifts) {
    console.error("Error fetching shifts:", errShifts);
    return;
  }
  console.log("Recent cash shifts:", shifts);

  // Let's find all TAKEOUT orders in the current open cash shift(s)
  const openShiftIds = shifts.filter(sh => sh.status === 'OPEN').map(sh => sh.id);
  console.log("Open shift IDs:", openShiftIds);

  console.log("\nQuerying TAKEOUT orders for open shifts (or last 20 if no open shifts):");
  let query = s.from('orders').select(`
    id,
    order_number,
    order_code,
    status,
    order_type,
    branch_id,
    cash_shift_id,
    created_at,
    created_by,
    profiles:profiles!orders_created_by_fkey (first_name, full_name),
    order_items (id, total, status)
  `).eq('order_type', 'TAKEOUT');

  if (openShiftIds.length > 0) {
    query = query.in('cash_shift_id', openShiftIds);
  } else {
    query = query.order('created_at', { ascending: false }).limit(20);
  }

  const { data: orders, error: errOrders } = await query;
  if (errOrders) {
    console.error("Error fetching orders:", errOrders);
    return;
  }

  console.log(`Found ${orders.length} TAKEOUT orders.`);

  for (const o of orders) {
    const itemCount = o.order_items ? o.order_items.length : 0;
    const total = o.order_items ? o.order_items.reduce((sum, item) => sum + Number(item.total || 0), 0) : 0;
    const creatorName = o.profiles ? (o.profiles.full_name || o.profiles.first_name) : 'Unknown';
    console.log(`Order ID: ${o.id}`);
    console.log(`  Number: ${o.order_number}, Code: ${o.order_code}`);
    console.log(`  Status: ${o.status}`);
    console.log(`  Created At: ${o.created_at}`);
    console.log(`  Creator: ${creatorName} (${o.created_by})`);
    console.log(`  Items Count: ${itemCount}, Total: $${total}`);
    if (itemCount > 0) {
      console.log(`  Items:`, o.order_items);
    }
    console.log('--------------------------------------------');
  }
}

run();
