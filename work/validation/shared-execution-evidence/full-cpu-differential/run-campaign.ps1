param([Parameter(Mandatory=$true)][ValidateSet('cpu','control')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$Label,[int]$Samples=40)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path 'work/validation/shared-execution-evidence/full-cpu-differential').Path
$taskOutput=Join-Path $taskRoot $Label
if(Test-Path -LiteralPath $taskOutput){throw 'Select a fresh evidence label'}
$env:FLAREX_POSTGRES_DATABASE_URL='postgresql://flarex_cpu_fixture@127.0.0.1:56434/postgres'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL='postgresql://postgres@127.0.0.1:56434/postgres'
$env:FLAREX_MEASUREMENT_ATTRIBUTION=$Kind
$env:FLAREX_MEASUREMENT_SAMPLES=[string]$Samples
$env:FLAREX_MEASUREMENT_REPORT_DIRECTORY=$taskOutput
$taskConfig=if($Kind -eq 'cpu'){Join-Path $taskRoot 'profile.config.ts'}else{'packages/executor/test/performance/measurement/attribution.vitest.config.ts'}
pnpm exec vitest run --config $taskConfig *> (Join-Path $taskRoot ($Label+'.log'))
exit $LASTEXITCODE
