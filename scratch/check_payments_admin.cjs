const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function check() {
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
