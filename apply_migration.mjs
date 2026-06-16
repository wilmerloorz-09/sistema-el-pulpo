import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://apmsuigcveqtjzbpfihb.supabase.co';
// Use service_role key from supabase secrets if available, else use anon key
// We need a key with enough permissions to run DDL - check supabase/secrets
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc';

const sql = readFileSync(join(__dirname, 'supabase/migrations/20260616140000_prevent_auto_cancel_on_empty_edit.sql'), 'utf8');

console.log('SQL to run:\n', sql.substring(0, 200), '...\n');
console.log('This script requires service_role key to run DDL. Please apply the migration via Supabase Dashboard SQL Editor.');
console.log('\nSQL file: supabase/migrations/20260616140000_prevent_auto_cancel_on_empty_edit.sql');
