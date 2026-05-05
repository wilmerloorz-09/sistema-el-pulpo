
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://apmsuigcveqtjzbpfihb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM2ODEsImV4cCI6MjA4ODIyOTY4MX0.feEzXT_pJrlPdoXssK1kHRX9sJCzTrZ6Qg-6TRku_dc";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDenoms() {
  const { data: denoms, error } = await supabase.from('denominations').select('*');
  if (error) {
    console.error('Error fetching denoms:', error);
  } else {
    console.log('Denominations:', JSON.stringify(denoms, null, 2));
  }

  const { data: shifts, error: shiftError } = await supabase.from('cash_shifts').select('*').eq('status', 'OPEN');
  if (shiftError) {
    console.error('Error fetching shifts:', shiftError);
  } else {
    console.log('Open Shifts:', JSON.stringify(shifts, null, 2));
    if (shifts && shifts.length > 0) {
      const shiftId = shifts[0].id;
      const { data: shiftDenoms, error: sdError } = await supabase.from('cash_shift_denoms').select('*').eq('shift_id', shiftId);
      if (sdError) {
        console.error('Error fetching shift denoms:', sdError);
      } else {
        console.log('Shift Denominations:', JSON.stringify(shiftDenoms, null, 2));
      }
    }
  }
}

checkDenoms();
