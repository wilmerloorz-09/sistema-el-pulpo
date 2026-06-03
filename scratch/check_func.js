import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://apmsuigcveqtjzbpfihb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ"
);

async function check() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql: `
      SELECT prosrc 
      FROM pg_proc 
      WHERE proname = 'approve_and_void_payment';
    `
  });
  if (error) {
    console.error(error);
  } else {
    console.log(data?.[0]?.prosrc);
  }
}

check();
