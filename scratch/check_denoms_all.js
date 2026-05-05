
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDenoms() {
  const { data: denoms, error } = await supabase.from('denominations').select('*');
  console.log('Total Denoms in DB:', denoms?.length);
  if (denoms && denoms.length > 0) {
    console.log('First 2 Denoms:', JSON.stringify(denoms.slice(0, 2), null, 2));
  }
}

checkDenoms();
