const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
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
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log(`Found ${payments.length} payments:`);
  for (const p of payments) {
    console.log(`- ID: ${p.id}, Code: ${p.orders?.order_code || 'N/D'}, Num: ${p.orders?.order_number}, Status: ${p.status}, Amount: ${p.amount}, Notes: ${p.notes}, Date: ${p.created_at}`);
  }
}

check();
