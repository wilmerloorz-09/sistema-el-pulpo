
$path = 'c:\sistema-el-pulpo\src\pages\Caja.tsx'
$content = Get-Content $path
$newContent = $content -replace 'useCaja\(completedFilters\)', 'useCaja({ completedPaymentsFilters: completedFilters, autoOpenOrderId })'
$newContent | Set-Content $path
