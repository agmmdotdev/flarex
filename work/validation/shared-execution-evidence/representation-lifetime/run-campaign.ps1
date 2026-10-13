param([Parameter(Mandatory=$true)][string]$Label,[int]$Samples=32,[switch]$Reverse)
$ErrorActionPreference='Stop'
$taskEvidence=(Resolve-Path 'work/validation/shared-execution-evidence/representation-lifetime').Path
$taskOutput=Join-Path $taskEvidence $Label
if(Test-Path -LiteralPath $taskOutput){throw 'Select a fresh label to preserve existing evidence'}
$env:FLAREX_POSTGRES_DATABASE_URL='postgresql://flarex_cpu_fixture@127.0.0.1:56434/postgres'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL='postgresql://postgres@127.0.0.1:56434/postgres'
$env:FLAREX_EVIDENCE_OUTPUT=$taskOutput
$env:REPRESENTATION_SAMPLES=[string]$Samples
$env:REPRESENTATION_REVERSE=if($Reverse){'1'}else{'0'}
pnpm exec vitest run --config (Join-Path $taskEvidence 'vitest.config.ts') *> (Join-Path $taskEvidence ($Label+'.log'))
exit $LASTEXITCODE
