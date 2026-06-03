import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  console.log("=== Columns of cash_shift_denoms ===");
  const { data: cols, error: errCols } = await supabase.from("_dummy" as any).select("*").limit(0).then(() => {
    // We can run a select on information_schema or similar table if it's exposed, or just select 1 row from cash_shift_denoms
    return supabase.from("cash_shift_denoms").select("*").limit(1);
  });
  console.log(cols || errCols);
}

check();
