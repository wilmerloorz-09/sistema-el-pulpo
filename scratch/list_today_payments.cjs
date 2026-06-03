const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function check() {
  const today = new Date().toISOString().split('T')[0];
  console.log("Checking payments for date:", today);
  
  const { data: payments, error } = await supabase
    .from('payments')
    .select(`
      id,
      created_at,
      amount,
      status,
      notes,
      order_id,
      orders ( order_code, order_number )
    `)
    .gte('created_at', today + 'T00:00:00.000Z')
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log(`Found ${payments.length} payments today:`);
  for (const p of payments) {
    console.log(`- ID: ${p.id}, Code: ${p.orders?.order_code || 'N/D'}, Num: ${p.orders?.order_number}, Status: ${p.status}, Amount: ${p.amount}, Notes: ${p.notes}`);
  }
}

check();
