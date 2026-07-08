$confPath = "D:\Program Files\PostgreSQL\18\data\postgresql.conf"
$content = Get-Content $confPath -Raw
# Remove the custom GUC parameters block
$content = $content -replace "\r?\n# Supabase-compatible custom GUC parameters for Storage API\r?\nrequest\.jwt\.claim\.role = ''\r?\nrequest\.jwt\.claim\.sub = ''\r?\nrequest\.jwt\.claims = ''\r?\nrequest\.jwt = ''\r?\nrequest\.headers = ''\r?\nrequest\.method = ''\r?\nrequest\.path = ''\r?\nstorage\.operation = ''\r?\nstorage\.allow_delete_query = 'true'", ""
Set-Content -Path $confPath -Value $content -NoNewline
Write-Host "Removed custom GUC parameters from postgresql.conf"
