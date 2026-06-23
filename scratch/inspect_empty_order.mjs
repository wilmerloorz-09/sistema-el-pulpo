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
  const { error: authError } = await s.auth.signInWithPassword({
    email: 'ivonne@hotmail.com',
    password: '12345678'
  });
  if (authError) {
    console.error("Auth failed:", authError.message);
    return;
  }

  const orderId = '6c45c53b-fa0a-45f1-822b-74bd1a99525c';

  console.log(`=== Inspecting Order ${orderId} ===`);
  const { data: order, error: errOrder } = await s
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (errOrder) {
    console.error("Error fetching order:", errOrder);
    return;
  }
  console.log("Order row:", JSON.stringify(order, null, 2));

  console.log("\n=== Checking ALL order_items (including CANCELLED ones) ===");
  const { data: items, error: errItems } = await s
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (errItems) {
    console.error("Error fetching items:", errItems);
  } else {
    console.log("Order items found:", JSON.stringify(items, null, 2));
  }

  console.log("\n=== Checking order_cancellations ===");
  const { data: cancellations, error: errCancel } = await s
    .from('order_cancellations')
    .select('*')
    .eq('order_id', orderId);

  if (errCancel) {
    console.error("Error fetching cancellations:", errCancel);
  } else {
    console.log("Cancellations:", JSON.stringify(cancellations, null, 2));
  }

  console.log("\n=== Checking order_dispatch_events ===");
  const { data: dispatchEvents, error: errDispatch } = await s
    .from('order_dispatch_events')
    .select('*')
    .eq('order_id', orderId);

  if (errDispatch) {
    console.error("Error fetching dispatch events:", errDispatch);
  } else {
    console.log("Dispatch events:", JSON.stringify(dispatchEvents, null, 2));
  }
}

run();
