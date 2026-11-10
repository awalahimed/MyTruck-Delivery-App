# Asks Chapa to create a 10 ETB test checkout link with your secret key.
# Nothing is charged. Prints only Chapa's answer (never the key). Delete this file after use.
$file = Join-Path $env:USERPROFILE "Downloads\Telegram Desktop\chapa.txt"
if (-not (Test-Path $file)) { Write-Output "chapa.txt not found at $file"; exit 1 }
$line = Get-Content $file | Where-Object { $_ -match 'CHAPA_SECRET_KEY=' } | Select-Object -First 1
if (-not $line) { Write-Output "No CHAPA_SECRET_KEY line in chapa.txt"; exit 1 }
$key = ($line -split '=', 2)[1].Trim()
Write-Output ("Key starts with: " + $key.Substring(0, [Math]::Min(8, $key.Length)) + "...  length " + $key.Length)

$body = @{
  amount       = "10"
  currency     = "ETB"
  email        = "customer0912345678@gmail.com"
  first_name   = "Test"
  last_name    = "User"
  phone_number = "0912345678"
  tx_ref       = "MTTEST" + (Get-Random)
  return_url   = "https://checkout.chapa.co/checkout/payment-receipt"
} | ConvertTo-Json

try {
  $res = Invoke-RestMethod -Method Post -Uri "https://api.chapa.co/v1/transaction/initialize" `
    -Headers @{ Authorization = "Bearer $key" } -ContentType "application/json" -Body $body
  Write-Output "CHAPA ANSWER:"
  $res | ConvertTo-Json -Depth 5
} catch {
  Write-Output "CHAPA ERROR:"
  if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
}
