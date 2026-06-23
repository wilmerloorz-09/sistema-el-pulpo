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
  console.log("Logging in as wloor...");
  const { data: authData, error: authError } = await s.auth.signInWithPassword({
    email: 'wilmerloor@yahoo.com',
    password: '12345678'
  });

  if (authError) {
    console.error("Auth failed:", authError);
    return;
  }
  console.log("Logged in successfully. User ID:", authData.user?.id);

  console.log("\n=== Checking user roles/permissions ===");
  const { data: globalRoles, error: errGlobal } = await s.from('user_global_roles').select('*');
  if (errGlobal) console.error("Error fetching user_global_roles:", errGlobal);
  else console.log("user_global_roles:", globalRoles);

  const { data: branchRoles, error: errBranch } = await s.from('user_branch_roles').select('*');
  if (errBranch) console.error("Error fetching user_branch_roles:", errBranch);
  else console.log("user_branch_roles:", branchRoles);

  const { data: roles, error: errRoles } = await s.from('roles').select('*');
  if (errRoles) console.error("Error fetching roles:", errRoles);
  else console.log("roles:", roles);
}

run();
