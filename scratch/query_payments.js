import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data: payments, error: pError } = await supabase
    .from("payments")
    .select(`
      id,
      order_id,
      amount,
      status,
      notes,
      voided_at,
      payment_items (
        id,
        quantity_paid,
        unit_price,
        total_amount,
        order_item_id (
          id,
          description_snapshot
        )
      )
    `)
    .in("order_id", ["34a31922-8c70-47ae-911c-9d680857a13e", "6f779a66-794d-4250-b16e-8cde5111969d"]);

  if (pError) {
    console.error("Error fetching payments:", pError);
    return;
  }

  console.log("PAYMENTS AND PAYMENT_ITEMS:");
  for (const payment of payments) {
    console.log(`\nPayment: ${payment.id} for Order ID: ${payment.order_id}`);
    console.log(`Status: ${payment.status}, Amount: ${payment.amount}, Voided At: ${payment.voided_at}`);
    console.log(`Notes: ${payment.notes}`);
    console.log(`Payment Items:`);
    for (const pi of payment.payment_items || []) {
      console.log(`  - ${pi.order_item_id?.description_snapshot || 'Unknown'}: Qty Paid ${pi.quantity_paid}, Price ${pi.unit_price}, Total ${pi.total_amount}`);
    }
  }
}

check();
