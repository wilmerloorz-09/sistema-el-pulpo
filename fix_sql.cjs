const fs = require('fs');
let sql = fs.readFileSync('approve_and_void.sql', 'utf8');

const target1 = "    JOIN public.cash_shift_denoms csd\n      ON csd.shift_id = p_current_shift_id\n     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid";
const rep1 = "    JOIN public.cash_shift_denoms csd\n      ON csd.shift_id = p_current_shift_id\n     AND csd.cashier_id = p_requested_by_user_id\n     AND csd.denomination_id = (selection ->> 'denomination_id')::uuid";

const target2 = "    WHERE csd.shift_id = p_current_shift_id\n      AND csd.denomination_id = v_cash_row.denomination_id;";
const rep2 = "    WHERE csd.shift_id = p_current_shift_id\n      AND csd.cashier_id = p_requested_by_user_id\n      AND csd.denomination_id = v_cash_row.denomination_id;";

sql = sql.split(target1).join(rep1);
sql = sql.split(target2).join(rep2);

if (sql.includes('cashier_id = p_requested_by_user_id')) {
    fs.writeFileSync('supabase/migrations/20260523000000_fix_approve_and_void_payment_cashier.sql', sql);
    console.log('Migration created');
} else {
    console.log('Failed to replace');
}
