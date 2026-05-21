const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Leer variables de entorno desde .env manualmente
const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan variables de Supabase.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecentPayments() {
  console.log("Consultando últimos 10 pagos en Supabase...");
  const { data, error } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      change_amount,
      status,
      created_at,
      shift_id,
      order:orders (
        id,
        order_code,
        order_number,
        branch_id,
        status,
        created_at
      )
    `)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error consultando pagos:", error);
    return;
  }

  console.log("=== ÚLTIMOS 10 PAGOS EN SUPABASE ===");
  data.forEach((p, idx) => {
    console.log(`\n[Pago #${idx + 1}]`);
    console.log(`- ID: ${p.id}`);
    console.log(`- Monto: ${p.amount} (Cambio: ${p.change_amount})`);
    console.log(`- Status Pago: ${p.status}`);
    console.log(`- Creado en: ${p.created_at}`);
    console.log(`- Turno (shift_id): ${p.shift_id}`);
    if (p.order) {
      console.log(`- Orden ID: ${p.order.id}`);
      console.log(`- Orden Nro: ${p.order.order_number} / Código: ${p.order.order_code}`);
      console.log(`- Sucursal (branch_id): ${p.order.branch_id}`);
      console.log(`- Status Orden: ${p.order.status}`);
      console.log(`- Orden creada en: ${p.order.created_at}`);
    } else {
      console.log(`- SIN ORDEN ASOCIADA`);
    }
  });
}

checkRecentPayments();
