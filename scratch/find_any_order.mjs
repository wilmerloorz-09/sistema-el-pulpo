import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  const { data: allEight, error } = await s
    .from('orders')
    .select('id, status, paid_at, created_at, token_promocion, order_code, order_number, total')
    .eq('order_number', 8);

  console.log("=== Orders with number 8 ===");
  console.log("Data:", allEight);
  console.log("Error:", error);

  // Search by partial code
  const { data: partialCode, error: pErr } = await s
    .from('orders')
    .select('id, status, paid_at, created_at, token_promocion, order_code, order_number, total')
    .like('order_code', '%0008');

  console.log("\n=== Orders ending in 0008 ===");
  console.log("Data:", partialCode);
  console.log("Error:", pErr);
}

run();
