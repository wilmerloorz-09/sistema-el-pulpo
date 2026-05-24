import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envStr = fs.readFileSync(".env", "utf8");
const env = envStr.split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=");
  if (k) acc[k.trim()] = v.join("=").trim().replace(/^"|"$/g, "");
  return acc;
}, {});

const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";
const supabase = createClient(env.VITE_SUPABASE_URL, serviceRoleKey);

async function run() {
  const { data, error } = await supabase
    .from('cash_shifts')
    .select('id, status, opened_at, primary_cashier_id')
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1);
    
  console.log('Shifts:', data);
  
  if (data && data.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from('cash_shift_users')
        .select('*')
        .eq('shift_id', data[0].id)
        .eq('user_id', '92c5917e-d9a4-4db3-8adc-6288717f8120');
        
      console.log('User shift data:', usersData);
  }
}

run();
