$headers = @{
  apikey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ'
  Authorization = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ'
}
$base = 'https://apmsuigcveqtjzbpfihb.supabase.co/rest/v1'
$out = @()
$wendy = Invoke-RestMethod -Uri "$base/profiles?select=id,full_name,username&or=(username.ilike.*Wendy*,full_name.ilike.*Wendy*)&limit=10" -Headers $headers
if (-not $wendy) { $wendy = Invoke-RestMethod -Uri "$base/profiles?select=id,full_name,username&id=eq.92c5917e-d9a4-4db3-8adc-6288717f8120" -Headers $headers }
$out += "WENDY: $($wendy | ConvertTo-Json -Compress)"
$wendyId = $wendy[0].id
$shifts = Invoke-RestMethod -Uri "$base/cash_shifts?status=eq.OPEN&select=id,branch_id,opened_at,primary_cashier_id,secondary_caja_template_id,branches(name)&order=opened_at.desc" -Headers $headers
$wendyShifts = @($shifts | Where-Object { $_.primary_cashier_id -eq $wendyId })
$out += "SHIFTS: $($wendyShifts | ConvertTo-Json -Compress)"
foreach ($shift in $wendyShifts) {
  $csu = Invoke-RestMethod -Uri "$base/cash_shift_users?shift_id=eq.$($shift.id)&user_id=eq.$wendyId&select=secondary_caja_template_id,can_use_caja" -Headers $headers
  $out += "CSU: $($csu | ConvertTo-Json -Compress)"
  $tplId = $csu[0].secondary_caja_template_id
  if ($tplId) {
    $tpl = Invoke-RestMethod -Uri "$base/cash_register_templates?select=id,name&id=eq.$tplId" -Headers $headers
    $out += "TEMPLATE_BD: $($tpl | ConvertTo-Json -Compress)"
  }
  $denoms = Invoke-RestMethod -Uri "$base/cash_shift_denoms?shift_id=eq.$($shift.id)&cashier_id=eq.$wendyId&select=denomination_id,qty_initial,qty_current" -Headers $headers
  $templates = Invoke-RestMethod -Uri "$base/cash_register_templates?branch_id=eq.$($shift.branch_id)&is_active=eq.true&select=id,name,cash_register_template_denoms(denomination_id,qty)" -Headers $headers
  $sig = ($denoms | Sort-Object denomination_id | ForEach-Object { "$($_.denomination_id):$($_.qty_initial)" }) -join ','
  foreach ($t in $templates) {
    $tsig = ($t.cash_register_template_denoms | Sort-Object denomination_id | ForEach-Object { "$($_.denomination_id):$($_.qty)" }) -join ','
    if ($tsig -eq $sig) { $out += "MATCH: $($t.name) ($($t.id))" }
  }
}
$out | Set-Content -Path 'C:\sistema-el-pulpo\scripts\wendy-template-result.txt' -Encoding UTF8
