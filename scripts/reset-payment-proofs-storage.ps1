param(
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

if ((-not $SupabaseUrl -or -not $ServiceRoleKey) -and (Test-Path '.\.env')) {
  Get-Content '.\.env' | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }

    $parts = $_.Split('=', 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"')

    if ($name -eq 'SUPABASE_URL' -and -not $SupabaseUrl) {
      $SupabaseUrl = $value
    }

    if ($name -eq 'SUPABASE_SERVICE_ROLE_KEY' -and -not $ServiceRoleKey) {
      $ServiceRoleKey = $value
    }
  }
}

if (-not $SupabaseUrl) {
  throw 'Falta SUPABASE_URL. Puedes pasarla como parametro, definirla en el entorno o guardarla en .env.'
}

if (-not $ServiceRoleKey) {
  throw 'Falta SUPABASE_SERVICE_ROLE_KEY. Puedes pasarla como parametro, definirla en el entorno o guardarla en .env.'
}

$env:SUPABASE_URL = $SupabaseUrl
$env:SUPABASE_SERVICE_ROLE_KEY = $ServiceRoleKey

node .\scripts\empty-payment-proofs-bucket.mjs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
