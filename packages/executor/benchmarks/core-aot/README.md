# Current Core PostgreSQL request comparison

See the [measured full-request findings](./RESULTS.md) and
[retained observations](./observations.windows-x64.json).

This command measures the actual current `mixed-product` request through
`prepareCoreMixedProductScenario`: Application insert/patch, native Product
update/retrieve/list, event staging, OCC, durable outcome and final publication.
The existing fixture and scenario retain construction, seeding, verification and
cleanup. No Legacy finite instrumentation or replacement business logic is used.

Supply two endpoints for an isolated test database through
`FLAREX_POSTGRES_DATABASE_URL` (ordinary serving role) and
`FLAREX_POSTGRES_PROVISIONING_DATABASE_URL` (fixture maintenance). The fixture
creates a unique namespace, grants only ordinary runtime DML and removes its
owned namespace on disposal. The serving role cannot have superuser, bypass-RLS,
create-database, create-role or replication capabilities. The worker also
records server version and verifies `fsync`, `full_page_writes` and
`synchronous_commit` are on. Endpoint URLs are never written to reports.

From the repository root:

```powershell
node packages/executor/benchmarks/core-aot/run.mjs --bun C:/Users/User/.bun/bin/bun.exe --out work/validation/core-aot-baseline --rounds 2 --samples 30 --warmups 5
```

`--mode generated|interpreter|both` selects the actual installed static schema
decoders or a build-only installer bypass; default is both.
`--runtime node|bun-aot|both` selects Node JIT or a true `--compile --aot`
executable; default is both. Each mode's exact frozen JavaScript graph runs in
both runtimes. Native Medusa uses its existing built legacy-decorator output,
matching the direct performance harness's native dependency boundary. Global
`source` export conditions would incorrectly re-transpile native decorators.
Core imports still execute current source. All dependencies are bundled; no
`--aot-allow-code-from-disk` is enabled.

Warmups plus samples cannot exceed the existing 105-sample fixture bound.
`--samples 1 --warmups 0 --rounds 1 --mode generated` is a smoke check, not
performance acceptance. Output must be empty and children run sequentially,
with reversed runtime/mode order on alternate rounds. Do not overlap quiet runs
with builds, tests or another benchmark.

Use `--build-only` to freeze assets before making an optimization, without a
database. Later, pass `--assets PATH_TO_THAT_DIRECTORY --out A_NEW_DIRECTORY`
to verify the saved hashes and run those exact assets. This permits matched
control/candidate comparisons in one checkout without reverting shared changes.
The source revision, dirty paths, runtime versions, bundle/source-map hashes and
binary hashes are retained. Raw child output and failures remain in the chosen
output directory. A failed worker cannot become a successful measurement row.

For the original runtime control after editing this checkout, add
`--runtime-source-revision COMMIT` to a new build. The driver resolves that ref to
an exact commit and a build-only plugin reads only the three owned runtime files
(`packages/utils/src/bytes.ts`, `packages/flarex-protocol/src/document-value.ts`
and `packages/persistence-postgres/src/core/query.ts`) using `git show`. Each
source keeps its original module directory for relative imports. The manifest
records the resolved revision and each source SHA256. All other files, including
the measured worker, remain the current shared checkout; no file is reverted and
no worktree is created. Unknown revisions or missing source files fail the build.
Saved `--assets` keep that provenance and verify their frozen hashes as before;
the source-revision flag cannot be combined with `--assets`.

For example, the initial runtime's generated/interpreter assets can be rebuilt
with `--runtime-source-revision 2d30e605 --mode both --runtime both --build-only`.
The generated bundle must match its original pre-edit frozen hash before using
this control for a causal comparison.

To repeat the source-order comparison, build both snapshots before timing and
run the four cohorts sequentially in one PowerShell session after starting the
owned PostgreSQL cluster:

```powershell
$series = 'work/validation/core-aot-repeat-' + (Get-Date -Format yyyyMMddTHHmmss)
$runner = 'packages/executor/benchmarks/core-aot/run.mjs'
node $runner --bun C:/Users/User/.bun/bin/bun.exe --runtime-source-revision 2d30e605 --out "$series-control-assets" --mode both --runtime both --build-only
node $runner --bun C:/Users/User/.bun/bin/bun.exe --out "$series-optimized-assets" --mode both --runtime both --build-only
foreach ($cohort in @('control-a', 'optimized-a', 'optimized-b', 'control-b')) {
  $variant = $cohort.Split('-')[0]
  node $runner --assets "$series-$variant-assets" --out "$series-$cohort" --mode both --runtime both --rounds 1 --samples 30 --warmups 5
  if ($LASTEXITCODE -ne 0) { throw "Failed cohort: $cohort" }
}
```

Every sample uses a fresh seeded business graph. The timer covers only
`sample.run()`, including real PostgreSQL settlement. Existing committed Product
and Application readback runs afterward; each row is accepted only after that
verification and all owner cleanup succeed. CPU means process user plus system
CPU during the request and excludes PostgreSQL server CPU. Windows CPU counters
are coarse; retain the raw rows and compare sufficiently long cohorts. Reported
median/P95 use nearest-rank percentiles over all retained measured requests.
These are matched-runtime request comparisons, not native-business-relative
acceptance or a scale/deployment proof.

## Request CPU diagnostics

Profile Node requests separately, without the rejected Legacy observer injection:

```powershell
node packages/executor/benchmarks/core-aot/run.mjs --bun C:/Users/User/.bun/bin/bun.exe --out work/validation/core-aot-profile --mode generated --runtime node --profile --rounds 1 --samples 3 --warmups 2
```

The existing `BenchmarkCpuProfiler` starts before each measured request timer,
stops after settlement/timing and persists raw profiles and delta/self-frame
summaries before verification. Preparation, seeding and verification are outside
the profile. The result is labeled `cpu-diagnostic` and cannot qualify as quiet
sampling evidence. Actual sample periods differ from the requested 100 μs;
inclusive stacks, waits and sampled self frames do not establish exclusive CPU.
This inspector path is Node-only. Bun whole-process CLI profiling can supplement
it but includes construction/seeding and must not be treated as request-only CPU.

The fixture currently evaluates an authored handler with `new Function`.
Compiling the host alone does not establish whether Bun resolves that particular
constant string at build time. The report explicitly retains that limitation.

## Harness checks

```powershell
node --test packages/executor/benchmarks/core-aot/harness.node-test.mjs
node node_modules/.pnpm/tsrs@0.20.1-ts7.1.0-beta/node_modules/tsrs/bin/tsrs --fast -p packages/executor/benchmarks/core-aot/tsconfig.json --noEmit
```

The first command checks stale-output refusal, retained failed-build evidence,
changed-asset refusal and unknown source-revision refusal without a database or
Bun installation. The scoped check invokes the engine goal's selected cached
Oxc (`tsrs`) 0.20.1 directly. The unrelated workspace catalog currently resolves
0.23.0, so the ambient `pnpm exec tsrs` would select a different version. No
native TypeScript compiler comparison is performed here.
