
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://apmsuigcveqtjzbpfihb.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkIndividualDenomsDiscrepancy() {
  const shiftId = '25860d75-eaf8-46e8-a4ab-f484d4f331bb'
  const { data: shiftDenoms } = await supabase.from('cash_shift_denoms').select('*').eq('shift_id', shiftId)
  const { data: movements } = await supabase.from('cash_movements').select('*').eq('shift_id', shiftId)
  const { data: denoms } = await supabase.from('denominations').select('id, value, label')
  const denomMap = Object.fromEntries((denoms || []).map(d => [d.id, { value: Number(d.value), label: d.label }]))

  const movementDeltas = {}
  movements.forEach(m => {
      const delta = (m.movement_type === 'PAYMENT_IN' || m.movement_type === 'OPENING') ? m.qty_delta : -m.qty_delta
      movementDeltas[m.denomination_id] = (movementDeltas[m.denomination_id] || 0) + delta
  })

  console.log(`Denomination Discrepancies (Current vs Initial + Delta):`)
  shiftDenoms.forEach(sd => {
      const d = denomMap[sd.denomination_id]
      if (d) {
          const delta = movementDeltas[sd.denomination_id] || 0
          const expected = sd.qty_initial + delta
          if (sd.qty_current !== expected) {
              console.log(`  - ${d.label} ($${d.value}): Current=${sd.qty_current}, Expected=${expected} (Diff=${sd.qty_current - expected})`)
          }
      }
  })
}

checkIndividualDenomsDiscrepancy()
