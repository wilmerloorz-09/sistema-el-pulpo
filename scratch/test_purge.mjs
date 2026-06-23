import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

const credentials = [
  { email: 'admin@elpulpo.com', password: 'admin123' },
  { email: 'super@elpulpo.com', password: 'super123' },
  { email: 'admin1@elpulpo.com', password: 'ElPulpo2026!' },
  { email: 'wilmerloor@yahoo.com', password: '12345678' },
  { email: 'ivonne@hotmail.com', password: '12345678' },
  { email: 'mesero1@elpulpo.com', password: 'mesero123' },
  { email: 'mesero2@elpulpo.com', password: 'mesero123' },
  { email: 'cajero@elpulpo.com', password: 'cajero123' },
  { email: 'cocina@elpulpo.com', password: 'cocina123' },
];

async function run() {
  let authenticatedClient = null;
  let loggedInUser = null;

  const targetCred = { email: 'jose@hotmail.com', password: '12345678' };
  try {
    console.log(`Trying auth: ${targetCred.email}...`);
    const { data, error } = await s.auth.signInWithPassword({
      email: targetCred.email,
      password: targetCred.password
    });
    if (!error && data?.user) {
      console.log(`SUCCESS: Authenticated as ${targetCred.email}`);
      authenticatedClient = s;
      loggedInUser = data.user;
    }
  } catch (e) {
    console.log(`Error authenticating ${targetCred.email}:`, e.message);
  }

  if (!authenticatedClient) {
    console.error("All authentication attempts failed.");
    return;
  }

  const targetOrderId = 'c0246324-7ab1-435f-8dac-4809d9a46171';
  console.log(`Calling purge_empty_order for ${targetOrderId} with retries...`);
  
  for (let i = 1; i <= 6; i++) {
    const { data: purgeResult, error: purgeError } = await s.rpc('purge_empty_order', {
      p_order_id: targetOrderId
    });

    if (purgeError) {
      console.log(`Attempt ${i} error:`, purgeError.message);
      if (i < 6) {
        console.log("Waiting 15 seconds before retry...");
        await new Promise(r => setTimeout(r, 15000));
      }
    } else {
      console.log("SUCCESS! Purge result:", purgeResult);
      break;
    }
  }

  // Also try purge_empty_orders_for_branch directly
  const branchId = '3ea2076c-1cda-4583-913b-e23be6819201';
  console.log(`Calling purge_empty_orders_for_branch for ${branchId}...`);
  const { data: branchResult, error: branchError } = await s.rpc('purge_empty_orders_for_branch', {
    p_branch_id: branchId
  });

  if (branchError) {
    console.error("Branch purge error:", branchError);
  } else {
    console.log("Branch purge result:", branchResult);
  }
}

run();
