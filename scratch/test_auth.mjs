import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function test() {
  const email = 'admin1@elpulpo.com';
  const password = 'ElPulpo2026!'; // Test password
  
  console.log("=== Testing Direct Auth ===");
  const { data: directData, error: directError } = await s.auth.signInWithPassword({
    email,
    password
  });
  if (directError) {
    console.error("Direct Auth Failed:", directError.message, directError.status);
  } else {
    console.log("Direct Auth Success! User ID:", directData.user?.id);
  }

  console.log("\n=== Testing Edge Function ===");
  const { data: edgeData, error: edgeError } = await s.functions.invoke('login-with-identifier', {
    body: {
      identifier: 'admin1',
      password
    }
  });
  if (edgeError) {
    console.error("Edge Function Invoke Error:", edgeError);
  } else if (edgeData?.error) {
    console.error("Edge Function Login Failed:", edgeData.error);
  } else {
    console.log("Edge Function Success! Token received:", edgeData.access_token ? "YES" : "NO");
  }
}

test();
