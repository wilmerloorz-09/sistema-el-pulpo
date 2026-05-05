
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkShifts() {
  const { data: shifts } = await supabase.from('cash_shifts').select('*').eq('status', 'OPEN');
  console.log('Open Shifts:', JSON.stringify(shifts, null, 2));
  
  for (const shift of shifts) {
    const { data: sd } = await supabase.from('cash_shift_denoms').select('count').eq('shift_id', shift.id);
    console.log(`Shift ${shift.id} denoms count:`, sd?.[0]?.count ?? 0);
  }
}

checkShifts();
