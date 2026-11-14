#requires -Version 7.2
[CmdletBinding()]
param(
  [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
  [string]$BinDirectory,
  [string]$StateDirectory,
  [ValidateRange(1024, 65535)][int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\', '/')
if (-not $BinDirectory) { $BinDirectory = Join-Path $workspace 'work/tools/postgres/server-18.7/pgsql/bin' }
if (-not $StateDirectory) { $StateDirectory = Join-Path $workspace 'work/validation/core-aot-postgres' }
$binaryPath = [IO.Path]::GetFullPath($BinDirectory).TrimEnd('\', '/')
$statePath = [IO.Path]::GetFullPath($StateDirectory).TrimEnd('\', '/')
$validationPath = [IO.Path]::GetFullPath((Join-Path $workspace 'work/validation')).TrimEnd('\', '/')
if (-not $IsWindows) { throw 'This script controls an isolated Windows PostgreSQL cluster.' }
if (-not $statePath.StartsWith($validationPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'StateDirectory must be a child of this workspace work/validation directory.'
}
# A lexical workspace prefix must not traverse an existing junction or symlink.
for ($ancestor = $statePath; $ancestor.Length -gt $workspace.Length; $ancestor = Split-Path -Parent $ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "StateDirectory crosses a reparse point: $ancestor"
    }
  }
}
$dataPath = Join-Path $statePath 'data'
$ownerPath = Join-Path $statePath 'owner.json'
$endpointPath = Join-Path $statePath 'endpoints.json'
foreach ($ownedPath in @($dataPath, $ownerPath, $endpointPath)) {
  if ((Test-Path -LiteralPath $ownedPath) -and
    ((Get-Item -LiteralPath $ownedPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Owned cluster path is a reparse point: $ownedPath"
  }
}
$postgres = Join-Path $binaryPath 'postgres.exe'
$pgCtl = Join-Path $binaryPath 'pg_ctl.exe'
$initdb = Join-Path $binaryPath 'initdb.exe'
$psql = Join-Path $binaryPath 'psql.exe'
$nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$toolHelper = Join-Path $PSScriptRoot 'core-aot-postgres-tool.mjs'
foreach ($file in @($postgres, $pgCtl, $initdb, $psql)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing PostgreSQL executable: $file" }
}

function Write-PrivateJson([string]$Path, $Value) {
  $temporary = $Path + '.pending'
  [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  [IO.File]::Move($temporary, $Path, $true)
}

function Invoke-PgTool([string]$Executable, [string[]]$ToolArguments, [string]$Label, [int[]]$AllowedExitCodes = @(0)) {
  # Node supplies argv directly and redirects pg_ctl to real files. No password
  # is passed in argv, and a server descendant cannot hold a capture pipe open.
  $prefix = Join-Path $statePath ($Label + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffff'))
  $raw = & $nodeExecutable $toolHelper $Executable $prefix '120000' @ToolArguments
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL controller failed ($Label); inspect logs under $statePath" }
  $control = $raw | ConvertFrom-Json
  if ($control.timedOut) { throw "PostgreSQL tool timed out ($Label); inspect logs under $statePath" }
  if ($null -ne $control.errorCode -or $null -eq $control.exitCode -or $AllowedExitCodes -notcontains $control.exitCode) {
    throw "PostgreSQL tool failed ($Label, exit $($control.exitCode), signal $($control.signal)); inspect logs under $statePath"
  }
  return [pscustomobject]@{ ExitCode = $control.exitCode; Output = $control.output }
}

function Assert-Owner($Owner) {
  foreach ($pair in @(
    @('owner', 'flarex-core-aot-benchmark'), @('workspace', $workspace),
    @('stateDirectory', $statePath), @('dataDirectory', $dataPath), @('binDirectory', $binaryPath),
    @('database', 'flarex_core_aot'), @('adminRole', 'flarex_aot_admin'), @('runtimeRole', 'flarex_aot_runtime')
  )) {
    if ($Owner.($pair[0]) -cne $pair[1]) { throw "Owned cluster metadata mismatch: $($pair[0])" }
  }
  if ($Owner.port -ne $Port) { throw 'Owned cluster port differs from -Port.' }
}

function Get-PostgresDataArgument([string]$CommandLine) {
  # Accept pg_ctl's separate quoted/unquoted argv. Escaped or mixed quoting is
  # ambiguous here and must not authorize adoption or stopping another process.
  if ([string]::IsNullOrWhiteSpace($CommandLine) -or $CommandLine.Contains("`r") -or $CommandLine.Contains("`n")) {
    throw 'Live postmaster command line is unavailable or ambiguous.'
  }
  $tokens = [Collections.Generic.List[string]]::new()
  $remaining = $CommandLine.Trim()
  while ($remaining.Length -gt 0) {
    $match = [regex]::Match($remaining, '^(?:"([^\"]*)"|([^\s\"]+))(?=\s|$)')
    if (-not $match.Success) { throw 'Live postmaster command line has ambiguous argument quoting.' }
    $token = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    if ($match.Groups[1].Success -and $token.EndsWith('\')) {
      throw 'Live postmaster command line has ambiguous escaped quoting.'
    }
    $tokens.Add($token)
    $remaining = $remaining.Substring($match.Length).TrimStart()
  }
  $dataArguments = [Collections.Generic.List[string]]::new()
  for ($index = 1; $index -lt $tokens.Count; $index++) {
    if ($tokens[$index] -ceq '-D') {
      if ($index + 1 -ge $tokens.Count) { throw 'Live postmaster has no -D argument value.' }
      $dataArguments.Add($tokens[$index + 1])
    } elseif ($tokens[$index].StartsWith('-D', [StringComparison]::Ordinal) -or
      $tokens[$index].StartsWith('--pgdata', [StringComparison]::Ordinal)) {
      throw 'Live postmaster has an ambiguous data-directory argument.'
    }
  }
  if ($dataArguments.Count -ne 1 -or -not [IO.Path]::IsPathFullyQualified($dataArguments[0])) {
    throw 'Live postmaster must have exactly one absolute -D argument.'
  }
  return [IO.Path]::GetFullPath($dataArguments[0]).TrimEnd('\', '/')
}

function Assert-OwnedPostmaster {
  $pidPath = Join-Path $dataPath 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { throw 'Owned cluster has no postmaster.pid.' }
  $lines = [IO.File]::ReadAllLines($pidPath)
  if ($lines.Length -lt 4 -or [IO.Path]::GetFullPath($lines[1]).TrimEnd('\', '/') -ine $dataPath -or [int]$lines[3] -ne $Port) {
    throw 'Postmaster data directory or port does not match this owned cluster.'
  }
  $server = Get-Process -Id ([int]$lines[0]) -ErrorAction Stop
  try {
    # Keep the OS process handle open through the caller's stop/adoption action.
    # The process object then cannot disappear and have its PID reused meanwhile.
    $null = $server.Handle
    if ([IO.Path]::GetFullPath($server.Path) -ine $postgres) { throw 'Postmaster process does not use the owned PostgreSQL binary.' }
    $live = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$lines[0])" -ErrorAction Stop
    if ($null -eq $live -or $null -eq $live.CreationDate -or [string]::IsNullOrWhiteSpace($live.ExecutablePath) -or
      [IO.Path]::GetFullPath($live.ExecutablePath) -ine $postgres) {
      throw 'Live postmaster OS identity is unavailable or mismatched.'
    }
    if ((Get-PostgresDataArgument $live.CommandLine) -ine $dataPath) {
      throw 'Live postmaster command line data directory does not match the owned cluster.'
    }
    $created = [DateTimeOffset]::new($server.StartTime.ToUniversalTime()).ToUnixTimeSeconds()
    $cimCreated = [DateTimeOffset]::new(([DateTime]$live.CreationDate).ToUniversalTime()).ToUnixTimeSeconds()
    $recorded = [long]$lines[2]
    # postmaster.pid records integral Unix seconds after OS process creation.
    # A bounded startup delay is permitted, never an older/reused PID epoch.
    if ([Math]::Abs($created - $cimCreated) -gt 1 -or $recorded -lt $created -or $recorded -gt $created + 5 -or $server.HasExited) {
      throw 'Live postmaster creation time does not match the owned PID-file epoch.'
    }
    return $server
  } catch { $server.Dispose(); throw }
}

function Export-OwnedEndpoints {
  $endpoints = Get-Content -LiteralPath $endpointPath -Raw | ConvertFrom-Json
  foreach ($pair in @(@('connectionString', 'flarex_aot_runtime'), @('provisioningConnectionString', 'flarex_aot_admin'))) {
    $uri = [Uri]$endpoints.($pair[0])
    if ($uri.Scheme -ne 'postgresql' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -ne $Port -or
      $uri.AbsolutePath -ne '/flarex_core_aot' -or $uri.UserInfo.Split(':')[0] -ne $pair[1]) {
      throw "Endpoint does not match the owned local cluster: $($pair[0])"
    }
  }
  $env:FLAREX_POSTGRES_DATABASE_URL = $endpoints.connectionString
  $env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = $endpoints.provisioningConnectionString
}

$existing = Test-Path -LiteralPath $ownerPath -PathType Leaf
if ($existing) {
  $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
  Assert-Owner $owner
  if ($owner.phase -notin @('initializing', 'ready')) { throw 'Unknown owned setup phase.' }
  if ($owner.phase -ne 'ready' -and $Action -eq 'Start') {
    throw 'Owned setup is incomplete. Inspect its logs; this script will not reset it.'
  }
} else {
  if ($Action -ne 'Start') { throw 'No owned cluster metadata exists at StateDirectory.' }
  if ((Test-Path -LiteralPath $statePath) -and @(Get-ChildItem -LiteralPath $statePath -Force).Length -ne 0) {
    throw 'Refusing nonempty StateDirectory without this script ownership metadata.'
  }
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  try { $listener.Start() } finally { $listener.Stop() }
  New-Item -ItemType Directory -Path $statePath -Force | Out-Null
  $owner = [ordered]@{ owner = 'flarex-core-aot-benchmark'; workspace = $workspace; stateDirectory = $statePath;
    dataDirectory = $dataPath; binDirectory = $binaryPath; port = $Port; database = 'flarex_core_aot';
    adminRole = 'flarex_aot_admin'; runtimeRole = 'flarex_aot_runtime'; phase = 'initializing' }
  Write-PrivateJson $ownerPath $owner
}

$version = Invoke-PgTool $postgres @('--version') 'version'
if ($version.Output -notmatch 'PostgreSQL\) 18\.7(?:\s|$)') { throw 'Use the pinned PostgreSQL 18.7 Windows binaries.' }
if ($Action -eq 'Stop') {
  $status = Invoke-PgTool $pgCtl @('status', '-D', $dataPath) 'status' @(0, 3, 4)
  if ($status.ExitCode -eq 0) {
    $postmaster = Assert-OwnedPostmaster
    try { $null = Invoke-PgTool $pgCtl @('stop', '-D', $dataPath, '-m', 'fast', '-w', '-t', '60') 'stop' }
    finally { $postmaster.Dispose() }
  }
  Write-Output "Owned PostgreSQL stopped: 127.0.0.1:$Port; data retained at $statePath"
  return
}
if ($Action -eq 'Status') {
  $status = Invoke-PgTool $pgCtl @('status', '-D', $dataPath) 'status' @(0, 3, 4)
  if ($status.ExitCode -eq 0) {
    $postmaster = Assert-OwnedPostmaster
    try { if ($owner.phase -eq 'ready') { Export-OwnedEndpoints } }
    finally { $postmaster.Dispose() }
  }
  Write-Output "Owned PostgreSQL running=$($status.ExitCode -eq 0), host=127.0.0.1, port=$Port, state=$statePath"
  return
}

$started = $false
$postmaster = $null
try {
  if (-not $existing) {
    $adminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    $runtimePassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    Write-PrivateJson $endpointPath ([ordered]@{
      connectionString = "postgresql://flarex_aot_runtime:${runtimePassword}@127.0.0.1:$Port/flarex_core_aot"
      provisioningConnectionString = "postgresql://flarex_aot_admin:${adminPassword}@127.0.0.1:$Port/flarex_core_aot"
    })
    $passwordPath = Join-Path $statePath 'initdb-password.private'
    try {
      [IO.File]::WriteAllText($passwordPath, $adminPassword)
      $null = Invoke-PgTool $initdb @('-D', $dataPath, '-U', 'flarex_aot_admin', '--pwfile', $passwordPath,
        '--auth=scram-sha-256', '--locale=C', '--encoding=UTF8') 'initdb'
    } finally { if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath } }
    [IO.File]::AppendAllText((Join-Path $dataPath 'postgresql.conf'), "`nlisten_addresses = '127.0.0.1'`nport = $Port`nfsync = on`nsynchronous_commit = on`nfull_page_writes = on`npassword_encryption = 'scram-sha-256'`n")
  }
  $status = Invoke-PgTool $pgCtl @('status', '-D', $dataPath) 'status' @(0, 3)
  if ($status.ExitCode -ne 0) {
    $started = $true
    $null = Invoke-PgTool $pgCtl @('start', '-D', $dataPath, '-l', (Join-Path $statePath 'server.log'), '-w', '-t', '60') 'start'
  }
  $postmaster = Assert-OwnedPostmaster
  if (-not $existing) {
    $sqlPath = Join-Path $statePath 'provision.private.sql'
    $oldPassword = $env:PGPASSWORD
    try {
      [IO.File]::WriteAllText($sqlPath, "CREATE ROLE flarex_aot_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$runtimePassword';`nCREATE DATABASE flarex_core_aot OWNER flarex_aot_admin TEMPLATE template0;`nREVOKE ALL ON DATABASE flarex_core_aot FROM PUBLIC;`nGRANT CONNECT ON DATABASE flarex_core_aot TO flarex_aot_runtime;`n")
      $env:PGPASSWORD = $adminPassword
      $null = Invoke-PgTool $psql @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', [string]$Port,
        '-U', 'flarex_aot_admin', '-d', 'postgres', '-f', $sqlPath) 'provision'
    } finally {
      $env:PGPASSWORD = $oldPassword
      if (Test-Path -LiteralPath $sqlPath) { Remove-Item -LiteralPath $sqlPath }
    }
    $owner.phase = 'ready'
    Write-PrivateJson $ownerPath $owner
  }
  Export-OwnedEndpoints
  Write-Output "Owned PostgreSQL ready: 127.0.0.1:$Port; ordinary and provisioning URLs exported; private state=$statePath"
} catch {
  $failure = $_
  if ($started -and (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid') -PathType Leaf)) {
    try {
      $cleanupPostmaster = Assert-OwnedPostmaster
      try { $null = Invoke-PgTool $pgCtl @('stop', '-D', $dataPath, '-m', 'fast', '-w', '-t', '60') 'setup-failure-stop' }
      finally { $cleanupPostmaster.Dispose() }
    } catch { Write-Warning "Owned setup cleanup failed; inspect logs under $statePath" }
  }
  throw $failure
} finally { if ($null -ne $postmaster) { $postmaster.Dispose() } }
