# Matched finite Product retrieval

The selected [finite execution contract](../../../../../roadmaps/mixed-mutation-core/23-finite-execution-contract-preflight.md)
replaces current-head correlation at finite read boundaries with authenticated
attempt metadata and demanded serving checks. Its cutover and acceptance remain
in progress. The frozen predecessor comparison failed the fixed added-latency
and whole-request regression gates; those reports remain evidence of that
earlier runtime. Successful scenario execution confirms result/error assertions
and records measurements; it does not mean numerical performance gates passed.

This optional component benchmark compares the actual pinned native
`retrieveProduct(id)` with the admitted private finite Product `retrieve` call.
Each finite sample uses a fresh authenticated Application attempt and single-use
Worker over one real prepared module/schema/pool graph. No retrieval options or
public mixed API are added. Hits are first storage demands in their attempt;
misses retain the native error and poison that attempt.

Compare paired additive method overhead against **median <= 5 ms and P95 <= 10
ms for both hits and misses**. Three discarded warmups precede thirty retained
serial pairs per branch, with alternating pair order. Whole request latency must
also avoid regression against the matched original. These component gates do
not replace the complete Product, Product/Payload and workflow targets in
[preflight 20](../../../../../roadmaps/mixed-mutation-core/20-query-required-read-execution-preflight.md).

The method interval includes native service construction, storage, operation
close and receipt validation. The separate complete finite interval includes
request admission, Worker startup/execution/disposal, seal, publication and
attempt-fixture disposal. Actual provisioning, module preparation and all seed
work are charged separately for the measured series lifetime. Native schema and
module bootstrap is recorded independently. Setup is never assumed permanent or
subtracted from whole-goal accounting.

Both complete default DTOs and their exact structure are retained. Generated
`created_at` and `updated_at` values differ between independently authoritative
stores: validate each canonical ISO timestamp and compare every other value and
key exactly. Errors compare the actual native name/type/message through the
existing commerce `adapterFailure.cause`; the original complete Exit is forwarded
unchanged. There is no failure recovery, direct SQL seeding or post-seed rewrite.
The test observer awaits its diagnostic snapshot before teardown. Synchronous
observer throws and rejected snapshots are recorded separately as the first
diagnostic failure for the series; they preserve the native Exit and cause the
benchmark to refuse the measurement after the request completes.

Use the existing PostgreSQL inputs without printing credentials. The root owns
an isolated native database with ordinary-role ownership and
`mixed_native_read,public` search path; Flarex retains its existing protected
target/provisioning split. Database resources and executable Medusa build outputs
must remain fixed between original and candidate runs. The benchmark starts no
database service. Source fingerprints and a separate executing-build/provenance
supplement identify the actual evidence boundary.

The executing-evidence inventory verifies all 1,396 promoted build outputs and
eleven pinned native files against the original. Its twelfth entry is the
authored `native-runner.ts`, whose source changed to omit an optional module
definition only when that definition is absent. The actual pinned
`ModulesDefinition.product` exists (`key: product`, `isQueryable: true`), so this
benchmark still passes the same Product definition object. The authored runner
is a recorded source difference; executable framework outputs were not rebuilt.

From the workspace root:

```powershell
node node_modules/typescript/bin/tsc -p packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/tsconfig.json --noEmit --pretty false
$env:NATIVE_RETRIEVAL_DATABASE = '<isolated existing native database>'
$env:FLAREX_MIXED_NATIVE_READ_CHECKPOINT = '<exact baseline or candidate checkpoint>'
$env:FLAREX_MIXED_NATIVE_READ_REPORT_DIR = '<owned validation evidence directory>'
$env:FLAREX_MIXED_NATIVE_READ_LABEL = '<unique label>'
$env:FLAREX_MIXED_NATIVE_READ_MODE = 'quiet'
$env:FLAREX_MIXED_NATIVE_READ_SAMPLES = '30'
$env:FLAREX_MIXED_NATIVE_READ_WARMUPS = '3'
Set-Location packages/medusa-adapter
node ../../node_modules/vitest/vitest.mjs run --config vitest.mixed-native-read.config.ts
```

The finite PostgreSQL fixture uses the selected managed installation profile.
Schema, source and installation correctness remain runtime-owned. Historical
full-proof baseline results stay frozen as artifacts; that finite runtime path
is removed from the current benchmark.

Run `MODE=trace`, two samples and zero warmups under a new label for client
dispatch/transaction evidence. The named `native Product operation` phase
isolates actual method work from entry and final settlement. Quiet mode adds no
pool observer; the actual fixture's built-in SQL observer state is reported.
Trace timings carry instrumentation cost and are not quiet performance results.
Trace records returned row counts and UTF-8 JSON encoding bytes of the decoded
results separately from SQL text and scalar parameters. BigInt uses decimal
strings; Date and Buffer use their normal JSON forms. This is an explicit
decoded encoding measure, not wire traffic or heap allocation. Metadata
summaries report all method results, then isolate installation/placement/clock,
session/lease, journal/claim/running tail, binding/Application heads, selected
index maintenance and the metadata epoch tail from business rows. Unknown result
encodings are counted and refuse the focused trace evidence.

The setup report reads the existing source preparation lease's actual charged
bytes. Trace samples snapshot it before request, before/after native demand and
after request. Full catalog growth remains charged during cold construction;
incremental demand retention is the difference between those real lease reads.
Quiet mode does not add these per-demand counters.
SQL dispatches are distinct from network round trips. The frozen original
actual method uses nineteen dispatches for a hit and eighteen for a miss in one
accepting transaction; the selected indexed-method ceiling is thirteen/twelve,
including BEGIN/COMMIT and the required positive row observation.

For CPU attribution, run a separate diagnostic series with a unique label and
an owned report directory, retaining the same PostgreSQL inputs:

```powershell
$env:FLAREX_MIXED_NATIVE_READ_MODE = 'cpu'
$env:FLAREX_MIXED_NATIVE_READ_SAMPLES = '2'
$env:FLAREX_MIXED_NATIVE_READ_WARMUPS = '0'
$env:FLAREX_MIXED_NATIVE_READ_LABEL = '<unique diagnostic label>'
$env:FLAREX_MIXED_NATIVE_READ_REPORT_DIR = '<owned evidence directory>'
node ../../node_modules/vitest/vitest.mjs run --config vitest.mixed-native-read.config.ts
```

The command runs from `packages/medusa-adapter`, as above. It writes the CPU
report and eight genuine V8 `.cpuprofile` files: native and finite profiles for
each of two hit and two miss samples. Profiles use the installed
`node:inspector/promises` owner with a requested 100 microsecond sampling
interval. Profiler initialization and start finish before the actual method
clock; stop and profile file writes follow the completed method interval. The
finite profile covers the existing private native operation, including its
service construction, close and receipt validation, through the awaited
complete Exit observer. That observer preserves the original native outcome;
diagnostic failures refuse the measurement. Outstanding inspector operations
drain before session disconnect and fixture disposal, including interruption.
Profile files refuse overwriting existing evidence under the same label.

The report retains the actual returned profiler timestamps, profile hashes and
source fingerprints. Profiles sample the local Node isolate, including its
asynchronous and inspector work; they do not profile remote Worker compute or
Postgres execution. Short profiles are noisy. Profile spans and SQL awaits
overlap, and subtracting them does not establish exclusive CPU. CPU-mode method
and whole-request timings include diagnostic overhead and cannot satisfy quiet
latency gates. The lane retains the same DTO/error, durability and statistics
checks, with `pg_stat_statements.track=none` and disabled `auto_explain` logging.

The first recorded eight-profile diagnostic requested 100 microseconds but its
following sample deltas had medians near 0.54 ms. Warm finite hit/miss profiles
contained only 28/22 samples. Returned profile spans also include the initial
inspector `post` sample for profiler startup, which weighed 240–776 ms before
the method clock. Those spans are not method intervals. Keep the genuine
timestamps and complete profiles; do not trim startup or interpret weighted
self/inclusive frame samples as exclusive CPU. Inclusive stacks overlap, and
idle/GC/inspector samples must remain distinct from business work. Two samples
per branch cannot establish a broad construction or cache optimization.

For unrelated metadata scaling, set `FLAREX_MIXED_NATIVE_READ_METADATA_AXIS` to
`tables`, `indexes`, `relations` or `otherSourceDefinitions`, and
`FLAREX_MIXED_NATIVE_READ_METADATA_COUNT` to `1` or `100`. The existing canonical
metadata scaling fixture's explicit finite variant adds unused named btree
indexes on the existing Product `title` column. Other-source scaling connects
one fixed benchmark definition to Product `id` with a strong reference and
`deleted_at` target liveness, then varies the same source's empty definitions.
Native columns, keys, DTOs and the fixed ID retrieval demand stay unchanged;
canonical preservation checks allow only these named additions. The existing
standalone scaling default remains separate. Compare method proofs and
transfer independently from complete catalog, entry, final and installation
costs, which remain charged and reported.

Run `MODE=server` separately with effective `pg_stat_statements.track=all` and
`FLAREX_MIXED_NATIVE_READ_OBSERVER_DATABASE_URL` pointing outside the selected
native/Flarex databases. The existing observer authenticates actual database
identities and records all executing roles, including protected function owners.
It requires actual calls for both native and finite methods, control tracking
`all`, and positive nested reads of installation, placement/receipt, execution
authority, publication sequencer, session, snapshot lease, journal and claim.
The actual finite acceptance has two separately observed top-level statements:
installed acceptance invokes the installation/placement/scope functions and
reads both qualified target/control epoch joins; JavaScript authenticates that
projection before compact attempt acceptance invokes the running-attempt
function and acquires session/lease/root/claim locks. The scope function locks
execution authority and reads the sequencer without a stable sequence lock.
Finite metadata stays fixed by its entry reservation, so its epoch projections
are not an additional nested whole-metadata tail. The diagnostic requires both
actual phases and every nested owner rather than substituting any epoch mention
for the installed projection. The classifier recognizes the scope-observation
function explicitly; existing installed/compact statements already matched
other owner names, so this addition does not establish a prior undercount.

The observer does not reset global statistics. Quiet/trace/CPU require tracking
`none` and disabled `auto_explain` logging; all lanes retain fsync, synchronous
commit and full page writes. Server mode measures full native/finite intervals and finite
method work. The complete Exit hook awaits the post-operation snapshot before
success acknowledgement or failure teardown, outside the quiet method interval.
Nested server timings, Effect spans and client awaited intervals overlap and
must not be added into a causal latency explanation. Driver wire bytes, network
round trips and isolated CPU remain unavailable.

Initial original evidence is retained under
`work/validation/mixed-query-read-20261003/native-read-baseline/`:
`mixed-native-baseline-02-quiet.json`,
`mixed-native-baseline-trace-02-trace.json`, and
`baseline-executing-evidence.json`. The first attempted quiet run refused the
new native database's incorrect tracking setting before any measured samples;
it is a setup failure, not latency evidence. No whole-goal acceptance or hosted
activation is claimed by this benchmark.
