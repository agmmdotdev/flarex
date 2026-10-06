# Core performance

The daily performance loop runs actual Payload Local API operations, native
Medusa workflows and Flarex execution/persistence owners directly in Node.
It uses ordinary-role PostgreSQL and real transaction settlement. It does not
start Workerd, Miniflare or an HTTP server.

The [measurement SDK](./measurement/README.md) and this command share the
scenario catalog and family preparation owner. The SDK observes the existing
sample invocation; its committed-result verification, cleanup and preparation
remain with the flow owner. PGlite exposes the same scenario views for timeline
and CPU diagnostics; database observation requires actual PostgreSQL pools.
Native Product, Payload and Medusa workflow invocations receive diagnostic
tracing at their existing Effect runtime entry. Mixed execution also forwards
the existing publication observation and cleanup-failure sink. Quiet callers
omit those capabilities. Additional graphs and typical sizes still need their
own matching native reference before a paired comparison.

## Complete native reference

Use the [complete native business baseline](../../../medusa-adapter/benchmarks/core-performance/native-business/README.md)
for the matched daily graphs. The owner-selected
[acceptance policy](../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
is at most 5 ms added median / 10 ms added P95 for the complete matched request.
The old mixed absolute targets are historical intermediate milestones, and native
retrieval/unique probes are method diagnostics. Additional flows and sizes require
their own matching native business graphs before acceptance claims.

Use paired final-source quiet measurements, at least thirty retained samples
after five warmups (prefer one hundred), matching versions, durability, inputs,
hooks, graph cardinality, outputs and construction lifetime. Retain failures and
tails; calculate complete-request paired excess before percentiles. The reference
uses independent native commits and Application SQL surrogates, so attribute
Flarex's OCC/history/atomic-outcome/publication work explicitly. Do not subtract
unmatched percentile summaries or relax correctness to approach native costs.
The short/smoke and twenty-sample/three-warmup full modes remain iteration
evidence. `--acceptance` selects one hundred quiet requests after five warmups.
It meets the sample-count policy when every request and cleanup passes, but
does not itself establish paired native-relative acceptance.

## Run the Flarex measurement harness

From the workspace root, with `FLAREX_POSTGRES_DATABASE_URL` configured for the
existing isolated PostgreSQL test environment:

```sh
pnpm perf:core --scenario payload-create
pnpm perf:core --list
pnpm perf:core --scenario product-update --smoke
pnpm perf:core --family product
pnpm perf:core --family payload --size typical
pnpm perf:core --daily
pnpm perf:core --scenario mixed-product --acceptance
pnpm perf:core --scenario mixed-product --full --cpu
pnpm perf:core --scenario mixed-payload --sql
pnpm perf:core --scenario mixed-workflow
pnpm perf:core --all --full
```

The environment must have the test fixture's existing provisioning permissions;
request execution uses its ordinary runtime roles. Do not point this harness at
an application database. Credentials are supplied by the caller, not saved in
the reports or command examples.

The default scenario is Payload create. A short series is for iteration, not
tail-latency acceptance: one warmup and three measured requests. `--smoke` runs
one verified request with no warmup and explicitly excludes latency acceptance.
`--full` selects three warmups and twenty measured requests for iteration.
`--acceptance` selects five warmups and one hundred quiet measured requests;
it cannot combine with full, smoke, SQL or CPU. `--sql`
adds a separate diagnostic invocation before quiet warmup and timing, rather than
tracing every timed request. Its SQL count describes that first diagnostic request,
not a warmed SQL distribution.
Failed operations are reported as failures and the command exits unsuccessfully.
With `--all`, independent scenarios still run so one failure does not hide the
other results.

Each JSON report shows observed complete costs, the pinned native reference's
identity/hash and median/P95, one 5/10 ms added-cost allowance, and remaining
semantic attribution. The table shows native costs beside Flarex costs without
subtracting independent percentiles. The original small daily flows have a
reference; extended flows and typical sizes show `missing-native-graph`.
Planning total budgets are reference cost plus the allowance, not paired excess.
`pairedExcess` is null and `quietAcceptance` is false until fresh matched pairs,
final-source/settings stability and controlled tail evidence are supplied by
the performance program. `quietSamplingEligible` only establishes a completed
quiet sample plan of at least thirty samples after five warmups. Command-level
eligibility also requires successful runner/family cleanup. Retained native
framework calls commit independently and Application writes are SQL surrogates;
the reports explicitly leave Flarex semantic cost attribution unresolved.

Select a single changed flow first, then its `--family product|payload|mixed`,
and the historical five with `--daily`. `--all` is the extended milestone matrix,
not the default iteration command. `--list` needs no database. Smoke cannot
combine with full, SQL or CPU modes.

For a fast check of the measurement assembly itself, use the same native flows
with PGlite and no timing claims:

```sh
pnpm exec vitest run --config packages/executor/test/performance/vitest.unit.config.ts
pnpm exec vitest run --config packages/executor/test/performance/vitest.flows.config.ts
```

`FLAREX_CORE_FLOW_GROUP=product|payload|mixed` selects one verification group;
`FLAREX_TEST_DRIVER=postgres` selects ordinary-role PostgreSQL instead of PGlite.
These checks cover executor measurement assembly, not the other correctness
suites. The existing single-worker module cache and external built Medusa source
islands keep startup bounded. Full request semantics are still executed.

`--cpu` profiles each complete measured request separately after ordinary warmup.
It cannot combine with `--sql`. The command creates a fresh `cpu-<runId>` report
directory containing raw `.cpuprofile` files, hashes, original timestamps, actual
sample deltas and sampled self-frame counts. Inspector start completes before the
request timer; stop/drain and evidence persistence follow request settlement and
precede verification. Setup and seeding remain outside the profile. Failure
evidence retains the primary request failure alongside profile/cleanup failures.
Reports explicitly mark `cpu-diagnostic` and exclude quiet acceptance.

The requested 100 microsecond interval differs from the observed sampling
interval. Raw startup, idle and GC observations remain intact. Inclusive stacks
overlap; profile spans and SQL waits cannot establish exclusive CPU by
subtraction. Profiling observes the local Node isolate and perturbs timing, so it
does not prove PostgreSQL CPU cost or satisfy quiet latency gates.

## What is measured

- `payload-create`: native Payload create through the preference-enabled CMS
  host, with committed readback and cleanup outside the request timer.
- `medusa-workflow`: the actual Product/Pricing/Link/Tag launch workflow through
  the independently settling Flarex workflow host.
- `mixed-product`: Application mutation plus Product update/read operations,
  including anchor admission, the pending graph, OCC and final publication.
- `mixed-payload`: the same mixed graph plus Payload create/read/update hooks.
- `mixed-workflow`: Application, Product/Pricing/Link/Tag workflow and Payload
  under the existing mixed outer owner.

The extended matrix adds these named workloads:

| Selection | Additional scenarios |
| --- | --- |
| Product | `product-create`, `product-create-graph`, `product-update`, `product-replace-images`, `product-delete`, `product-soft-delete`, `product-restore` |
| Payload scalar | `payload-update`, `payload-delete`, `payload-find-by-id`, `payload-find`, `payload-count`, `payload-replay` |
| Payload relations | `payload-populate-one`, `payload-populate-many`, `payload-replace-many`, `payload-reverse-join` |
| Mixed | `application-only`, `mixed-application-payload`, `mixed-repeated-product` |

That is 25 flows: seven native Product operations, eleven Payload operations
(including the historical create), six finite Application/mixed graphs and one
independently settling native launch workflow. Product creation measures owned
options/values/variants/images; image replacement retains, removes and creates
images. Hard delete, soft delete and restore have separate native lifecycle
paths. Reads/replay assert no additional commit; mutations assert real settlement.

`--size small|typical` chooses fixed representative cardinality, reported per
flow. Product graphs have two/eight images and one/four variants; relation
many/join graphs have two/eight targets; repeated Product writes run two/four
times. Scalar operations, optional-one relations and historical graphs keep
their existing shapes. Typical is not a scaling or arbitrary-framework proof.

Application-only and Application/Payload reuse the current finite fixture's
installed Product source envelope and untimed Product seeds. They measure the
selected business graph through complete entry/execution/freeze/publication;
they do not establish minimal-source admission cost. Relationship flows use the
fixed fresh-install self-relation/join profiles, including their default fields
and joins. Mixed create/delete/relationship capabilities, Inventory/Stock
Location, arbitrary Payload capabilities, contention and recovery timings remain
outside this matrix. Existing standalone read/native comparisons retain their
own business graphs and acceptance gates.

Product flows share one constructed native host within the command. Scalar
Payload flows share one runtime, and the two many-relation demands share their
fixed runtime. Other profiles retain their own preparations. Families release
after their last selected flow, with remaining resources closed at suite exit.
Every command provisions its own isolated fixture; no across-command state is
retained. Each flow runs fresh seeds and keys; durable history from earlier
family members remains until fixture disposal, so a family series and a fresh
single-flow command have different preparation/history envelopes.

Preparation is reused only within this bounded lifetime. Every
request receives fresh request/attempt state; authority checks and commits are
not cached or replaced by a test-wide rollback. Reports separate request samples
from setup, seeding, verification and cleanup, and include overall runner cost.
SQL diagnostics count observed client dispatches, not nested PostgreSQL statements
or the standalone historical Payload benchmark's `pg_stat_statements` metric.
Reports identify size, workload, family reuse and shared cleanup. `loadMs` is
null because dynamic import and construction are included in `prepareMs`;
reused construction is reported once. `command.json` includes total wall time,
while `families.json` records final shutdown success/failure. Fixture speed and
request speed are separate measurements.

## Host integration and ownership

The direct driver is a trusted test runner at the portable execution boundary.
It does not prove Worker isolation, deterministic globals, service-binding
transport or hosted cancellation. Backend Worker integration tests retain their
explicit host adapter and consume the shared scenario assembly. Full historical
benchmark reports remain evidence of their original execution boundary.

Framework behavior stays in its adapter, database mechanics in persistence, and
mixed composition in executor test support. No production dependency on Payload
or Medusa is added to executor or persistence. See the
[approved harness preflight](../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md)
for replacement and completion gates, including the owner's authorized follow-up
to correct the reproduced mixed admission failures and measured harness costs.
The [measurement expansion preflight](../../../../roadmaps/mixed-mutation-core/25-executor-measurement-expansion-preflight.md)
owns this expanded inventory and fast iteration contract.
