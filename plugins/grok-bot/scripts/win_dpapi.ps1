Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd().Trim()
if (-not $b64) { throw "empty stdin" }
$b = [Convert]::FromBase64String($b64)
$p = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $b,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Convert]::ToBase64String($p)
