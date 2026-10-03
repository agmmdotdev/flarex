# Matched finite Product retrieval

The query-required implementation is paused for design discussion as an
incomplete checkpoint. The matched quiet comparison still fails the fixed
added-latency and whole-request regression gates. Successful scenario execution
confirms its result/error assertions and records measurements; it does not mean
the numerical performance gates passed. Latest local evidence and remaining
validation are inventoried in
`work/validation/mixed-query-read-20261003/HANDOFF.md` at the workspace root.

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
`all`, and visible nested installation, placement/receipt, journal/claim and
metadata tail statements. It does not reset global statistics. Quiet/trace require tracking `none` and
disabled `auto_explain` logging; all lanes retain fsync, synchronous commit and
full page writes. Server mode measures full native/finite intervals and finite
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
