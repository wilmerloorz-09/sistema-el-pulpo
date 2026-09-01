# Aplica migraciones de producción en lotes vía SQL Editor de Supabase.
# Uso: .\scripts\apply-prod-migrations.ps1 -Lote 1
#      .\scripts\apply-prod-migrations.ps1 -Lote all

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("1", "2", "3", "4", "5", "6", "7", "8", "all")]
  [string]$Lote
)

$ProjectRef = "apmsuigcveqtjzbpfihb"
$SqlEditorUrl = "https://supabase.com/dashboard/project/$ProjectRef/sql/new"

$map = @{
  "1" = "scripts/prod-sql/lote-01-menu-legacy.sql"
  "2" = "scripts/prod-sql/lote-02-catalogo-global.sql"
  "3" = "scripts/prod-sql/lote-03-paid-at-blindaje.sql"
  "4" = "scripts/prod-sql/lote-04-reemplazo-cajero.sql"
  "5" = "scripts/prod-sql/lote-05-supervisor-temporal.sql"
  "6" = "scripts/prod-sql/lote-06-cola-operativa-opcional.sql"
  "7" = "scripts/prod-sql/lote-07-replicar-menu-pulpo4-catalogo-global.sql"
  "8" = "scripts/prod-sql/lote-08-replicar-takeout-bulk-desde-p1manana.sql"
}

function Copy-Lote([string]$path) {
  if (-not (Test-Path $path)) {
    throw "No existe: $path"
  }
  Get-Content $path -Raw | Set-Clipboard
  Write-Host "Copiado al portapapeles: $path"
}

if ($Lote -eq "all") {
  Write-Host "Ejecuta lote por lote (1..8). No pegues todo junto."
  Write-Host "Orden: 1 -> 2 -> 3 -> 4 -> 5 -> (6 opcional) -> (7 menu Pulpo 4) -> (8 takeout/bulk P1M)"
  exit 0
}

$path = $map[$Lote]
Copy-Lote $path
Start-Process $SqlEditorUrl
Write-Host ""
Write-Host "1) En SQL Editor: Ctrl+V y Run"
Write-Host "2) Debe decir Success"
Write-Host "3) Luego: .\scripts\apply-prod-migrations.ps1 -Lote $([int]$Lote + 1)"
