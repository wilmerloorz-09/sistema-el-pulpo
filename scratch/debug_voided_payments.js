import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envStr = fs.readFileSync(".env", "utf8");
const env = envStr.split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=");
  if (k) acc[k.trim()] = v.join("=").trim().replace(/^"|"$/g, "");
  return acc;
}, {});

const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";
const supabase = createClient(env.VITE_SUPABASE_URL, serviceRoleKey);

async function run() {
  console.log("Mocking completedPaymentsQuery logic...");
  
  // 1. Get branch orders
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_type, is_special, order_code, order_number, table_name_snapshot, status");
  
  const orderIds = orders.map(o => o.id);

  // 2. Get payments
  const { data: payments } = await supabase
    .from("payments")
    .select("id, created_at, amount, notes, order_id, payment_method_id, created_by, status")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });

  // Filter payments like allPaymentsInRange
  console.log("Total payments loaded:", payments.length);
  const testPayments = payments.filter(p => p.id === '7b390a00-22fe-4b8c-a933-5ef252fe3a62' || p.id === '43834518-d72a-411b-8603-c21d997f49e0');
  console.log("Our test payments:", testPayments);

  // 3. Load payment items
  const { data: paymentItems } = await supabase
    .from("payment_items")
    .select("id, payment_id, order_item_id, quantity_paid, unit_price, total_amount")
    .in("payment_id", testPayments.map(p => p.id));
  console.log("Payment items loaded:", paymentItems);

  // 4. Load order items
  const { data: orderItems } = await supabase
    .from("order_items")
    .select("id, order_id, total, status, description_snapshot, quantity, unit_price, tray_item_type")
    .in("order_id", testPayments.map(p => p.order_id));
  console.log("Order items loaded:", orderItems);
}

run();
