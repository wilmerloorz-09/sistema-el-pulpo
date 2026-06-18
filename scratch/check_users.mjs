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
  console.log("Checking latest profiles:");
  const { data: profiles, error: err1 } = await s
    .from('profiles')
    .select('id, email, username, full_name, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (err1) console.error("Error fetching profiles:", err1);
  else console.log(profiles);

  console.log("\nChecking latest clientes:");
  const { data: clientes, error: err2 } = await s
    .from('clientes')
    .select('id, cedula, nombres, apellidos, correo, creado_el')
    .order('creado_el', { ascending: false })
    .limit(10);

  if (err2) console.error("Error fetching clientes:", err2);
  else console.log(clientes);
}

run();
