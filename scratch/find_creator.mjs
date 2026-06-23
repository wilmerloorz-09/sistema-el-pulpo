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
  for (const cred of credentials) {
    try {
      const { data, error } = await s.auth.signInWithPassword({
        email: cred.email,
        password: cred.password
      });
      if (!error && data?.user) {
        console.log(`SUCCESS: Authenticated as ${cred.email}`);
        
        // Find profile for '92c5917e-d9a4-4db3-8adc-6288717f8120'
        const { data: profile, error: pError } = await s
          .from('profiles')
          .select('*')
          .eq('id', '92c5917e-d9a4-4db3-8adc-6288717f8120')
          .single();

        if (!pError && profile) {
          console.log("Creator profile found:", profile);
        } else {
          console.log("Creator profile not found or error:", pError);
        }

        // Print current user profile
        const { data: myProfile } = await s
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();
        console.log("My profile:", myProfile);
        
        break;
      }
    } catch (e) {
      // ignore
    }
  }
}

run();
