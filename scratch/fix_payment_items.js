import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function fix() {
  console.log("Fixing payment_items for existing voided payments...");

  // 1. Payment 7b390a00-22fe-4b8c-a933-5ef252fe3a62 (voided $1.75)
  // Delete the payment item for Enc. Pescado (Grande) from this payment
  const { data: pi3, error: e3 } = await supabase
    .from("payment_items")
    .select(`
      id,
      order_item_id (
        description_snapshot
      )
    `)
    .eq("payment_id", "7b390a00-22fe-4b8c-a933-5ef252fe3a62");

  if (e3) {
    console.error("Error fetching payment_items for 7b390a00:", e3);
  } else {
    for (const item of pi3 || []) {
      const desc = item.order_item_id?.description_snapshot || "";
      if (desc.includes("Grande")) {
        const { error: delErr } = await supabase
          .from("payment_items")
          .delete()
          .eq("id", item.id);
        if (delErr) {
          console.error("Error deleting item:", delErr);
        } else {
          console.log("Deleted Enc. Pescado (Grande) payment item from voided payment 7b390a00");
        }
      }
    }
  }

  // 2. Payment 70791620-3fda-47ef-8b05-3397bf43eb0f (voided $4.50)
  // Update the payment item for Enc. Pescado (Grande) to quantity_paid = 2, total_amount = 4.50
  const { data: pi2, error: e2 } = await supabase
    .from("payment_items")
    .select(`
      id,
      order_item_id (
        description_snapshot
      )
    `)
    .eq("payment_id", "70791620-3fda-47ef-8b05-3397bf43eb0f");

  if (e2) {
    console.error("Error fetching payment_items for 70791620:", e2);
  } else {
    for (const item of pi2 || []) {
      const desc = item.order_item_id?.description_snapshot || "";
      if (desc.includes("Grande")) {
        const { error: updErr } = await supabase
          .from("payment_items")
          .update({
            quantity_paid: 2,
            total_amount: 4.50
          })
          .eq("id", item.id);
        if (updErr) {
          console.error("Error updating item:", updErr);
        } else {
          console.log("Updated Enc. Pescado (Grande) payment item quantity to 2 in voided payment 70791620");
        }
      }
    }
  }

  console.log("Payment items cleanup complete!");
}

fix();
