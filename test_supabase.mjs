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
  const { data: latestOrder } = await s.from('orders').select('id').order('created_at', { ascending: false }).limit(1);
  if (latestOrder && latestOrder.length > 0) {
    const { data: items } = await s.from('order_items').select('*').eq('order_id', latestOrder[0].id);
    console.log('Latest Order Items:', items);
  } else {
    console.log('No orders found');
  }
}
run();
