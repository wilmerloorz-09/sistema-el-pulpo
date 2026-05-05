
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkDenoms() {
  const { data: denoms, error } = await supabase.from('denominations').select('*');
  if (error) {
    console.error('Error fetching denoms:', error);
  } else {
    console.log('Total Denoms (Service Role):', denoms?.length);
    if (denoms && denoms.length > 0) {
      console.log('First 2 Denoms:', JSON.stringify(denoms.slice(0, 2), null, 2));
    }
  }

  const { data: shifts } = await supabase.from('cash_shifts').select('*').eq('status', 'OPEN');
  console.log('Open Shifts count:', shifts?.length);
  if (shifts && shifts.length > 0) {
     const { data: sd } = await supabase.from('cash_shift_denoms').select('*, denominations(label, denomination_type)').eq('shift_id', shifts[0].id);
     console.log('Shift Denoms for first open shift:', JSON.stringify(sd, null, 2));
  }
}

checkDenoms();
