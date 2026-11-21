param(
  [Parameter(Mandatory)] [string] $SdkBin,
  [switch] $Release
)
$ErrorActionPreference = 'Stop'
$watchRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$device = 'fr165m'
$compiler = Join-Path $SdkBin 'monkeybrains.jar'
$signingKey = Join-Path $watchRoot 'developer_key.der'
$jungle = Join-Path $watchRoot 'monkey.jungle'
$output = Join-Path $watchRoot 'bin'
New-Item -Path $output -ItemType Directory -Force | Out-Null

$tests = Join-Path $output 'grind-tests.prg'
& java -jar $compiler -o $tests -f $jungle -y $signingKey -d $device -w -t
if ($LASTEXITCODE -ne 0) { throw "Garmin test compilation failed ($LASTEXITCODE)." }
if (-not (Get-Process simulator -ErrorAction SilentlyContinue)) {
  Start-Process (Join-Path $SdkBin 'simulator.exe') -WindowStyle Hidden
  Start-Sleep -Seconds 5
}
$testResult = & (Join-Path $SdkBin 'monkeydo.bat') $tests $device /t
$testResult | Write-Output
if ($LASTEXITCODE -ne 0 -or -not ($testResult -match 'PASSED \(passed=\d+, failed=0, errors=0\)')) {
  throw 'Garmin simulator did not report a passing test run.'
}
if ($Release) {
  $artifact = Join-Path $output 'grind-release.prg'
  & java -jar $compiler -o $artifact -f $jungle -y $signingKey -d $device -w -r
  if ($LASTEXITCODE -ne 0) { throw "Garmin release compilation failed ($LASTEXITCODE)." }
  Get-FileHash -LiteralPath $artifact -Algorithm SHA256
}
