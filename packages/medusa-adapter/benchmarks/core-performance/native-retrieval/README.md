# Paired native Product retrieval measurement

This optional benchmark compares pinned native Medusa Product/MikroORM on real
PostgreSQL with the promoted Product method running through protected Flarex
`CommerceHost.read`. It uses public native collection and Product creation,
strict equality of complete selected DTOs, and native missing-Product errors.
Scalar and populated collection demands are separate. Selected method bodies
match the pinned source; this is not proof of identical constructors or all
Product behavior.

The populated native DTO retains `collection_id` when selecting the collection
relation. The expected complete DTO includes that join field; both lanes retain
it without projection or normalization.

## Prerequisites

Use the existing workspace dependencies and the installed root pnpm version.
Only these ignored build outputs are required when missing or stale:

```powershell
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/product build
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/link-modules build
pnpm --filter @medusajs/utils build
pnpm --filter @medusajs/product build
```

Provision two root-exclusive PostgreSQL databases. Native uses an ordinary role
owning its existing database and the explicit `native_retrieval` schema. Set its
role/database `search_path` to `native_retrieval,public`: pinned schema generation
qualifies tables but emits unqualified index targets. Keep the public
`pg_stat_statements` extension outside native cleanup. Flarex uses the existing
protected fixture, its ordinary runtime login and a separate provisioning URL.
The fixture owns schema/role cleanup. The benchmark does not start a server.

The dedicated Vitest config externalizes actual promoted `medusa-*/dist/`
CommonJS files. Native `pg-god` loads tslib 1.14.1, which publishes a legacy
private-field helper globally. Vitest's inlined arrow evaluator gives generated
CommonJS a global top-level receiver and can select that incompatible helper.
Native Node CommonJS loading preserves the module receiver and its generated
modern helper. The pure witness and failed public-seed report are retained here;
there is no global helper replacement or business-source patch.

## Commands

From the workspace root, verify the optional source graph:

```powershell
node node_modules/typescript/bin/tsc -p packages/medusa-adapter/benchmarks/core-performance/native-retrieval/tsconfig.json --pretty false
```

Set the actual isolated resources and an exact checkpoint before collection or
execution. The following matches the local resource names used by this run;
replace them when provisioning another isolated run. URLs are runtime inputs,
not evidence fields.

```powershell
$env:NATIVE_RETRIEVAL_DATABASE = 'flarex_orchestration_native_20261001'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '55443'
$env:DB_USERNAME = 'flarex_orchestration_native_20261001'
$env:DB_PASSWORD = ''
$env:FLAREX_POSTGRES_DATABASE_URL = 'postgres://flarex_orchestration_logical_20261001@127.0.0.1:55443/flarex_orchestration_logical_20261001'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = 'postgres://postgres@127.0.0.1:55443/flarex_orchestration_logical_20261001'
$env:NATIVE_RETRIEVAL_CHECKPOINT = '<exact reviewed Git checkpoint>'
$env:NATIVE_RETRIEVAL_MODE = 'quiet'
$env:NATIVE_RETRIEVAL_WARMUPS = '0'
$env:NATIVE_RETRIEVAL_SAMPLES = '1'
$env:NATIVE_RETRIEVAL_RUN_LABEL = '<unique smoke label>'
Set-Location packages/medusa-adapter
node ../../node_modules/vitest/vitest.mjs list --config vitest.native-retrieval.config.ts --json
node ../../node_modules/vitest/vitest.mjs run --config vitest.native-retrieval.config.ts
```

For quiet measurements use five warmups and thirty retained samples per demand
and lane. Calls are serial with alternating pair order. Quiet and trace require
actual `pg_stat_statements.track=none`; visible `auto_explain.log_min_duration`
must be `-1`. Trace uses a new label, mode `trace` and one sample by default.
It records client dispatch, rows and native call edges separately from quiet
latency. Setup, parity checks and settings capture remain outside intervals.

Server mode requires root configuration of both measured databases for
`pg_stat_statements.track=all`, plus explicitly recorded auto_explain settings
and external server-log cuts. Start a fresh process after configuration. Set
`NATIVE_RETRIEVAL_DIAGNOSTIC_URL` to a privileged observer connection in a third
database (for this run `postgres://postgres@127.0.0.1:55443/postgres`) with the
stats extension installed. The observer refuses a measured database. Snapshots
include all executing roles in the two root-exclusive databases, covering
SECURITY DEFINER owners as well as runtime logins. Runtime/control identities
and statement `userid` remain recorded. Do not run unrelated work in these
databases or reset global statistics.

[PostgreSQL 18 pg_stat_statements](https://www.postgresql.org/docs/18/pgstatstatements.html)
documents the database/user/query/top-level identities and nested tracking.
[PostgreSQL 18 auto_explain](https://www.postgresql.org/docs/18/auto-explain.html)
documents nested logging and observer overhead. Parent and nested times are
inclusive and must not be summed. Function/trigger coverage remains unavailable
unless separate logs observe it. Server timing is diagnostic, with instrumentation
overhead; it is not quiet latency.

## Evidence and current limits

Each unique label is written exclusively; a prior report cannot be replaced.
Evidence retains before/after sources and actual runtime settings, every raw
sample/outlier/failure, setup durations, full parity DTOs and exact failure stage.
Restricted settings are explicit unavailable observations; they are not treated
as shared-setting equality. Source or runtime drift fails the comparison.

The retained initial smoke reports failed before observed retrieval: native
schema bootstrap, ordinary-role visibility of `shared_preload_libraries`, then
the promoted public-seed compiler-helper collision. Their summaries identify
these stages. Compiler-helper loading evidence is a pure witness, not a database
or retrieval result. Successful protected bootstrap, DTO/error parity and final
measurement passed in the final runs described below.

`quiet-matched-native-control.json` reached all four scalar/collection retrieval
results with equal complete DTOs between lanes, then failed the harness literal
because it omitted native `collection_id`. The original report is retained and
the expected literal now includes the observed join field. Missing-error parity
and timed samples were not reached in that run.

`trace-matched-complete-dto.json` failed in the diagnostic observer: native
repository access returns a dynamic proxy wrapper, and observing that wrapper
caused recursive lookup after replacement. Method observation now wraps the
actual defining descriptor and restores it exactly, leaving the native proxy's
receiver binding and error mapping in place. The failed trace remains retained.
The earlier quiet result predates this observer correction; a final matching
source checkpoint is recorded by the final quiet run below.

## Final measured result

`quiet-verified-coverage.json`, `trace-verified-coverage.json` and
`server-verified-coverage.json.gz` all passed complete scalar/collection DTO
and native missing-error parity. Their before/after source evidence matches
across all three runs; actual runtime settings and database/role identities
remained stable within each run. The recorded base checkpoint is `f3258681a`;
the exact executing sources and generated outputs are identified by their raw
hashes, including the measurement changes made after that base.
The common before/after source-evidence SHA-256 is
`58024526264fd85307226054bf0083400bb64548fc37f61d743b66252f766a7c`.

The earlier descriptor-observer reports remain unchanged and valid for their
earlier source checkpoint
`36cc4eed9255bb408dfb9e3365b6b7111f2b8023ecd9d2a8497a4033f6dd2adb`.
Their former derived summary and manifest snapshots are preserved as
`descriptor-observer-summary.json` and `descriptor-observer-manifest.json`.
The archived manifest records the former derived filenames; the current
manifest hashes their preserved copies at these new names.
The intermediate authenticated-coverage reports remain unchanged and valid
for checkpoint
`7bf114f5a18d03805b903798d94b1c5ac254889ea1726ede9468d0ec69188b3f`, with former
derived snapshots retained as `authenticated-coverage-summary.json` and
`authenticated-coverage-manifest.json`. Their names were normalized after
generation without changing bytes; the supplied labels and exact disposition
are recorded below. These earlier reports do not claim the latest source hash.
The current summary uses only the verified-coverage runs. The reviewed
harness correction selects actual authenticated catalog database names/OIDs,
requires runtime/control database parity and distinct native/Flarex databases,
and checks the selected native environment database. URL-encoded name spelling
cannot silently exclude logical server statistics.
The observer also verifies both selected name/OID pairs against its own catalog
before claiming coverage, filters by those verified OIDs, and requires positive
observed calls in the authenticated database for every successful server sample.
Missing catalog coverage, a mismatched OID, unavailable/empty work or work only
from the other lane fails the comparison. The final selected database IDs are
144862 (native) and 144863 (Flarex); they changed when the owned resources were
recreated between generations and stayed stable within these final runs.

Quiet latency is the complete existing request lifetime. Each case/lane has
five warmups and thirty retained samples, serial alternating pair order, zero
sample failures and no diagnostic instrumentation. Medians use the arithmetic
mean of the middle two samples; P95 uses nearest rank `ceil(n * 0.95)`.

| Demand | Native median ms | Flarex median ms | Native P95 ms | Flarex P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Scalar | 1.54745 | 80.34065 | 2.84320 | 141.20940 |
| Collection | 1.87310 | 76.81550 | 2.21760 | 84.22460 |

Separate trace samples observed one SQL dispatch in native autocommit per case.
Flarex observed 106 scalar and 108 collection dispatches, each across six
explicit transactions. Driver results totaled 222/224 rows and
248,281/250,399 JSON bytes respectively; these are diagnostic serialization
sizes, not wire bytes. The actual Product method inside Flarex took
5.2588/8.5451 ms inclusive in these instrumented samples. This points to work
outside that method as a measured attribution lead; it does not establish a
safe simplification or permission to remove any fresh check.

Owner tracing places the first five transactions in standalone binding
selection/construction and ordinary Application activation/readiness acceptance.
The sixth transaction captures the fresh business snapshot, revalidates binding,
Application and protection, accepts logical source readiness, then probes and
hydrates the requested data. There are 103 SQL dispatches before the Product
method. The private finite profile already retains preparation within its host
lifetime and performs fresh accepting checks; it does not rerun these standalone
first five transactions on every read. Standalone attribution cannot be applied
as the finite profile's per-read cost.

The separate server diagnostic intervals reproduced top-level call counts
1/106 for scalar and 1/108 for collection. Native planning/execution totals
were 0.1073/0.0176 ms and 0.1852/0.0350 ms. Flarex totals were
11.0584/2.9975 ms and 11.7519/3.1607 ms. No shared disk block reads or independent
nested statement rows were observed in those intervals. That observation does
not establish absent function/trigger work. All counters and complete
before/after snapshots are retained. Server timings include diagnostic
instrumentation overhead from statement planning statistics and auto_explain.
Separate observer snapshots are outside the measured intervals and their
database identity is excluded from the server ledger.

Setup remains separate. In the quiet run, native schema preparation was
248.3567 ms, the overlapping schema/module construction span was 364.7250 ms,
and public seeding was 30.5695 ms. Flarex fixture/host construction was
12,809.7570 ms and public seeding was 272.8302 ms. These spans describe this
local fixture setup; they are not additive or production admission costs.
Authentication, liveness and every actual fresh check within the retrieval
request are included in quiet latency.

`measurement-summary.json` contains exact derived values and definitions.
`evidence-manifest.json` hashes every retained raw report, failure summary and
compressed diagnostic archive. The server JSON was compressed losslessly;
both original content and retained compressed bytes have hashes. The server
log archive starts at byte 127,529,385 of the owned log and includes bootstrap,
seed, parity and diagnostic samples. It is not a quiet log interval.
To read retained compressed JSON without recreating a duplicate file:

```powershell
node -e "const fs=require('node:fs'),z=require('node:zlib');const d=JSON.parse(z.gunzipSync(fs.readFileSync('benchmarks/core-performance/native-retrieval/server-verified-coverage.json.gz')));console.log(d.status,d.samples.length)"
```

This is bounded local PostgreSQL evidence for the selected retrieval demands.
It does not close all native Product parity or the performance goal, prove
Cloudflare/deployment behavior, or justify weakening protected execution.

## Validation receipts

The focused optional benchmark typecheck and dedicated Vitest collection passed.
Root validation also passed the adapter's five typecheck projects, `lint:core`,
`lint:diff` and `check-medusa-test-port`. The selected existing PGlite Product
native create/read/committed replay regression passed one test with eleven
unselected tests skipped. These checks complement the separate ordinary-role
PostgreSQL benchmark runs; they are not additional performance samples.

The package promotion hash was refreshed only after removing the declared
measurement devDependencies reproduced the old manifest hash byte for byte.
The added dependencies are `pg` 8.22.0 and `@types/pg` 8.20.0. Promotion inventory
also records the optional protected runner selection and authored benchmark
support/configuration/evidence. Two stale authored target hashes were reconciled
to the exact already committed `f3258681a` baseline: `src/product-attempt.ts`
(`34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae`), whose
approved changes are in `1b16d05936201367e5346d21c0a034c7a1fbb667`, and
`test/support/logical-currency-fixture.ts`
(`f42778c5abeeb12647db920369f16d11286a292dd0b94e5c39ff1dfe57343011`), whose
protected preparation change is in `f11e907f6294cd218473c21df463df4c1f7993a3`.
Their current bytes matched committed baseline bytes; no consumer source was
edited. Existing generated build hashes already matched. Guard rules, pinned
sources and transformation classifications were unchanged by hash reconciliation.

The source-boundary owner now admits only the scenario's three exact native
built imports, its enumerated forensic/bootstrap path literals and the observer's
exact pinned package URL. These permissions require authored scenario, observer
and dedicated configuration inventory. Provenance data permissions do not permit
native source imports, and the named controls reject computed imports, aliased
loaders and namespace/default/renamed `node:module` imports. Exact literals are
admitted only in the named source-evidence array, native bootstrap property and
existing loader construction contexts. This is a syntactic ownership boundary,
not a JavaScript sandbox. Two exact already committed backend test edges were
admitted separately: the Workerd Product test's private attempt edge originates
in `1b16d0593`, and the prepared-target metadata test's fixture edge in
`5ec24b74c`. Adjacent tests and backend runtime inherit neither permission.

The focused source-boundary suite passed all 23 tests, including rejection of
adjacent/runtime importers, native source imports, unlisted island paths and
missing or non-authored control/configuration inventory, computed source imports
and aliased/computed repository loads. Four additional isolated server selection
and coverage tests passed the URL-encoded catalog-name witness, identity refusal
gates, missing/wrong observer catalog and empty/wrong-lane work witnesses.
The exact 27-test command from the workspace root was:

```powershell
node node_modules/vitest/vitest.mjs run scripts/check-medusa-source-island-boundary.test.js packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.test.ts --maxWorkers=1 --no-file-parallelism --exclude 'work/validation/**' --exclude '.kilo/worktrees/**'
```

The dedicated timing configuration still collects exactly one scenario;
the server unit tests are outside it. Optional benchmark types and collection
passed after both review corrections. `medusa:source:typecheck`
passed. Sequential pinned source verification passed 8,496 files and zero
symlinks at fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`; the source-island
guard passed its actual workspace/Medusa graph. There is no benchmark directory
exemption, runtime export, arbitrary island-path allowance or tooling skip.

The intermediate historical runs supplied `quiet-authenticated-coverage`,
`trace-authenticated-coverage` and `server-authenticated-coverage` as their
respective `NATIVE_RETRIEVAL_RUN_LABEL` values. The harness added its automatic
mode prefix, creating double-prefix names. Root renamed only those newly
generated report files to single-prefix authenticated-coverage names, preserving
their exact bytes. Quiet used five warmups and thirty samples; trace and server
used zero warmups and one sample per demand and lane. Supplying the base label
`authenticated-coverage` would have produced those names directly.

The final runs supplied exactly `NATIVE_RETRIEVAL_RUN_LABEL='verified-coverage'`.
The harness added one mode prefix, so these final files needed no renaming.
Quiet retained five warmups and thirty samples per case/lane; trace and server
each retained one sample per case/lane with no warmups. Root independently
verified final DTO/runtime/source stability, executing-file hashes, positive
lane server work, the 27 focused tests and final core/diff lint.
For another run, supply a fresh base label without a mode prefix. Exclusive
creation refuses replacement of retained reports.
