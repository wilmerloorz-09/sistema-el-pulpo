import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data: orders, error: oError } = await supabase
    .from("orders")
    .select("order_code, total, status")
    .ilike("order_code", "SUC004260602-%");

  if (oError) {
    console.error(oError);
    return;
  }
  console.log(orders);
}

check();
