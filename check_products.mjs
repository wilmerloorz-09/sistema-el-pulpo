import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Checking products table with service role...");
  const { data: products, error } = await supabase
    .from('products')
    .select('id, description, force_servir_module')
    .ilike('description', '%pescado%');
  
  if (error) {
    console.error("Error querying products:", error);
    return;
  }
  
  console.log("Products matching 'pescado':", products);
}
run();
