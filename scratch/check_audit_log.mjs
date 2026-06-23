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
  console.log(`Querying audit_log for order_id or entity_id: ${orderId}...`);

  const { data: auditRows, error: errAudit } = await s
    .from('audit_log')
    .select('*')
    .or(`entity_id.eq.${orderId},after_data->>order_id.eq.${orderId},before_data->>order_id.eq.${orderId}`)
    .order('created_at', { ascending: true });

  if (errAudit) {
    console.error("Error querying audit_log:", errAudit);
  } else {
    console.log(`Found ${auditRows.length} audit logs:`);
    console.log(JSON.stringify(auditRows, null, 2));
  }

  console.log("\nQuerying all audit logs for the last 1 hour on 'orders' table to see other updates...");
  const { data: recentLogs, error: errRecent } = await s
    .from('audit_log')
    .select('*')
    .eq('entity', 'orders')
    .order('created_at', { ascending: false })
    .limit(30);

  if (errRecent) {
    console.error("Error querying recent audit_log:", errRecent);
  } else {
    console.log(`Recent orders audit logs:`);
    recentLogs.forEach(log => {
      console.log(`- Time: ${log.created_at}, Action: ${log.action}, EntityID: ${log.entity_id}`);
      console.log(`  Before:`, log.before_data);
      console.log(`  After:`, log.after_data);
    });
  }
}

run();
