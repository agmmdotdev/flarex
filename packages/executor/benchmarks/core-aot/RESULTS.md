# Current Core CPU optimization and complete PostgreSQL requests

The two runtime changes reduce measured client CPU on the actual bounded mixed
Application/Product request. With the installed generated decoders, Bun AOT mean
CPU falls from **92.52 to 86.02 ms per request**, a **7.0% reduction**. Median
request latency falls from **95.51 to 93.36 ms**. Node benefits too. This is one
local request graph, not a claim that Bun is universally faster or that the
broader native-relative, Cloudflare or scaling gates have passed.

## Changes at the real owners

- Query pagination still captures the selected document and validates its Core
  system fields and applicable user/system limits. Its new immediate call to
  `encodeCapturedDocumentValue` reuses the exact existing serialization algorithm
  without normalizing/copying the same private tree again. Public unknown-input
  encoding retains its full capture. Encoded/semantic page limits, refusal order,
  charging and dependency recording remain in the same order.
- The shared byte renderer uses a private frozen 256-entry lowercase table
  instead of formatting every byte repeatedly. Intrinsic typed-array iteration
  remains, preserving visible ranges, ignored caller overrides and platform
  failures for detached/proxy/impostor views. It adds no host-specific API.

The [source challenge](../../../../experiments/core/engine/slices/core-aot-hot-paths.md)
records the current owners, pinned Convex mechanism, independent peer challenges,
retained guarantees and deferred broader capture/index changes. No database
schema, SQL, authority, permission, freshness or commit mechanism changed.

## Complete-request comparison

Windows x64, Ryzen 5 2600, Node 26.13.0, Bun 1.4.5 and PostgreSQL 18.7. The
loopback-only cluster uses a restricted ordinary serving role and a separate
maintenance endpoint. `fsync`, synchronous commit and full-page writes are on.
The Core fixture owns and drops each generated test namespace.

The request is the existing current `mixed-product` scenario: Application
insert/patch, native Product update/retrieve/list, event staging, OCC, durable
outcome and atomic publication. Its existing committed Product/Application
readback runs after timing. Preparation, seeding, verification and cleanup are
excluded from request time. This is the actual Core path, not the Legacy finite
host or a replacement implementation of the business work.

Four sequential process cohorts ran in **control, optimized, optimized, control**
order. Every cohort runs both decoder modes in Node and true `--compile --aot`
Bun executables. Each worker has five warmups and thirty measured fresh graphs:
**480 measured requests, 80 warmups, 16 workers**, all verified and disposed.
Each table row has sixty measured requests from two processes. No outlier was
removed; percentiles use nearest rank.

| Decoder mode | Runtime | Mean CPU: control → optimized | Median latency: control → optimized | P95 latency: control → optimized |
| --- | --- | ---: | ---: | ---: |
| Installed generated | Bun AOT | 92.52 → 86.02 ms | 95.51 → 93.36 ms | 136.60 → 116.44 ms |
| Installed generated | Node | 112.00 → 97.90 ms | 101.12 → 91.80 ms | 125.74 → 108.80 ms |
| Interpreter control | Bun AOT | 92.92 → 88.23 ms | 93.80 → 95.54 ms | 138.78 → 115.44 ms |
| Interpreter control | Node | 108.12 → 92.52 ms | 101.56 → 85.87 ms | 140.44 → 107.27 ms |

With installed generated decoders, Bun AOT mean CPU decreases by 6.50 ms/request;
Node decreases by 14.10 ms/request, or 12.6%. The two Bun AOT control-process
means are 91.77/93.27 ms and candidate means 86.60/85.43 ms. The control placement
brackets the candidate runs to reduce a simple time-order bias.

Windows per-request CPU accounting is coarse. For example, generated Bun's
median CPU steps from 94 to 78 ms while the actual cohort mean changes by only
6.50 ms. **Use the mean and raw rows for the CPU claim, not a claimed 17% gain
from that median step.** CPU includes process user/system and runtime background
work occurring inside the request interval; PostgreSQL server CPU is excluded.

Interpreter Bun latency did not improve, and its control process means vary
substantially. Installed schema generation also does not improve every Node
full-request metric here. These controls are retained. The earlier decoder
microbenchmark cannot predict a universal full-request win. Two processes per
configuration and serial requests sharing a fixture do not establish population
confidence, throughput capacity or production tail guarantees.

## Matched source and profiling

Control runtime code is pinned to `2d30e605623a15ec67fc95388b64913a9b52ee92`.
The build-only source control reads exactly the three changed runtime files
from Git into Bun's loader. It never reverts working files or creates a worktree.
Its regenerated generated bundle exactly reproduces the pre-edit frozen hash:
`b468203898b505587d83f1d64d4ec361f8030d3ff81debdb54f19a53b67adf93`.
Both source variants use the same current fixture/harness and installed native
Medusa decorator output. Node and Bun run the identical frozen graph for each
variant/mode. Bundle, executable and source-map hashes are verified on reuse.

Request-only Node profiles were collected separately, before and after quiet
measurement, using the existing inspector owner. They exclude seeding and
committed verification but retain profiler-edge observations. Their sample
counts differ and their timings are diagnostic. They show actual value capture,
generic Result/Effect work, native index-specification encoding and byte
rendering; they do not allocate exclusive causal CPU savings to each change.
The combined change is measured here; individual savings are not isolated.

The authored Application fixture constructs a handler with `new Function`.
Bun can specialize some constant-derived strings, but this experiment does not
prove whether that handler was precompiled. The Core host executable is genuine
machine-code AOT and permits no external code loading from disk.

## Validation and remaining limits

| Validation | Result |
| --- | --- |
| Protocol document/index codecs | 12 tests passed |
| Query budgets/ordering/ownership, PGlite | 22 tests passed |
| Same query scenarios, ordinary PostgreSQL | 22 tests passed |
| Byte renderer | 33 tests passed |
| Current mixed lifecycle, PGlite | 5 tests passed |
| Same mixed lifecycle, ordinary PostgreSQL | 5 tests passed |
| Index snapshot coverage/accounting | 15 tests passed |
| Harness failure/provenance checks | 4 tests passed |
| Native process-controller lifecycle | 3 tests passed |
| Live stale-PID identity regression | Both Stop and Start adoption refused; unrelated owned server survived |
| Pinned Oxc `tsrs 0.20.1 --fast`, scoped checks | Passed |
| Core/diff lint, Effect boundary guard | Passed |
| Generated schema consistency | 60 targets in 8 modules verified |

The mixed lifecycle cases preserve one-timestamp Application/Product/event/
outcome publication, replay and cold reopen without callbacks, and whole-root
rollback after late, caught or dropped failures. Byte and codec cases preserve
intrinsic refusals, golden encodings and detached ownership. PostgreSQL roles
and durability were verified again after a stop/restart cycle.

An initial parallel Vitest startup hit a shared-cache Windows `EPERM`; database
lanes were then run sequentially. Its original log remains in
`work/validation/core-aot-query-checks/pg-overlap-startup.log`. This does not prove
all other Windows contributors absent. PostgreSQL client 8.22 emits an existing
queued-query deprecation warning. It is retained, with no failed request or
cleanup converted into a timing result.

The controller's stale-PID review correction binds shutdown to live process
command-line data-directory and creation identity rather than trusting a PID
file and executable path alone. It is separate from runtime request code.
The [live regression](../../../../scripts/core-aot-postgres-regression.ps1)
uses two additional owned clusters with the same executable, forges a stopped
cluster's PID file to identify the other live cluster, and confirms both Stop
and Start adoption refuse before shutdown. The live target still serves an
ordinary-role query; both extra clusters are stopped afterward. Parser refusal
cases are also checked. The benchmark cluster remains unchanged by this test.
Only the exact owned cluster may be stopped; unrelated/shared databases and the
two unrelated pre-existing workspace edits remain untouched.

## Reproduce and inspect

Use the [local PostgreSQL instructions](../../../../scripts/core-aot-postgres.README.md)
and [benchmark commands](./README.md). The original and optimized frozen assets
and full logs remain in `work/validation/core-aot-original-assets` and
`work/validation/core-aot-optimized-assets`. Query-only snapshots are also retained
for a later ablation; no performance claim is made for that unmeasured variant.

[Observations](./observations.windows-x64.json) include all aggregate/cohort
metrics, source and artifact identities, PostgreSQL settings and profile frames.
Compressed raw requests and all six request profiles are in `evidence/`, with
compressed/uncompressed SHA256 hashes. Executables, credentials and databases
are not committed.
