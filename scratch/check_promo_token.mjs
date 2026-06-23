import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envStr = fs.readFileSync('.env', 'utf8');
const env = envStr.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if(k) acc[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
await s.auth.signInWithPassword({ email: 'ivonne@hotmail.com', password: '12345678' });

const casos = [
  { label: 'ROTA  - SUC001260623-0008', orderId: '64fdd729-d9c5-4560-a58a-492d9ed33af7' },
  { label: 'BUENA - SUC004260623-0002', orderId: '8e8237fe-0cd1-418d-a6a1-7439a5404d87' },
  { label: 'BUENA - SUC004260623-0003', orderId: '6bb18d5c-21db-4d2f-84d8-5549eba81092' },
];

for (const caso of casos) {
  console.log(`\n=== ${caso.label} ===`);

  // Timestamps clave de la orden
  const { data: ord } = await s
    .from('orders')
    .select('order_type, status, total, sent_to_kitchen_at, paid_at, ready_at, dispatched_at, created_at')
    .eq('id', caso.orderId)
    .single();

  if (ord) {
    console.log(`tipo=${ord.order_type} | status=${ord.status} | total=$${ord.total}`);
    console.log(`  created:    ${ord.created_at}`);
    console.log(`  sent:       ${ord.sent_to_kitchen_at}`);
    console.log(`  paid_at:    ${ord.paid_at}  ← pago registrado`);
    console.log(`  ready_at:   ${ord.ready_at}`);
    console.log(`  dispatched: ${ord.dispatched_at}  ← despacho`);

    // Calcular si pagaron ANTES o DESPUÉS de despachar
    if (ord.paid_at && ord.dispatched_at) {
      const paidMs  = new Date(ord.paid_at).getTime();
      const dispMs  = new Date(ord.dispatched_at).getTime();
      const diffSeg = Math.round((dispMs - paidMs) / 1000);
      if (diffSeg > 0) {
        console.log(`  ✅ PAGÓ PRIMERO, luego despacharon (${diffSeg}s después)`);
      } else {
        console.log(`  ⚠️  DESPACHARON PRIMERO, luego pagaron (${Math.abs(diffSeg)}s después)`);
      }
    } else if (!ord.dispatched_at) {
      console.log(`  ❓ Sin dispatched_at`);
    }
  }

  // Ver branch workflow
  const { data: branch } = await s
    .from('branches')
    .select('name, workflow_mode')
    .eq('id', (await s.from('orders').select('branch_id').eq('id', caso.orderId).single()).data?.branch_id)
    .single();
  console.log(`  sucursal: ${branch?.name} | workflow: ${branch?.workflow_mode}`);
}
