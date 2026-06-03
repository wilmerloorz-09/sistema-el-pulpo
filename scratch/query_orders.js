import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data: orders, error: oError } = await supabase
    .from("orders")
    .select(`
      id,
      order_code,
      status,
      notes,
      total,
      order_items (
        id,
        description_snapshot,
        quantity,
        unit_price,
        total,
        status
      )
    `)
    .ilike("order_code", "SUC004260602-%")
    .order("order_code", { ascending: true });

  if (oError) {
    console.error("Error fetching orders:", oError);
    return;
  }

  console.log("FOUND ORDERS:");
  for (const order of orders) {
    console.log(`\nOrder: ${order.order_code} (ID: ${order.id})`);
    console.log(`Status: ${order.status}`);
    console.log(`Notes: ${order.notes}`);
    console.log(`Items:`);
    for (const item of order.order_items || []) {
      console.log(`  - ${item.description_snapshot}: Qty ${item.quantity}, Price ${item.unit_price}, Total ${item.total}, Status ${item.status}`);
    }
  }
}

check();
