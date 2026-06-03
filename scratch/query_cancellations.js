import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data: cancellations, error: cError } = await supabase
    .from("order_cancellations")
    .select(`
      id,
      order_id,
      cancellation_type,
      reason,
      status,
      order_item_cancellations (
        *
      )
    `)
    .in("order_id", ["34a31922-8c70-47ae-911c-9d680857a13e", "bf5be948-1450-4c63-bed8-fcddc3240432"]);

  if (cError) {
    console.error("Error fetching cancellations:", cError);
    return;
  }

  console.log("CANCELLATIONS:");
  for (const c of cancellations) {
    console.log(`\nCancellation ID: ${c.id} for Order: ${c.order_id}`);
    console.log(`Type: ${c.cancellation_type}, Reason: ${c.reason}, Status: ${c.status}`);
    console.log(`Item Cancellations:`);
    for (const oic of c.order_item_cancellations || []) {
      console.log(`  - Item ID: ${oic.order_item_id}, Qty Cancelled: ${oic.quantity_cancelled}`);
    }
  }
}

check();
