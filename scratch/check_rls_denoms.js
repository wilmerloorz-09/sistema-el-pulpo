
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkRLS() {
  const { data, error } = await supabase.rpc('get_policies_for_table', { p_table: 'denominations' });
  // Since I don't know if get_policies_for_table exists, I'll use a standard SQL query via RPC if possible,
  // or I'll just check if I can see them with the ANON key.
  
  console.log('Trying with ANON key...');
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";
  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const { data: denomsAnon, error: errorAnon } = await supabaseAnon.from('denominations').select('*');
  console.log('Denoms visible to ANON:', denomsAnon?.length);
  if (errorAnon) console.log('Error with ANON:', errorAnon.message);
}

checkRLS();
