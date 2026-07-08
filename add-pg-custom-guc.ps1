$confPath = "D:\Program Files\PostgreSQL\18\data\postgresql.conf"
$customParams = @"

# Supabase-compatible custom GUC parameters for Storage API
request.jwt.claim.role = ''
request.jwt.claim.sub = ''
request.jwt.claims = ''
request.jwt = ''
request.headers = ''
request.method = ''
request.path = ''
storage.operation = ''
storage.allow_delete_query = 'true'
"@
Add-Content -Path $confPath -Value $customParams
Write-Host "Added custom GUC parameters to postgresql.conf"
