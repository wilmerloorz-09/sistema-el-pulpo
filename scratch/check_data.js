
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  const { data: products } = await supabase.from('products').select('count');
  console.log('Products count:', products?.[0]?.count ?? 0);
  
  const { data: orders } = await supabase.from('orders').select('count');
  console.log('Orders count:', orders?.[0]?.count ?? 0);
}

checkData();
