param(
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

if (-not $SupabaseUrl) {
  throw 'Falta SUPABASE_URL. Puedes pasarla como parametro o definirla en el entorno.'
}

if (-not $ServiceRoleKey) {
  throw 'Falta SUPABASE_SERVICE_ROLE_KEY. Puedes pasarla como parametro o definirla en el entorno.'
}

$env:SUPABASE_URL = $SupabaseUrl
$env:SUPABASE_SERVICE_ROLE_KEY = $ServiceRoleKey

node .\scripts\empty-payment-proofs-bucket.mjs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
