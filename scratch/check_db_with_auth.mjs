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
  const email = 'admin1@elpulpo.com';
  const password = 'ElPulpo2026!'; // Test password
  
  console.log("Logging in...");
  const { data: authData, error: authError } = await s.auth.signInWithPassword({
    email,
    password
  });
  
  if (authError) {
    console.error("Auth error:", authError.message);
    return;
  }
  
  console.log("Logged in as user ID:", authData.user?.id);
  
  console.log("Fetching branches...");
  const { data: branches, error: err1 } = await s
    .from('branches')
    .select('*');
  
  if (err1) console.error("Error fetching branches:", err1);
  else {
    console.log("Branches:");
    branches.forEach(b => {
      console.log(`- ID: ${b.id}, Name: ${b.name}, Active: ${b.is_active}, Workflow: ${b.workflow_mode}`);
    });
  }

  console.log("Fetching profiles...");
  const { data: profiles, error: err2 } = await s
    .from('profiles')
    .select('*')
    .limit(10);
  
  if (err2) console.error("Error fetching profiles:", err2);
  else {
    console.log("Profiles:");
    profiles.forEach(p => {
      console.log(`- ID: ${p.id}, Username: ${p.username}, Email: ${p.email}`);
    });
  }
}

run();
