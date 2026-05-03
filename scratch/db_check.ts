
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://apmsuigcveqtjzbpfihb.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ'
const supabase = createClient(supabaseUrl, supabaseKey)

async function analyzeShift() {
  // 1. Find the current open shift
  const { data: shifts, error: shiftError } = await supabase
    .from('cash_shifts')
    .select('id, opened_at, branch_id')
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1)

  if (shiftError || !shifts || shifts.length === 0) {
    console.error('No open shift found', shiftError)
    return
  }

  const shift = shifts[0]
  console.log(`Analyzing Shift ID: ${shift.id}, Opened At: ${shift.opened_at}`)

  // 2. Get total cash collected for this shift (from payments table)
  const { data: payments, error: paymentError } = await supabase
    .from('payments')
    .select('id, amount, payment_method_id, notes, status')
    .eq('shift_id', shift.id)
    .eq('status', 'active')

  if (paymentError) {
    console.error('Error fetching payments', paymentError)
    return
  }

  // 3. Get payment methods to identify "Cash"
  const { data: methods } = await supabase.from('payment_methods').select('id, name')
  const cashMethodIds = methods?.filter(m => m.name.toLowerCase().includes('efectivo')).map(m => m.id) || []

  const cashPayments = payments.filter(p => cashMethodIds.includes(p.payment_method_id))
  const totalCashSales = cashPayments.reduce((sum, p) => sum + Number(p.amount), 0)
  
  console.log(`Total Cash Sales (active): $${totalCashSales.toFixed(2)} (${cashPayments.length} payments)`)

  // 4. Get cash movements for this shift
  const { data: movements, error: movementError } = await supabase
    .from('cash_movements')
    .select('id, movement_type, qty_delta, denomination_id, payment_id')
    .eq('shift_id', shift.id)

  if (movementError) {
    console.error('Error fetching movements', movementError)
    return
  }

  // 5. Get denominations to calculate totals
  const { data: denoms } = await supabase.from('denominations').select('id, value')
  const denomMap = Object.fromEntries(denoms?.map(d => [d.id, d.value]) || [])

  const netDenomDelta = movements.reduce((sum, m) => {
    const val = denomMap[m.denomination_id] || 0
    if (m.movement_type === 'PAYMENT_IN' || m.movement_type === 'OPENING') {
        return sum + (val * m.qty_delta)
    }
    if (m.movement_type === 'CHANGE_OUT' || m.movement_type === 'SALIDA') {
        return sum - (val * m.qty_delta)
    }
    return sum
  }, 0)

  // Wait, Diferencia in UI is (Current - Initial).
  // Movements of type OPENING should not be counted for "Diferencia" if Diferencia is (Current - Initial).
  // Actually, qty_current = qty_initial + deltas.
  // So totalCurrent - totalInitial = sum of all deltas since opening.
  
  const paymentInTotal = movements
    .filter(m => m.movement_type === 'PAYMENT_IN')
    .reduce((sum, m) => sum + (denomMap[m.denomination_id] || 0) * m.qty_delta, 0)
    
  const changeOutTotal = movements
    .filter(m => m.movement_type === 'CHANGE_OUT')
    .reduce((sum, m) => sum + (denomMap[m.denomination_id] || 0) * m.qty_delta, 0)

  const netPhysicalCashFromPayments = paymentInTotal - changeOutTotal

  console.log(`Net Physical Cash from Payments: $${netPhysicalCashFromPayments.toFixed(2)}`)
  console.log(`  (Payment In: $${paymentInTotal.toFixed(2)})`)
  console.log(`  (Change Out: $${changeOutTotal.toFixed(2)})`)

  const discrepancy = totalCashSales - netPhysicalCashFromPayments
  console.log(`Discrepancy (Sales - Physical): $${discrepancy.toFixed(2)}`)

  // Find payments with NO movements
  const paymentIdsWithMovements = new Set(movements.filter(m => m.payment_id).map(m => m.payment_id))
  const orphanedPayments = cashPayments.filter(p => !paymentIdsWithMovements.has(p.id))

  if (orphanedPayments.length > 0) {
    console.log(`Found ${orphanedPayments.length} cash payments without denominations:`)
    orphanedPayments.forEach(p => console.log(`  - Payment ID: ${p.id}, Amount: $${p.amount}, Notes: ${p.notes}`))
  } else {
    console.log('No orphaned cash payments found.')
  }
}

analyzeShift()
