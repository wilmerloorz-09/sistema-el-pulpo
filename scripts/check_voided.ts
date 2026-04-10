import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkVoidedPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('id, order_id, notes, status, branch_id')
    .ilike('notes', '%VOIDED:%')
    .limit(10);
  
  if (error) {
    console.error('Error fetching payments:', error);
    return;
  }
  
  console.log('Voided payments found:', data?.length);
  data?.forEach(p => {
    console.log(`Payment ID: ${p.id}, Order ID: ${p.order_id}, Notes: ${p.notes}, Status: ${p.status}`);
  });
}

checkVoidedPayments();
