
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConnection() {
  const { data: branches, error } = await supabase.from('branches').select('*');
  if (error) {
    console.error('Error fetching branches:', error);
  } else {
    console.log('Branches count:', branches?.length);
    console.log('First branch:', JSON.stringify(branches?.[0], null, 2));
  }
}

checkConnection();
