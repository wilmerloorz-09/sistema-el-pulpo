import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

import { createClient } from '@supabase/supabase-js';

async function run() {
  const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  console.log("Authenticating...");
  const { data: authData, error: authError } = await s.auth.signInWithPassword({
    email: 'jose@hotmail.com',
    password: '12345678'
  });

  if (authError) {
    console.error("Auth error:", authError);
    return;
  }

  const url = `${env.VITE_SUPABASE_URL}/rest/v1/`;
  console.log("Fetching OpenAPI spec from:", url);
  
  const headers = {
    'apikey': env.VITE_SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${authData.session.access_token}`
  };

  try {
    const res = await fetch(url, { headers });
    const spec = await res.json();
    
    console.log("\n=== EXPOSED PATHS ===");
    const paths = Object.keys(spec.paths || {});
    console.log(`Total paths: ${paths.length}`);
    console.log("First 30 paths:", paths.slice(0, 30));
  } catch (e) {
    console.error("Error fetching OpenAPI:", e);
  }
}

run();
