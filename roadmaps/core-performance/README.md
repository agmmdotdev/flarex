# Core Performance

Status: **the local standalone-read implementation and consumer cutover are
complete; performance tuning is paused at the owner's accepted measurements.**
The installation interlock, query-required preparation and independent direct
read capabilities are implemented. The full latency/scaling targets below remain
unproven; accepting current latency does not claim those targets were met.
The [execution architecture roadmap](../execution-architecture/README.md) owns
the connected organization and its remaining composition work.

## First Big Slice

[Standalone read execution and installation lifecycle](./standalone-read-redesign-preflight.md)
owns the executable scope, explicit mechanism changes, owner/caller migration,
performance budgets and correctness gates. Deliver together:

- Installation-owned structural verification, an enforced maintenance interlock
  and compact fresh transaction checks. Repeated role/catalog/function/trigger
  attestation is replaceable; live authorization and invalidation are not cached.
- Authenticated immutable preparation reused through an existing bounded host
  lifetime. Cold/miss work loads query-required metadata without revalidating the
  whole installation. Pooling and reconnect never imply stable session identity.
- Readiness derived from the actual normalized query and its required access
  paths, with no traversal of unrelated source tables/indexes/relations.
- Real native scalar and selected collection retrieval through the shared core,
  migrated affected standalone consumers, and removal of displaced read assembly.

The accepted amendment is in
[Prepared Execution Integrity](../../design-notes/flarex-db-accepted-design.md#selected-standalone-read-replacement).
The [target index](./orchestration-target-design.md) separates this first slice
from the deferred finite settlement proposal. The
[reassessment](./orchestration-simplification-preflight.md) records decisions and
rejected approaches. No additional generic research/approval loop is needed to
select this direction; implementation must establish the concrete writer and
transaction proofs specified by the first slice.

## Acceptance Is Complete Request Cost

The recorded standalone baseline is approximately 53 ms scalar and 48 ms
collection versus 1.54/1.65 ms native. Warm protocol observations retain 63/65
Flarex dispatches across three transactions versus one native query. The
[native ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#fresh-application-acceptance)
owns precise measurements, provenance and limits; these are not current hosted
performance measurements.

| Selected warm DB-adjacent gate, each measured native demand | Median | P95 |
| --- | ---: | ---: |
| Paired full-request Flarex overhead | <= 2 ms | <= 5 ms |
| Complete Flarex request | <= 5 ms | <= 10 ms |

These are engineering targets, not predictions. Count authentication, preparation,
necessary storage/history, output and cleanup; compute pairwise excess before
percentiles. The preflight defines cold/miss/reconnect, unrelated-schema growth,
relevant-demand and concurrency gates. Provisioning and installation cost remain
visible. A helper improvement or fewer dispatches cannot pass this slice.

The earlier standalone <400 ms / <10% regression guardrail remains historical
integration context, not this slice's acceptance. Existing
[mixed execution](../mixed-mutation-core/14-execution-redesign-roadmap.md) p50/p95
goals 100/200, 200/400 and 500/1,000 ms remain separate. The first read result does not
claim those mixed or hosted goals. Failed gates keep original evidence and
require an owner-level design correction, not looser thresholds.

## Current Runtime And Preserved Evidence

The implemented read-construction and fresh-acceptance changes remain the
baseline until connected cutover:

| Work | Disposition |
| --- | --- |
| [Checked reads](./01-checked-reads-preflight.md), [transport composition](./checked-reads/02-dispatch-composition-preflight.md) | Structural work delivered; it did not establish the requested complete latency. |
| [Read construction](./read-admission-construction-preflight.md), [fresh Application acceptance](./fresh-application-acceptance-preflight.md) | Delivered bounded improvements; current full-readiness/attestation contracts are explicitly replaced only for named callers by the selected first slice. |
| [Publication attribution](./02-publication-preflight.md) | Historical owner evidence retained; complete server matrix invalid/partial. |
| [Publication source proof](./publication-source-proof-preflight.md) | Reviewed candidate failed performance, remains unaccepted and separate; further correction experiment withdrawn. |
| [Initial request admission](./03-request-admission-preflight.md), [seal](./04-seal-verification-preflight.md) | Later finite/mutation components, inactive; they do not precede the new read slice. |
| [Host lifecycle](./05-host-lifecycle-preflight.md) | New pooling/compute/runtime-host lifecycle remains conditional; bounded metadata reuse under the existing host owner is included in the read slice. |

The clean committed documentation handoff excludes the staged failed publication
runtime candidate. Preserve its source and evidence separately; do not include
it in baseline claims or commit it with the redesign. Its accepted-design edits
belong to that candidate, not to this new integrity amendment. The benchmark
[handoff ledger](../../packages/flarex-backend/benchmarks/core-performance/publication-source-proof/README.md)
owns historical candidate disposition and withdrawn draft details.

The retained [aggregate-entry evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/aggregate-entry/README.md)
had 97 admission, 532 execution,
69 seal and 147 publication dispatches (845 total). These are historical counts,
not a current causal latency model, a minimum-work requirement, or the standalone
baseline. Preserve original evidence and do not sum overlapping phase percentiles.

## Delivery And Remaining Scope

The [execution checks and framework lifecycle direction](../mixed-mutation-core/22-execution-checks-and-framework-lifecycles-preflight.md)
connects the proved standalone mechanisms to the mixed foundation replacement.
Admission establishes current authority, readiness follows actual query demand,
and publication atomically records the accepted data/outcome/event intents.
Immutable preparation can be reused only under its proved lifetime/invalidation
contract. Framework hooks keep native semantics; external delivery follows
confirmed commit. Lowering check overhead is independent of broadening callback
retries or changing durable-seal recovery. Existing performance targets and the
active owner's clean handoff remain gates, not claims achieved by this direction.

Implement one connected path from installation/preparation through query-required
acceptance to complete native output. Internal dependency steps may be developed
and tested independently, but none closes the first slice without complete native
latency/scaling, affected consumer regression, both final reviews and cleanup.
Use focused PGlite and ordinary-role PostgreSQL; hosted/pooling claims require
their actual environment. One existing mixed integration milestone is required
for the shared lifecycle change, not after every helper adjustment.

Required guarantees remain Postgres authority, tenant/placement confinement,
snapshot and native behavior, fresh access/revocation, required readiness,
bounded resources, cancellation and one settlement owner. Current orchestration,
source breadth and structural-check frequency are not fixed invariants.
Do not hold SQL across untrusted callbacks or treat cached metadata as admission.

Subsequent selected work will extend proven primitives into actual Application
and mixed consumers, then examine finite freeze/settlement/recovery separately.
The [deferred finite proposal](./orchestration-target-design.md#deferred-finite-proposal)
remains a proposal and cannot impose its journal/claims on standalone reads.
Public developer APIs, broad framework expansion, general schema evolution,
new compute hosting and durable-data deletion remain outside this slice.

Architecture authority stays with the [accepted design](../../design-notes/flarex-db-accepted-design.md)
and [package boundaries](../16-package-boundaries.md). Framework semantics stay
with their native adapters; the shared core must own the integrity replacement.
