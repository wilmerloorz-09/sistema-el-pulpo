const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const pIds = [
    '7b390a00-22fe-4b8c-a933-5ef252fe3a62', // voided
    '43834518-d72a-411b-8603-c21d997f49e0', // successor
    '70791620-3fda-47ef-8b05-3397bf43eb0f', // voided
    'e3e73305-7da2-40d7-b93d-ca98644b3a06'  // successor
  ];

  for (const pid of pIds) {
    const { data: payment, error: pe } = await supabase
      .from('payments')
      .select('id, amount, status, notes, order_id')
      .eq('id', pid)
      .single();

    if (pe) {
      console.error("PE Error:", pe);
      continue;
    }

    console.log(`\n============================`);
    console.log(`Payment: ${payment.id}`);
    console.log(`Status: ${payment.status}`);
    console.log(`Amount: ${payment.amount}`);
    console.log(`Notes: ${payment.notes}`);
    console.log(`Order ID: ${payment.order_id}`);

    const { data: items, error: ie } = await supabase
      .from('payment_items')
      .select(`
        id,
        quantity_paid,
        unit_price,
        total_amount,
        order_item_id,
        order_items ( description_snapshot, total, status )
      `)
      .eq('payment_id', pid);

    if (ie) {
      console.error("IE Error:", ie);
      continue;
    }

    console.log(`Items (${items.length}):`);
    for (const item of items) {
      console.log(`- ItemID: ${item.order_item_id}`);
      console.log(`  Desc: ${item.order_items?.description_snapshot}`);
      console.log(`  Qty Paid: ${item.quantity_paid}`);
      console.log(`  Total: ${item.total_amount}`);
      console.log(`  Item Status: ${item.order_items?.status}`);
    }
  }
}

run();
