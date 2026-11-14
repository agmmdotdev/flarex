#requires -Version 7.2
[CmdletBinding()]
param([switch]$ParserOnly, [string]$BinDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$controller = Join-Path $PSScriptRoot 'core-aot-postgres.ps1'
if (-not $BinDirectory) { $BinDirectory = Join-Path $workspace 'work/tools/postgres/server-18.7/pgsql/bin' }
$BinDirectory = [IO.Path]::GetFullPath($BinDirectory)

# Load only the actual pure parser definition, without running cluster control.
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($controller, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Controller syntax is invalid.' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-PostgresDataArgument' }, $true)
if ($null -eq $definition) { throw 'Missing controller argument parser.' }
. ([ScriptBlock]::Create($definition.Extent.Text))
foreach ($case in @(
  @('"C:\Program Files\PostgreSQL\bin\postgres.exe" "-D" "C:\benchmark state\data"', 'C:\benchmark state\data'),
  @('C:\PostgreSQL\bin\postgres.exe -D C:\benchmark\data', 'C:\benchmark\data'),
  @('postgres.exe -D C:/benchmark/data', 'C:\benchmark\data')
)) {
  if ((Get-PostgresDataArgument $case[0]) -cne $case[1]) { throw 'Valid pg_ctl argument shape was not parsed exactly.' }
}
foreach ($commandLine in @('', 'postgres.exe', 'postgres.exe -D', 'postgres.exe -D relative',
  'postgres.exe -D "C:\one" -D "C:\two"', 'postgres.exe -DC:\one', 'postgres.exe --pgdata=C:\one',
  'postgres.exe -D "C:\one\"', 'postgres.exe -D "C:\one"mixed')) {
  $refused = $false
  try { $null = Get-PostgresDataArgument $commandLine } catch { $refused = $true }
  if (-not $refused) { throw 'Ambiguous or missing pg_ctl data argument was accepted.' }
}
Write-Output 'Quoted/unquoted -D parser and ambiguous-input refusals passed.'
if ($ParserOnly) { return }

$stateRoot = [IO.Path]::GetFullPath((Join-Path $workspace ('work/validation/core-aot-identity-regression-' + [Guid]::NewGuid().ToString('N'))))
$validationRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'work/validation')).TrimEnd('\', '/')
if (-not $stateRoot.StartsWith($validationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Regression state escaped the workspace validation directory.'
}
$stateA = Join-Path $stateRoot 'a'
$stateB = Join-Path $stateRoot 'b'
$pidAPath = Join-Path $stateA 'data/postmaster.pid'
$pidBPath = Join-Path $stateB 'data/postmaster.pid'
$mainState = Join-Path $workspace 'work/validation/core-aot-postgres'
$mainPidPath = Join-Path $mainState 'data/postmaster.pid'
$mainPidBefore = [IO.File]::ReadAllText($mainPidPath)
$oldRuntime = $env:FLAREX_POSTGRES_DATABASE_URL
$oldProvisioning = $env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL
$oldPassword = $env:PGPASSWORD
$forged = $null
$failures = [Collections.Generic.List[Exception]]::new()
try {
  & $controller -Action Status -BinDirectory $BinDirectory -StateDirectory $mainState -Port 55432
  & $controller -Action Start -BinDirectory $BinDirectory -StateDirectory $stateA -Port 55433
  & $controller -Action Start -BinDirectory $BinDirectory -StateDirectory $stateB -Port 55434
  $bPidBefore = [IO.File]::ReadAllText($pidBPath)
  & $controller -Action Stop -BinDirectory $BinDirectory -StateDirectory $stateA -Port 55433
  if (Test-Path -LiteralPath $pidAPath) { throw 'First regression cluster was not stopped.' }

  # A real stopped installation has a stale PID file whose PID now belongs to B.
  # Its file still claims A's data/port; only the live command line disproves it.
  $forged = [IO.File]::ReadAllLines($pidBPath)
  $forged[1] = Join-Path $stateA 'data'
  $forged[3] = '55433'
  [IO.File]::WriteAllLines($pidAPath, $forged, [Text.UTF8Encoding]::new($false))
  $stopLogsBefore = @(Get-ChildItem -LiteralPath $stateA -Filter 'stop-*.stdout.log').Count
  foreach ($action in @('Stop', 'Start')) {
    $refused = $false
    try { & $controller -Action $action -BinDirectory $BinDirectory -StateDirectory $stateA -Port 55433 }
    catch {
      if ($_.Exception.Message -notmatch '^Live postmaster command line data directory does not match the owned cluster\.$') { throw }
      $refused = $true
    }
    if (-not $refused) { throw "Stale PID $action was not refused by the live data-directory guard." }
  }
  if (@(Get-ChildItem -LiteralPath $stateA -Filter 'stop-*.stdout.log').Count -ne $stopLogsBefore) {
    throw 'A refused stale PID reached pg_ctl stop.'
  }
  & $controller -Action Status -BinDirectory $BinDirectory -StateDirectory $stateB -Port 55434
  if ([IO.File]::ReadAllText($pidBPath) -cne $bPidBefore) { throw 'Second regression server identity changed.' }
  $bEndpoints = Get-Content -LiteralPath (Join-Path $stateB 'endpoints.json') -Raw | ConvertFrom-Json
  $env:PGPASSWORD = ([Uri]$bEndpoints.connectionString).UserInfo.Split(':')[1]
  $probe = & (Join-Path $BinDirectory 'psql.exe') -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55434 -U flarex_aot_runtime -d flarex_core_aot -c "SELECT current_setting('port'), current_database()"
  if ($LASTEXITCODE -ne 0 -or $probe.Trim() -cne '55434|flarex_core_aot') { throw 'Second regression cluster stopped serving requests.' }
  if ([IO.File]::ReadAllText($mainPidPath) -cne $mainPidBefore) { throw 'Main benchmark cluster identity changed.' }
  & $controller -Action Status -BinDirectory $BinDirectory -StateDirectory $mainState -Port 55432
  Write-Output 'Stale same-binary PID refused before Stop and Start adoption; the other cluster still served a verified request; main cluster was untouched.'
} catch { $failures.Add($_.Exception) }
finally {
  if ($null -ne $forged -and (Test-Path -LiteralPath $pidAPath)) {
    try {
      if (([IO.File]::ReadAllLines($pidAPath) -join "`n") -cne ($forged -join "`n")) { throw 'Spoofed PID file was replaced; refusing deletion.' }
      $resolvedPid = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $pidAPath).ProviderPath)
      if (-not $resolvedPid.StartsWith($stateA + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'PID cleanup escaped owned regression state.' }
      Remove-Item -LiteralPath $resolvedPid
    } catch { $failures.Add($_.Exception) }
  }
  foreach ($cluster in @(@($stateB, 55434), @($stateA, 55433))) {
    if (Test-Path -LiteralPath (Join-Path $cluster[0] 'owner.json')) {
      try { & $controller -Action Stop -BinDirectory $BinDirectory -StateDirectory $cluster[0] -Port $cluster[1] }
      catch { $failures.Add($_.Exception) }
    }
  }
  $env:FLAREX_POSTGRES_DATABASE_URL = $oldRuntime
  $env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = $oldProvisioning
  $env:PGPASSWORD = $oldPassword
}
if ($failures.Count) { throw [AggregateException]::new("Controller identity regression failed; state retained at $stateRoot", $failures.ToArray()) }
if ((Test-Path -LiteralPath $pidAPath) -or (Test-Path -LiteralPath $pidBPath)) { throw 'Owned regression cluster cleanup is incomplete.' }
Write-Output "Both regression clusters stopped; state and logs retained at $stateRoot"
