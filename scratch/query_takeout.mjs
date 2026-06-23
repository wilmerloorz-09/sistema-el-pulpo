import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

const credentials = [
  { email: 'admin@elpulpo.com', password: 'admin123' },
  { email: 'super@elpulpo.com', password: 'super123' },
  { email: 'admin1@elpulpo.com', password: 'ElPulpo2026!' },
  { email: 'wilmerloor@yahoo.com', password: '12345678' },
  { email: 'ivonne@hotmail.com', password: '12345678' },
  { email: 'mesero1@elpulpo.com', password: 'mesero123' },
  { email: 'mesero2@elpulpo.com', password: 'mesero123' },
  { email: 'cajero@elpulpo.com', password: 'cajero123' },
  { email: 'cocina@elpulpo.com', password: 'cocina123' },
];

async function run() {
  let authenticatedClient = null;
  let loggedInUser = null;

  for (const cred of credentials) {
    try {
      console.log(`Trying auth: ${cred.email}...`);
      const { data, error } = await s.auth.signInWithPassword({
        email: cred.email,
        password: cred.password
      });
      if (!error && data?.user) {
        console.log(`SUCCESS: Authenticated as ${cred.email}`);
        authenticatedClient = s;
        loggedInUser = data.user;
        break;
      } else {
        console.log(`Failed for ${cred.email}: ${error?.message || 'Unknown error'}`);
      }
    } catch (e) {
      console.log(`Error authenticating ${cred.email}:`, e.message);
    }
  }

  if (!authenticatedClient) {
    console.error("All authentication attempts failed.");
    return;
  }

  // 1. Get branches
  const { data: branches, error: errBranches } = await s
    .from('branches')
    .select('*');
  console.log("\n=== BRANCHES ===");
  console.log(JSON.stringify(branches, null, 2));

  // 2. Get open cash shifts
  const { data: shifts, error: errShifts } = await s
    .from('cash_shifts')
    .select('id, status, opened_at, closed_at, branch_id, branches(name)')
    .eq('status', 'OPEN');

  if (errShifts) {
    console.error("Error fetching shifts:", errShifts);
    return;
  }
  console.log("\n=== OPEN CASH SHIFTS ===");
  console.log(JSON.stringify(shifts, null, 2));

  // 3. Fetch TAKEOUT orders for open shifts (or all if empty)
  const openShiftIds = shifts.map(sh => sh.id);
  console.log(`\n=== FETCHING TAKEOUT ORDERS (Shift IDs filter: ${openShiftIds.length > 0 ? openShiftIds.join(', ') : 'NONE'}) ===`);
  
  let query = s
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
      order_items (
        id,
        description_snapshot,
        quantity,
        unit_price,
        total,
        status
      )
    `)
    .eq('order_type', 'TAKEOUT')
    .eq('is_special', false)
    .eq('is_tray_order', false);

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

  console.log(`Found ${orders.length} orders:`);
  for (const o of orders) {
    console.log({
      id: o.id,
      order_number: o.order_number,
      order_code: o.order_code,
      status: o.status,
      branch_id: o.branch_id,
      cash_shift_id: o.cash_shift_id,
      created_at: o.created_at,
      created_by: o.created_by,
      item_count: o.order_items?.length ?? 0,
      total: o.order_items?.reduce((sum, item) => sum + Number(item.total || 0), 0) ?? 0,
      items: o.order_items
    });
  }
}

run();
