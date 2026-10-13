param([Parameter(Mandatory=$true)][ValidateSet('composition','snapshot','control')][string]$Stage,
[Parameter(Mandatory=$true)][string]$Label, [switch]$Reverse)
$ErrorActionPreference = 'Stop'
$taskEvidence = (Resolve-Path 'work/validation/shared-execution-evidence/composition-snapshot-reduction').Path
$taskOutput = Join-Path $taskEvidence $Label
if (Test-Path -LiteralPath $taskOutput) { throw 'Select a fresh label; preserve prior evidence' }
$env:FLAREX_POSTGRES_DATABASE_URL = 'postgresql://flarex_cpu_fixture@127.0.0.1:56434/postgres'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = 'postgresql://postgres@127.0.0.1:56434/postgres'
$env:VALIDATION_STAGE=$Stage
$env:VALIDATION_REVERSE=if($Reverse){'1'}else{'0'}
$env:FLAREX_EVIDENCE_OUTPUT=$taskOutput
$taskConfig=if($Stage -eq 'control'){'control.config.ts'}else{'ab.config.ts'}
pnpm exec vitest run --config (Join-Path $taskEvidence $taskConfig) *> (Join-Path $taskEvidence ($Label+'.log'))
exit $LASTEXITCODE
