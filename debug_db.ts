import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql: "SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'profiles';"
  });
  console.log("Profiles Policies:", data || error);
}

check();
