import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

// Use the service role key to access auth schema
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Checking profiles table...");
  const { data: profiles, error: pError } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (pError) {
    console.error("Error fetching profiles:", pError.message);
  } else {
    console.log(`Found ${profiles.length} profiles:`);
    profiles.forEach(p => {
      console.log(`- Profile Name: ${p.name || p.full_name || p.username || 'No name'}, ID: ${p.id}, Email: ${p.email || 'N/A'}, Created At: ${p.created_at}`);
    });
  }

  console.log("\nChecking auth.users...");
  const { data: { users }, error: uError } = await supabase.auth.admin.listUsers();
  if (uError) {
    console.error("Error listing auth users:", uError.message);
  } else {
    console.log(`Found ${users.length} auth users:`);
    users.forEach(u => {
      console.log(`- User: ${u.email}, ID: ${u.id}, Created At: ${u.created_at}, User Metadata:`, JSON.stringify(u.user_metadata));
    });
  }
}

run();
