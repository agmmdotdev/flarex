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

For a separate quiet component run set `NATIVE_RETRIEVAL_COMPONENT_SPANS=1`
and use a fresh label. Each Flarex sample retains selected existing Effect owner
spans with inclusive duration, parent identity and outcome; successful admission
must include exactly one binding validator and one stored-readiness validator.
The request interval still includes all preparation and acceptance work. Compare
this run with the original quiet control to observe tracer overhead. Nested span
durations and their medians/P95 are not additive. The stored-readiness validator
is the comparable initial-readiness subcomponent; a replacement that extends a
binding callback through native work changes that callback's denominator. Measure
the final guard separately and derive any combined admission interval from each
sample's disjoint intervals before computing its distribution. Missing spans do
not establish zero cost; SQL/server/body-transfer evidence remains separate.

For a separate complete-request cold connection run set
`NATIVE_RETRIEVAL_COLD_POOL_CLIENT=1`. Before every Flarex invocation, the benchmark
requires idle target/control Pools with no held or waiting clients, acquires all
idle clients through their Pool and destroys them with `release(true)`. This reset
is outside the request interval and reported separately; connection establishment,
authentication and first Parse occur inside the unchanged `CommerceHost.read`
interval. The profile is **coldPoolClient**, not a request-scoped Client host.
The native paired lane retains its existing module/pool lifetime. Five process
warmups still precede thirty retained samples; every Flarex sample gets fresh
physical connections. Default retained-pool measurements remain separate.

For independent protocol diagnostics use `NATIVE_RETRIEVAL_MODE=trace` and
`NATIVE_RETRIEVAL_PROTOCOL=1`, optionally with the cold option. Actual pg Connection
`parse`, `bind`, `describe`, `execute`, `sync` and simple `query` submissions are
observed in both drivers. Arguments, receivers, results and thrown errors pass
through unchanged. Evidence retains method, connection, statement name and SQL
byte length/hash only; no SQL bodies, bind values or credentials. This records
method submissions, not server completion or wire bytes. Simple Query plus Execute
counts must match client SQL dispatches; named identity bindings cover both shapes,
and cold requests must Parse both exact SQL names. Keep protocol/hash instrumentation
outside quiet latency comparisons and label each report with its actual options.

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

## Read construction comparison

The focused read-admission slice retains a fresh baseline at `e6bd105ea` in
`quiet-construction-baseline.json`, `trace-construction-baseline.json` and
`server-construction-baseline.json.gz`. All three modes passed complete selected
DTO and missing-error parity, stable captured sources/runtime settings and zero
sample failures. Their common original source-evidence hash remains
`58024526264fd85307226054bf0083400bb64548fc37f61d743b66252f766a7c`.
`construction-baseline-summary.json` derives only these fresh baseline samples;
the prior final-result summary above remains a distinct retained measurement.
The matched final `construction-final` quiet, trace and server reports passed with
stable captured sources/runtime and zero sample failures. Their exact working-tree
checkpoint label is `read-admission-construction-final-working-tree@e6bd105ea`, with
source-evidence SHA-256
`2771e3a1d08a9deb436ec4690c8dc019dd9c67ada49d9fc577ddf2aab54ea44d` shared by all
three modes. Source/harness changes were frozen throughout. Final slice review,
validation and cleanup acceptance remains pending; whole-goal latency/scaling is open.

The `construction-after` reports and derived comparison/manifest remain immutable
intermediate measurements of the pre-correction capture lock order. The shared
capture held head `SHARE` before clock `KEY SHARE`, opposite to actual activation's
clock-then-head `FOR UPDATE`, permitting a concrete concurrent lock cycle. Corrected
capture uses clock before head with the original lock strengths and one exact
transaction-local clock observation. Final-source measurements use the new
`construction-final` label after that owner correction. The earlier source-evidence
hash is `bc91dde4b7489a0dd3b3ef7aa77d829e878e1e061424eb5ef116397141f9697c`, with
checkpoint `read-admission-construction-working-tree@e6bd105ea`. Its sequential
intermediate samples do not prove lock compatibility or final-source acceptance.

| Demand | Native baseline median/P95 ms | Native final median/P95 ms | Flarex baseline median/P95 ms | Flarex final median/P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Scalar | 1.46145 / 1.91400 | 1.34505 / 1.84960 | 77.74790 / 89.36170 | 54.57540 / 65.86190 |
| Collection | 1.93995 / 2.45830 | 1.69120 / 2.20060 | 80.10995 / 108.83800 | 54.29190 / 59.06080 |

Both selected quiet runs used five warmups and thirty samples per case/lane, serial
alternating pairs. Flarex medians decreased 29.80%/32.23%; native controls moved
7.96%/12.82% lower. Final native maxima were 2.0042/2.4663 ms; every outlier remains
retained. These are matched local before/after observations, not exact causal
CPU/latency attribution. Complete request preparation is inside each operation
interval; genuine fixture/host setup remains separate in the raw reports/summaries.

| Demand/lane | SQL baseline → final | Transactions baseline → final | Driver rows baseline → final | JSON bytes baseline → final |
| --- | ---: | ---: | ---: | ---: |
| Scalar native | 1 → 1 | Autocommit → autocommit | 1 → 1 | 146 → 146 |
| Collection native | 1 → 1 | Autocommit → autocommit | 1 → 1 | 186 → 186 |
| Scalar Flarex | 106 → 70 | 6 → 3 | 222 → 192 | 248,243 → 160,802 |
| Collection Flarex | 108 → 72 | 6 → 3 | 224 → 194 | 250,350 → 162,924 |

Statements before the actual Product method decreased from 103 to 67 in both
Flarex cases. Final-run scalar/collection native business storage demand remains
two/four dispatches, followed by one COMMIT; the native control remains one query
per demand. Before-method work returns 190 rows/157,552 JSON bytes in each final
case. All configured control, unique/lifecycle and accepting work is counted;
the three actual transactions are target capture, configured control schema binding
and fresh business acceptance, not a claimed universal two-transaction ceiling.

The separate final server run reproduced 70/72 Flarex top-level calls, versus
106/108 before. Flarex scalar planning/execution was 8.9543/2.3495 ms final versus
10.0609/2.7810 before; collection was 8.9146/2.2573 final versus 10.1494/2.5682
before. Native final planning/execution was 0.0980/0.0173 ms scalar and
0.1969/0.0349 ms collection. No independent nested entries or shared block reads
were observed in either selected set of intervals; this does not prove absent
function/trigger work. Server timings include instrumentation and cannot be added
to quiet/trace intervals to explain the quiet improvement.

The following disjoint final-run scalar regions reconcile all 70 dispatches:

| Region | One-based SQL positions | Dispatches | Driver rows | JSON bytes |
| --- | --- | ---: | ---: | ---: |
| Scope/placement resolution | 1–6 | 6 | 6 | 1,674 |
| Bounded Application target capture | 7–21 | 15 | 17 | 45,875 |
| Detached schema/unique/lifecycle/control authentication | 22–37 | 16 | 11 | 9,849 |
| Fresh business binding/Application acceptance, including session setup | 38–59 | 22 | 24 | 71,383 |
| Full logical-source readiness | 60–66 | 7 | 131 | 28,489 |
| Source initialization admission | 67 | 1 | 1 | 282 |
| Native scalar storage demand | 68–69 | 2 | 2 | 3,248 |
| Business COMMIT | 70 | 1 | 0 | 2 |

The largest remaining region by dispatches/bytes is fresh binding/Application
acceptance. Its repeated candidate/publication/function/task/readiness bodies and
two readiness row reads belong to the existing accepting composition and
`validateStoredIssuedReadiness` owner; session setup and framework binding are
also included in that region. Any next optimization must trace the registered
guard/full-proof contract and select a correct owner cut, not infer a removable
check from counts alone. Full logical-source readiness is the largest metadata-row
region: 79 ordered-build, 26 unique-build and eight search-build rows, with 15 table
frontier rows, additional clock observations and physical search proof. Demand
narrowing remains an explicit future semantic decision, distinct from preparation
reuse. Retained finite, full mixed latency, relation growth, scaling and hosted
acceptance remain open; this standalone comparison cannot close those gates.

Final capture SQL position 9 obtains scope clock `KEY SHARE` before position 10
obtains active-head `SHARE`. The protected before/after observations remain at
positions 11/20, and the business accepting transaction remains fresh. This trace
confirms the observed order, while concurrency proof belongs to the owner tests.

Final quiet setup remains outside retrieval intervals: native schema preparation
389.1236 ms, overlapping schema/module construction 1,289.7881 ms and public seeding
30.9173 ms; Flarex fixture/host construction 12,331.3714 ms and public seeding
242.9195 ms. These local setup spans are not additive or production admission costs.

`construction-final-summary.json` retains mode-specific derived results;
`construction-final-comparison-summary.json` records every common/supplemented baseline
source hash, the seven changed captured files, exact quiet/trace/server comparisons
and owner regions. `construction-final-manifest.json` hashes the final raw reports
and derived artifacts, including compressed and decompressed content. Baseline
raw reports and their original source inventory remain unchanged. The intermediate
`construction-after-summary.json`, `construction-comparison-summary.json` and
`construction-after-manifest.json` remain immutable; their comparison records
58.48545/56.60825 ms Flarex medians and 70/72 SQL dispatches at its earlier source.

The original harness source list omitted the Application construction/acceptance
and preparation-lifetime owners. `construction-baseline-source-supplement.json`
records exact bytes and SHA-256 from the `e6bd105ea` Git tree for ten omitted
owners and the connected `logical-currency-fixture.ts`. This is supplemental
committed-source provenance, not evidence that the
original harness observed those files. Original reports remain unchanged. The
subsequent source list includes activation, readiness, active-head read, binding
projection, physical lifecycle, host preparation, Commerce admission, framework
binding repository and installation runtime. Thus before/after aggregate source
hashes will differ; compare actual file hashes and the explicit supplement rather
than claiming identical source inventories.

The connected `applicationRelationReadinessFold.ts` owner is also inventoried for
its retained requirements-charge normalization. The actual Payload Local API
witness exercises that distinct relation branch; this native standalone benchmark
does not execute it. Its supplemental committed-byte hash does not imply original
harness capture or measured execution coverage.

The actual fixture now exposes its already compiled, exactly typed
`currencyDefinition` to the connected backend resource witness. The backend
consumes fixture evidence through the existing owner; this adds no source-boundary
exemption or production API. Its source is included in subsequent reports. None
of the three original baseline source inventories captured that fixture; its old
Git hash is explicit supplemental evidence and the original reports remain intact.

These measurements use the root-owned PostgreSQL 18.3 cluster at
`work/validation/read-construction-postgres/data`, port 55444, with log
`work/validation/read-construction-postgres/server.log`. Native and logical
databases/ordinary roles are `flarex_read_native_20261001` and
`flarex_read_logical_20261001`; the separate core-correctness database is
`flarex_read_core_20261001` and is excluded from the benchmark observer. The
observer connects to `postgres` and covers every executing role in the two
measured databases. Native role/database search path is `native_retrieval,public`;
the actual native connection selects `native_retrieval`.

From the workspace root, use fresh unique base labels and fresh processes:

```powershell
$env:NATIVE_RETRIEVAL_DATABASE = 'flarex_read_native_20261001'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '55444'
$env:DB_USERNAME = 'flarex_read_native_20261001'
$env:DB_PASSWORD = ''
$env:FLAREX_POSTGRES_DATABASE_URL = 'postgres://flarex_read_logical_20261001@127.0.0.1:55444/flarex_read_logical_20261001'
$env:FLAREX_POSTGRES_PROVISIONING_DATABASE_URL = 'postgres://postgres@127.0.0.1:55444/flarex_read_logical_20261001'
$env:NATIVE_RETRIEVAL_DIAGNOSTIC_URL = 'postgres://postgres@127.0.0.1:55444/postgres'
$env:NATIVE_RETRIEVAL_CHECKPOINT = '<exact base; raw hashes identify executing edits>'
$env:NATIVE_RETRIEVAL_RUN_LABEL = '<unique base label without a mode prefix>'
$env:NATIVE_RETRIEVAL_MODE = 'quiet'
$env:NATIVE_RETRIEVAL_WARMUPS = '5'
$env:NATIVE_RETRIEVAL_SAMPLES = '30'
Set-Location packages/medusa-adapter
node ../../node_modules/vitest/vitest.mjs run --config vitest.native-retrieval.config.ts
```

For trace, keep quiet database settings and run a new process with mode `trace`,
zero warmups and one sample. For server, set both measured databases to
`pg_stat_statements.track=all`, `pg_stat_statements.track_planning=on` and
`auto_explain.log_min_duration=0` before the fresh process. The selected diagnostic
configuration also sets `auto_explain.log_nested_statements=on`, `log_analyze=on`,
`log_timing=off`, `log_buffers=on`, `log_triggers=on`, `log_format=json` and
`log_parameter_max_length=0`. Preloaded libraries are
`pg_stat_statements,auto_explain`; `log_line_prefix` is `%m [%p] %d %u %a `.
Run server with zero warmups and one sample. Capture the log start byte before
bootstrap, then its exact end after completion. Retain that byte segment with
bootstrap/seed/parity/sample scope explicit. Do not reset statistics or run other
work in either measured database.

Apply the server switch from either working directory, then invoke the benchmark
in the adapter directory in a fresh process:

```powershell
$taskPsql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
foreach ($taskDatabase in @('flarex_read_native_20261001', 'flarex_read_logical_20261001')) {
  foreach ($taskSetting in @(
    "pg_stat_statements.track = 'all'", "pg_stat_statements.track_planning = 'on'",
    "auto_explain.log_min_duration = '0'", "auto_explain.log_nested_statements = 'on'",
    "auto_explain.log_analyze = 'on'", "auto_explain.log_timing = 'off'",
    "auto_explain.log_buffers = 'on'", "auto_explain.log_triggers = 'on'",
    "auto_explain.log_format = 'json'", "auto_explain.log_parameter_max_length = '0'"
  )) {
    & $taskPsql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55444 -U postgres -d postgres -c ('ALTER DATABASE "{0}" SET {1}' -f $taskDatabase, $taskSetting)
    if ($LASTEXITCODE -ne 0) { throw 'Failed diagnostic configuration' }
  }
}
$env:NATIVE_RETRIEVAL_MODE = 'server'
$env:NATIVE_RETRIEVAL_WARMUPS = '0'
$env:NATIVE_RETRIEVAL_SAMPLES = '1'
$taskLog = 'C:/Users/Admin/Documents/github/convex-backend/custom/cloudflare-executor/work/validation/read-construction-postgres/server.log'
$env:NATIVE_RETRIEVAL_LOG_START = (Get-Item -LiteralPath $taskLog).Length.ToString()
```

After server completion, capture its exact end. From the adapter directory, this
archives fresh JSON and log segments exclusively, verifies decompression and
reports compressed/content hashes. The original JSON remains available:

```powershell
$env:NATIVE_RETRIEVAL_LOG_END = (Get-Item -LiteralPath $taskLog).Length.ToString()
node -e 'const fs=require("node:fs"),z=require("node:zlib"),c=require("node:crypto");const p="benchmarks/core-performance/native-retrieval/",label=process.env.NATIVE_RETRIEVAL_RUN_LABEL;if(!/^[a-zA-Z0-9_.-]+$/.test(label))throw Error("Invalid label");const log="../../work/validation/read-construction-postgres/server.log",start=Number(process.env.NATIVE_RETRIEVAL_LOG_START),end=Number(process.env.NATIVE_RETRIEVAL_LOG_END);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw Error("Invalid log bounds");const fd=fs.openSync(log,"r"),content=Buffer.alloc(end-start);let n=0;while(n<content.length){const read=fs.readSync(fd,content,n,content.length-n,start+n);if(!read)throw Error("Incomplete log segment");n+=read}fs.closeSync(fd);const hash=b=>c.createHash("sha256").update(b).digest("hex");for(const [name,bytes] of [["server-"+label+".json",fs.readFileSync(p+"server-"+label+".json")],["server-plans-"+label+".log",content]]){const compressed=z.gzipSync(bytes);if(!z.gunzipSync(compressed).equals(bytes))throw Error("Compression mismatch");fs.writeFileSync(p+name+".gz",compressed,{flag:"wx"});console.log(JSON.stringify({name:name+".gz",bytes:compressed.length,sha256:hash(compressed),contentBytes:bytes.length,contentSha256:hash(bytes)}))}console.log(JSON.stringify({startByte:start,endByteExclusive:end}))'
```

Restore quiet configuration for both measured databases before quiet/trace:
`pg_stat_statements.track=none`, `pg_stat_statements.track_planning=off` and
`auto_explain.log_min_duration=-1`. Disabled logging makes the retained diagnostic
detail settings inert. Observe effective settings through actual connections;
SQL configuration intent alone does not establish equality.

```powershell
foreach ($taskDatabase in @('flarex_read_native_20261001', 'flarex_read_logical_20261001')) {
  foreach ($taskSetting in @("pg_stat_statements.track = 'none'", "pg_stat_statements.track_planning = 'off'", "auto_explain.log_min_duration = '-1'")) {
    & $taskPsql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55444 -U postgres -d postgres -c ('ALTER DATABASE "{0}" SET {1}' -f $taskDatabase, $taskSetting)
    if ($LASTEXITCODE -ne 0) { throw 'Failed quiet configuration' }
  }
}
```

The server baseline JSON is losslessly compressed. Its original length is
15,850,966 bytes and SHA-256 is
`a817671f3a23c0bb1a3369b3ff87a3aebd93bd8771b8f463bca304a52a97f03b`.
`server-plans-construction-baseline.log.gz` starts at byte 688 of the owned log
and includes bootstrap, seed, parity and diagnostic activity, ending at exclusive
byte 63,528,824. Archive hashes and precise retained content bounds are in
`construction-baseline-manifest.json`. Compressed
logs may include inclusive parent/nested plans; do not sum them as independent
work or treat server diagnostic elapsed time as quiet latency.

After-run server JSON was losslessly compressed to
`server-construction-after.json.gz`; its original length is 19,645,489 bytes and
SHA-256 is `7b40948c9aedb0a87287d33338108426233da142f9ea4eca2ad2bddb39132ffa`.
`server-plans-construction-after.log.gz` contains the exact owned log range
[63,532,069, 125,696,443), retaining 62,164,374 original bytes and 2,648,728
compressed bytes. It includes bootstrap, seed, parity and server diagnostics,
not a quiet interval. Root restored track `none`, planning `off` and log minimum
`-1` afterward. Exact compressed/content hashes remain in the after manifest.

Final server JSON is retained losslessly as `server-construction-final.json.gz`:
23,411,218 original bytes, SHA-256
`8d06803d9e584a447de080356e10b8070543893e8486e4960844406f5ab910ac`;
2,483,778 compressed bytes, SHA-256
`0d321ee5eb9de62cd59879ee188e0d5ebbb80083a3bc92fb874700603dc32f9d`.
`server-plans-construction-final.log.gz` retains the exact owned range
[125,700,978, 187,811,863): 62,110,885 original bytes, SHA-256
`b3c3967e46bfd9a158a7179b3360eb70ce93968fc233fc4bd5d6d7b5c510097d`;
2,637,210 compressed bytes, SHA-256
`c3acfbfda572691c6a3fdd4820e458640404c11ac70252e304889203cf1e1145`.
This archive includes bootstrap, seed, parity and diagnostics. Root verified both
decompressed archives, removed the redundant raw server JSON and restored track
`none`, planning `off` and log minimum `-1`. The final manifest also hashes the
immutable baseline and intermediate manifests; no original reports were rewritten.

## Prior native measurement validation receipts

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
At that prior measurement checkpoint their bytes matched committed baseline bytes;
no consumer source was edited. Existing generated build hashes already matched. Guard rules, pinned
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

## Fresh Application acceptance

The selected named identity owner passes the controlled component gate. Complete
retained-Pool requests also improve, while a substantial gap to native Medusa
remains. Bounded connected correctness and cold/protocol evidence are established;
the full mixed milestone retains its original unresolved regression. The [focused preflight](../../../../../roadmaps/core-performance/fresh-application-acceptance-preflight.md)
owns the approved proof and refusal timing; this ledger owns exact measurements.

| Distribution, ms | Baseline scalar median/P95 | Named scalar median/P95 | Baseline collection median/P95 | Named collection median/P95 |
| --- | ---: | ---: | ---: | ---: |
| Initial readiness + precheck + tail sample-level interval union | 8.03275 / 12.8889 | 4.3112 / 6.8804 | 7.34905 / 11.749 | 4.18135 / 7.4727 |
| Complete request, no component/protocol observation | 56.2086 / 68.1748 | 52.98275 / 66.3527 | 54.91225 / 89.1993 | 47.83545 / 53.2059 |

Each quiet run uses five warmups and thirty retained samples per demand and lane.
The union merges each sample's overlapping intervals before distribution; medians
and P95 are never added. Current paired native medians/P95 are 1.5369/2.1463 ms
scalar and 1.6499/2.134 ms collection. These measurements establish this component
improvement, not native parity, Hyperdrive latency or whole-goal acceptance.

`named-acceptance-summary.json` links the original baseline, named component and
complete-request raw JSON. Both named reports retain their exact source before
the mechanical Describe portal/type label correction. That helper executes only
in opt-in protocol trace mode, and the production sources are unchanged. Later
protocol/cold evidence uses its own source inventory. The original baseline's
omitted Application-native fixture inventory remains explicitly recorded; no
retroactive hash is presented as an original capture.

Warm protocol scalar/collection requests have 63/65 SQL dispatches and three
transactions, with Parse 51/53, Bind/Describe/Execute/Sync 55/57 each and eight
simple Query submissions. The two identity shapes execute four Binds with no
Parse in the warm profile. `coldPoolClient` destroys one idle target and one idle
control client per request, then has the same SQL/transaction counts with Parse
53/55: both identity statements get their first Parse, whose names match the
compiled SQL digest, while all four identity Binds still execute. Native uses one
simple Query per selected retrieval. These method counts are distinct from SQL
dispatches, server-completed messages, wire bytes and roundtrips.

The separate cold quiet run retains five warmups/thirty samples with component
and protocol observation disabled. Flarex scalar median/P95 is
177.5451/211.7458 ms; collection is 178.4756/185.6469 ms. Reset method medians
0.1204/0.11305 ms are outside these request intervals. Native existing-lifetime
medians/P95 are 1.4323/1.8189 ms scalar and 1.7454/2.1442 ms collection. No
pre-change complete cold request baseline was captured, so this establishes
charged coldPoolClient costs rather than comparative improvement. It does not
establish request-scoped Client-host or cache-disabled Hyperdrive performance.

`fresh-acceptance-candidate-summary.json` preserves both earlier failed latency
candidates, their canonical-removal/dispatch proof and bounded structural scaling.
Filenames containing `final` in those older artifacts identify their collection
labels; they do not imply performance acceptance. Their server artifacts are
lossless gzip of explicitly sanitized derivatives. Only SQL PASSWORD credential
literals were redacted; exact original bytes and original/sanitized hashes remain
in ignored private receipts. The repository artifacts retain the redaction label
and original hash, and the summary records compressed and uncompressed hashes.

### Connected milestone disposition

The [focused shared milestone ledger](../../../../flarex-backend/benchmarks/core-performance/fresh-application-acceptance/README.md)
preserves baseline quiet/structural smoke, final complete quiet/traced requests
and the targeted mixed repeat with lossless raw packaging and source/settings
provenance. Bounded connected correctness is established. The original full mixed
quiet run regresses; its targeted repeat is healthy, but cause is unestablished.
The repeat does not replace original samples or close whole performance goals.
Actual Hyperdrive activation, native parity
and post-native finite Product event global-tail proof remain outside this evidence.
