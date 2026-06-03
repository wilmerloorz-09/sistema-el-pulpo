import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase credentials in env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  // Find order
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('order_code', 'SUC004260602-0003');
    
  if (oErr) {
    console.error("Error fetching order:", oErr);
    return;
  }
  
  if (!orders || orders.length === 0) {
    console.log("No order found for SUC004260602-0003");
    return;
  }
  
  const order = orders[0];
  console.log("Order found:", {
    id: order.id,
    order_code: order.order_code,
    status: order.status,
    paid_at: order.paid_at,
    notes: order.notes
  });
  
  // Find payments
  const { data: payments, error: pErr } = await supabase
    .from('payments')
    .select('*')
    .eq('order_id', order.id);
    
  if (pErr) {
    console.error("Error fetching payments:", pErr);
    return;
  }
  
  console.log(`Found ${payments.length} payments:`);
  for (const p of payments) {
    console.log(`- ID: ${p.id}, status: ${p.status}, amount: ${p.amount}, notes: ${p.notes}, created_at: ${p.created_at}`);
    
    // Find payment items
    const { data: items, error: iErr } = await supabase
      .from('payment_items')
      .select('*')
      .eq('payment_id', p.id);
      
    if (iErr) {
      console.error("  Error fetching items:", iErr);
    } else {
      console.log(`  Items (${items.length}):`);
      for (const item of items) {
        console.log(`    * ItemID: ${item.id}, order_item_id: ${item.order_item_id}, qty: ${item.quantity_paid}, total: ${item.total_amount}`);
      }
    }
  }
}

check();
