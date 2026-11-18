param(
  [Parameter(Mandatory=$true)][ValidateSet('cycles','cpu','control')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$Label,
  [ValidateSet('engine','generators')][string]$Detail = 'engine',
  [ValidateSet('abba','baab')][string]$Order = 'abba',
  [int]$Samples = 32
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path '.').Path
$taskEvidence = Join-Path $taskRoot 'work/validation/shared-execution-evidence/measurement-cpu-attribution'
$taskOutput = Join-Path $taskEvidence $Label
if (Test-Path -LiteralPath $taskOutput) { throw 'Campaign output already exists; select a fresh Label to preserve prior evidence' }
$env:FLAREX_POSTGRES_DATABASE_URL = 'postgresql://flarex_cpu_fixture@127.0.0.1:56434/postgres'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = 'postgresql://postgres@127.0.0.1:56434/postgres'
$env:FLAREX_MEASUREMENT_ATTRIBUTION = $Kind
$env:FLAREX_MEASUREMENT_CYCLE_DETAIL = $Detail
$env:FLAREX_MEASUREMENT_CYCLE_ORDER = $Order
$env:FLAREX_MEASUREMENT_SAMPLES = [string]$Samples
$env:FLAREX_MEASUREMENT_CYCLE_READER = (Resolve-Path 'work/validation/shared-execution-evidence/engine-cpu-attribution/thread-cycles.node').Path
$env:FLAREX_MEASUREMENT_REPORT_DIRECTORY = $taskOutput
pnpm exec vitest run --config packages/executor/test/performance/measurement/attribution.vitest.config.ts *> (Join-Path $taskEvidence ($Label + '.log'))
exit $LASTEXITCODE
