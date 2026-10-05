# Direct core performance measurements

## Active native-relative acceptance

The owner selects the [complete native business reference](../../../medusa-adapter/benchmarks/core-performance/native-business/README.md)
and [preflight 26's policy](../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
for ongoing optimization and final acceptance: at most 5 ms added median / 10 ms
added P95 once per complete matched root. Historical mixed absolute gates are
intermediate milestones. Native method probes retain diagnostic scope; extended
graphs need matching references. Final-source paired quiet runs and stable tails
remain required. The historical results below do not establish that acceptance.

These measurements use the [daily core runner](../../test/performance/README.md).
They execute actual Payload Local API, Medusa workflows and Flarex admission,
journal and publication owners directly in Node, without a Worker or HTTP hop.

## Current measured graph

The complete `pnpm perf:core --all --sql` command took **133.52 seconds**.
All five scenarios committed and passed their native persisted-result checks.

| Scenario | Quiet median | Diagnostic SQL | Transactions | Preparation | Scenario total |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Payload create](./latest/payload-create.json) | 93.72 ms | 134 | 9 | 5.02 s | 10.48 s |
| [Standalone Medusa workflow](./latest/medusa-workflow.json) | 303.85 ms | 301 | 13 | 18.57 s | 25.09 s |
| [Mixed Application + Product](./latest/mixed-product.json) | 418.35 ms | 523 | 49 | 16.14 s | 23.43 s |
| [Mixed + Payload](./latest/mixed-payload.json) | 556.77 ms | 541 | 50 | 24.71 s | 34.43 s |
| [Mixed + Medusa workflow + Payload](./latest/mixed-workflow.json) | 718.20 ms | 800 | 63 | 26.88 s | 38.96 s |

The [command receipt](./latest/command.json) includes runner startup and all
scenarios; its timer starts at the Node CLI entry, excluding the pnpm launcher.
Scenario totals include preparation, seeding, verification and cleanup. These
are different business graphs, not interchangeable framework/native comparisons.
The source snapshot is the final runtime in the commit introducing this ledger;
raw reports record the preceding HEAD and dirty state during measurement.
Only receipt report paths are normalized to relative paths for portability.

## Method and limits

Local PostgreSQL 18.3, Node 24.16.0, ordinary execution roles, with
`synchronous_commit`, `fsync` and `full_page_writes` enabled. Each scenario uses
one separately traced diagnostic request, one quiet warmup and three quiet timed
requests. Results include real settlement and native committed readback.
Provisioning, seeding, verification and cleanup are outside request latency but
inside reported command/scenario wall time. Three samples do not establish P95.

SQL counts are observed client statements, including transaction control, from
the first diagnostic request. They are not nested server statement counts or a
warmed SQL distribution. Source setup and test input are independent between
scenarios; module imports can be reused within the same matrix process.

The old backend benchmark uses a different sampling and host boundary. A shorter
daily command is not a measured production speedup. The earlier failing mixed
requests' partial SQL totals must not be compared with successfully committed
request totals as a regression or improvement.

## Findings

Both mixed Payload and mixed workflow failures were caused by a shared binding
observation that omitted the later source's bounded selected preparation. The
correction shares authenticated immutable structure with exact identity,
freshness, lifetime and budget checks; final full publication verification
preserves already retained preparation without charging or guarding it again.

Connected validation also exposed a finite-journal error-classification defect:
catchable pre-effect document validation discarded earlier accepted work. The
journal now recognizes only the exact validator rejection before staging, with
no accepted sequence/counter/cursor change; terminal failures still abort the
root. The direct and Worker transports retain their existing validation boundary.

Harness optimizations include selected module loading, cached module transforms,
parallel independent database provisioning, and native seed hosts retained for
one finite series. Each native seed remains three independently committed
framework calls. In a same-plan standalone workflow comparison, five-sample
seeding fell from about 12.2 seconds to 2.53 seconds and sample cleanup from
about 2.3 seconds to 0.60 seconds. End-to-end command observations were 69.1
seconds before and 31.1 seconds after; setup variability prevents attributing
that entire difference to host reuse. The [before](./setup-comparison/before.json)
and [after](./setup-comparison/after.json) reports retain their intermediate
source revisions and dirty state; their [before command](./setup-comparison/before-command.json)
and [after command](./setup-comparison/after-command.json) receipts retain total
wall time. These are within-session setup observations, not isolated production
latency or exact-commit regressions.

Cold readiness preparation remains substantial. The 31.1-second standalone
workflow run spent 9.00 seconds in index/unique-set building, 3.45 seconds in
logical admission, 1.99 seconds provisioning databases, and 3.93 seconds loading
modules. The selected 5–15-second command and sub-minute matrix targets are not
consistently met. Native request parity, standalone Application-only and
standalone read comparisons retain their separate acceptance gates.

The next setup investigation is an explicitly owned prepared-session lifetime
across batches, with source/schema invalidation. Production request work remains
in the query-required mixed-read and subsequent settlement roadmaps; this
harness does not close those performance goals.
