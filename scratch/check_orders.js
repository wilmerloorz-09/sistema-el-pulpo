
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkOrders() {
  const { data: orders } = await supabase.from('orders').select('id, branch_id, status').eq('status', 'SENT_TO_KITCHEN').limit(5);
  console.log('Orders (SENT_TO_KITCHEN):', JSON.stringify(orders, null, 2));
}

checkOrders();
