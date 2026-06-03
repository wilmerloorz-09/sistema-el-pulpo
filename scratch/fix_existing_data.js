import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function fix() {
  console.log("Fixing order items and cancellations for existing voids...");

  // 1. Fix SUC004260602-0003 (Historical) and SUC004260602-0004 (Successor)
  // Old order (34a31922-8c70-47ae-911c-9d680857a13e) - Enc. Pescado (Grande) was NOT voided, only Enc. Pescado (Pequeño) ($1.75).
  // Successor order (6f779a66-794d-4250-b16e-8cde5111969d) - Enc. Pescado (Pequeño) was voided, so it should not be in the successor order.
  
  // We need to find the cancellation record for SUC004260602-0003
  const { data: cancellation3 } = await supabase
    .from("order_cancellations")
    .select("id")
    .eq("order_id", "34a31922-8c70-47ae-911c-9d680857a13e")
    .single();

  if (cancellation3) {
    // Insert order_item_cancellation for Enc. Pescado (Pequeño) (item_id: find it first)
    const { data: items3 } = await supabase
      .from("order_items")
      .select("id, description_snapshot, quantity, unit_price")
      .eq("order_id", "34a31922-8c70-47ae-911c-9d680857a13e");

    const pequenoItem = items3?.find(i => i.description_snapshot.includes("Pequeño"));
    const grandeItem = items3?.find(i => i.description_snapshot.includes("Grande"));

    if (pequenoItem) {
      // Create cancellation row
      await supabase.from("order_item_cancellations").insert({
        order_cancellation_id: cancellation3.id,
        order_id: "34a31922-8c70-47ae-911c-9d680857a13e",
        order_item_id: pequenoItem.id,
        quantity_cancelled: 1,
        unit_price: pequenoItem.unit_price,
        total_amount: 1.75
      });
      console.log("Inserted order_item_cancellations for SUC004260602-0003 Pequeño");
    }

    // Successor: delete Pequeño item from SUC004260602-0004
    const { data: items4 } = await supabase
      .from("order_items")
      .select("id, description_snapshot")
      .eq("order_id", "6f779a66-794d-4250-b16e-8cde5111969d");

    const smallItem4 = items4?.find(i => i.description_snapshot.includes("Pequeño"));
    if (smallItem4) {
      await supabase.from("order_items").delete().eq("id", smallItem4.id);
      console.log("Deleted Pequeño from successor order SUC004260602-0004");
    }
  }

  // 2. Fix SUC004260602-0002 (Historical) and SUC004260602-0008 (Successor)
  // Old order (bf5be948-1450-4c63-bed8-fcddc3240432) has Enc. Pescado (Grande) Qty 4. Voided amount was $4.50 (Qty 2).
  // Successor order (62e8da53-8dd2-4dc1-b8a4-1ec1cde88a97) has Enc. Pescado (Grande) Qty 4. Should be Qty 2.
  
  const { data: cancellation2 } = await supabase
    .from("order_cancellations")
    .select("id")
    .eq("order_id", "bf5be948-1450-4c63-bed8-fcddc3240432")
    .single();

  if (cancellation2) {
    const { data: items2 } = await supabase
      .from("order_items")
      .select("id, description_snapshot, quantity, unit_price")
      .eq("order_id", "bf5be948-1450-4c63-bed8-fcddc3240432");

    const grandeItem2 = items2?.find(i => i.description_snapshot.includes("Grande"));

    if (grandeItem2) {
      // Create cancellation row for Qty 2
      await supabase.from("order_item_cancellations").insert({
        order_cancellation_id: cancellation2.id,
        order_id: "bf5be948-1450-4c63-bed8-fcddc3240432",
        order_item_id: grandeItem2.id,
        quantity_cancelled: 2,
        unit_price: grandeItem2.unit_price,
        total_amount: 4.50
      });
      console.log("Inserted order_item_cancellations for SUC004260602-0002 Grande (Qty 2)");
    }

    // Successor: update Qty of Grande in SUC004260602-0008 to 2
    const { data: items8 } = await supabase
      .from("order_items")
      .select("id, description_snapshot")
      .eq("order_id", "62e8da53-8dd2-4dc1-b8a4-1ec1cde88a97");

    const grandeItem8 = items8?.find(i => i.description_snapshot.includes("Grande"));
    if (grandeItem8) {
      await supabase.from("order_items").update({
        quantity: 2,
        total: 4.50
      }).eq("id", grandeItem8.id);
      console.log("Updated Grande quantity to 2 in successor order SUC004260602-0008");
    }
  }

  // 3. Trigger recalculation for all 4 orders to update status, paid_at, etc.
  console.log("Recalculating check balances...");
  await supabase.rpc("recalculate_check_balance", { p_check_id: "34a31922-8c70-47ae-911c-9d680857a13e" });
  await supabase.rpc("recalculate_check_balance", { p_check_id: "6f779a66-794d-4250-b16e-8cde5111969d" });
  await supabase.rpc("recalculate_check_balance", { p_check_id: "bf5be948-1450-4c63-bed8-fcddc3240432" });
  await supabase.rpc("recalculate_check_balance", { p_check_id: "62e8da53-8dd2-4dc1-b8a4-1ec1cde88a97" });

  console.log("Database cleanup and recalculation complete!");
}

fix();
