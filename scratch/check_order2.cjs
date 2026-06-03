const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const codes = [
    'SUC004260602-0002',
    'SUC004260602-0008',
    'SUC004260602-0003',
    'SUC004260602-0004'
  ];

  for (const code of codes) {
    const { data: order, error: oe } = await supabase
      .from('orders')
      .select('id, order_code, order_number, status')
      .eq('order_code', code)
      .single();

    if (oe) {
      console.error(`Error for ${code}:`, oe);
      continue;
    }

    console.log(`\n============================`);
    console.log(`Order: ${order.order_code} (Num: ${order.order_number})`);
    console.log(`ID: ${order.id}`);
    console.log(`Status: ${order.status}`);

    // Fetch order items
    const { data: items, error: ie } = await supabase
      .from('order_items')
      .select('id, description_snapshot, quantity, total, status, paid_at')
      .eq('order_id', order.id);

    if (ie) {
      console.error(`Error items for ${code}:`, ie);
    } else {
      console.log(`Items (${items.length}):`);
      for (const item of items) {
        console.log(`- ItemID: ${item.id}, Desc: ${item.description_snapshot}, Qty: ${item.quantity}, Total: ${item.total}, Status: ${item.status}, PaidAt: ${item.paid_at}`);
      }
    }

    // Fetch payments
    const { data: payments, error: pe } = await supabase
      .from('payments')
      .select('id, amount, status, notes')
      .eq('order_id', order.id);

    if (pe) {
      console.error(`Error payments for ${code}:`, pe);
    } else {
      console.log(`Payments (${payments.length}):`);
      for (const payment of payments) {
        console.log(`- ID: ${payment.id}, Amount: ${payment.amount}, Status: ${payment.status}, Notes: ${payment.notes}`);
      }
    }
  }
}

run();
