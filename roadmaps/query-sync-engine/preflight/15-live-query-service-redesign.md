# Live-Query Service Redesign Preflight

## Status And Approval Boundary

**Accepted documentation decision; runtime implementation not authorized by this
record.** The owner asked to record the challenged replacement design and open a
docs-only PR. The [design note](../../../design-notes/runtime-agnostic-query-sync-engine.md)
owns the architecture; the [roadmap](../README.md) owns current sequencing.

This record replaces conflicting unfinished directions in preflights 00-14.
Those files remain historical baseline evidence. Their implemented kernels,
planners, codecs, tests and adapters are not relabeled as the new service, and
completed work is not retroactively failed. No code, DDL, dependency, exported
API, route, live caller, data conversion or reset is changed here.

## Why Change The Contract

The developer needs ordinary queries with automatic subscription on reactive
use, not a second schema or `defineSync` surface. The framework must be testable
and benchmarkable without FlarexDB. Existing private separation is useful but
exposing planners and a Flarex-bound adapter does not provide a complete service.

Current evidence motivating the redesign includes:

- `packages/query-sync/package.json`: private internal/testing subpaths and only
  Effect plus a dependency-leaf utility package as runtime dependencies.
- `packages/query-sync/src/transition-plan/CompleteQueryEvaluation.ts`: current
  completion requires refresh at the applied cursor and reevaluation after
  relevant intervening changes. The fixed-target replacement is a behavioral
  change, not a rename or permission to remove checks in isolation.
- `packages/query-sync/src/transition-plan/ClaimPublication.ts`: the current
  scope lifecycle handles an in-flight item before new pending work, including
  blocked settlement. The UI successor must isolate unrelated sessions.
- `packages/flarex-backend/src/deploymentSync/Store.ts` and
  `StorageContractGeneration4.ts`: real operation-scoped SQLite state currently
  composed with Flarex binding and the old publication lifecycle.
- [FX02 query evidence](./14-qsync-fx02-c-application-query-evidence.md): the
  current descriptor's argument/identity digests are insufficient to rerun after
  restart, and the hosted invocation/backend contract boundary needs attention.
- `packages/query-sync/src/testing/ReferenceModel.ts`: delegation to production
  operations is useful agreement evidence, not an independent oracle by itself.

These are source-inspection findings and design risks, not newly executed
runtime tests or measured performance gains in this PR.

## Accepted Outcome

A narrow versioned live-query service over a transactional source. It owns query
tracking and portable session query sets, uses fixed snapshot targets, retains
bounded versioned results, and guarantees explicit recovery to a valid state.
The bridge supplies tracked authoritative execution and changes; the core does
not own subscriber state. Platform placement and method/table counts remain
implementation choices.

Preserve canonical identity, namespace/authorization isolation, accurate source
positions, no missed changes, stale-work fencing, semantic atomicity, fair bounds
and explicit uncertainty/reset behavior. A result valid at a fixed target is not
rejected only because later data commits exist; those commits remain pending.
Newly observed revocation or definition fences still prevent unsafe old delivery.

## Breaking Contracts And Cutover Inventory

| Contract to change | Reason and affected consumers | Cutover and proof |
| --- | --- | --- |
| Moving-latest evaluation/completion and refresh evidence | Can chase a changing target; affects planner, evaluator, coordinator, adapter and tests | Replace as one fixed-target protocol after source feasibility; preserve post-target dirty changes and stale-attempt rejection |
| Independent per-query delivery as sufficient UI state | Does not prove consistent client query sets; affects session/client/gateway and result retention | Version session membership, target and reset/auth generations; atomic apply-then-checkpoint and bounded historical result reuse |
| Mandatory exact scope-wide publication attempt workflow | UI recovery needs valid state, not every intermediate append; affects publication planners, storage and publisher | Prove notification reconciliation/reset/backpressure first, then retire the default old path; preserve any named real external obligation |
| Flarex-bound SQLite construction as the only durable implementation | Prevents testing the actual adapter independently of backend bindings | Extract generic semantic SQL/storage contract plus local host; keep Flarex auth and Cloudflare transaction bridge outside |
| Digest-only query descriptor as sufficient rerun input | Does not reconstruct arguments or current authority; affects registration/evaluator | Bounded sync-owned execution material or durable resolver with privacy, leases, reauthorization and atomic registration/cleanup |
| Prototype database-core subscription/delivery/connection registry ownership | Bakes subscriber lifecycle into persistence core; affects legacy callers/tables | Inventory consumers/data, cut over target-only, remove displaced paths; preserve database snapshot/feed/outcome authority |
| Backend-host ownership of neutral invocation contracts | Can create import cycles; affects invocation/bridge/host package direction | Move genuine neutral contracts to an existing suitable lower owner; no wrapper to retain the cycle |
| Client mutation completion and optimistic removal | Must distinguish committed writes from session visibility | Carry authoritative commit position, coordinate active-session barrier, prove post-commit timeout/reconnect without unsafe mutation replay |

These are accepted breaks to plan, not a blanket migration or data-deletion
permission. There is no silent data deletion or reinterpretation of old bytes.
Before each runtime slice, name exact symbols, formats, callers and
stored environments. Preserve supported durable obligations explicitly; do not
keep speculative compatibility wrappers, dual readers/writers or fallback engines.

## First Implementation Preflight: LQ-S1

The next implementation proposal is one bounded source/service-contract vertical
with two tracks that challenge each other:

**Standalone track:** small synthetic transactional source with actual tracked
queries and certified fixed snapshots; an independent expected-result oracle;
minimal service/session contract scenarios. The source is a test fixture, not a
second production database. Keep production algorithm calls out of the independent
expected-value calculation.

**Early Flarex track:** one ordinary query and mutation proving how the current
executor supplies target snapshots, complete dependencies, authoritative changes,
retention and authorization evidence. Reuse the existing execution/source owners.
Do not fake a requested target with an arbitrary current read or hold a physical
transaction over untrusted/remote execution.

Before coding, freeze target acquisition and lifetime, history-loss/error policy,
execution material authority, snapshot/change correlation, package ownership and
limits. A missing database capability is a core-owner correction with an explicit
proposal; it is not an adapter workaround or a reason to weaken standalone tests.

S1 does not require production client routing, whole-framework integration,
public adapter compatibility, sharding, a new transport, unrelated core schema
redesign or removal of current state. Later S2-S4 complete query tracking,
sessions and the real independently runnable state adapter; F1 integrates the
host; C1 switches actual callers and retires displaced code.

## Required Exit Proofs Across The Redesign

| Family | Decisive witness |
| --- | --- |
| Snapshot safety | Multiple queries are all valid at the emitted target; a newer result is not silently substituted for an older target |
| Progress | Continuous relevant and unrelated writes with fair admitted capacity do not force an infinite moving-target rerun |
| Handoff | A change during initial execution or dependency-set replacement cannot disappear when completion installs |
| Session lifecycle | Shared interest, removal, expiry, rapid argument/query-set changes and stale async work are fenced |
| Authorization | Revocation/expiry with buffered frames and reconnect blocks old access after the defined observation point |
| Mutation visibility | Committed position reaches the active session before normal optimistic removal; failed sync does not imply write rollback |
| Recovery | Crash before/after state settlement, lost wake before queued results, lost send/ack and actor-generation loss reconcile or explicitly reset |
| Persistence | The actual local SQLite implementation reopens and rolls back correctly, with selective access and limit/plus-one tests |
| Backpressure | Slow query/client, retained-history expiry and scope overload have visible bounded policies and protect unrelated sessions |
| Independence | Whole service, actual local state adapter and loopback protocol run without FlarexDB/Postgres/Cloudflare or credentials |
| Real source/host | Ordinary-role Postgres and real Cloudflare lanes prove their respective contracts without claiming local tests establish deployment behavior |

Benchmark engine CPU/allocations, dependency matching, reevaluations, state I/O,
version retention, fan-out and recovery separately from evaluator/transport cost.
Grow unrelated dependencies while keeping affected work fixed. Do not claim a
full-store audit is bounded merely because SQL returns at most one row.

## Rejected Alternatives

- Add an extra developer sync schema/manifest: duplicates ordinary query intent.
- Build a universal adapter framework for arbitrary callbacks/APIs: cannot promise
  source consistency without observable transactional guarantees.
- Delete commit/history evidence to remove coupling: loses source recovery.
- Keep exact attempt/history machinery solely because current tests exercise it:
  freezes an implementation rather than the agreed product guarantees.
- Remove all persistence and rely on live sockets: hides restart/loss failures.
- Keep only latest per-query results and call the session consistent: mixes targets.
- Finish a synthetic-only framework before checking Flarex: may freeze an
  impractical source contract.
- Shard or add cache/collection/stream actors before measurement: increases
  coordination without proving the first workload.

## Documentation Validation And Non-Claims

The docs PR must reconcile product, lifecycle, host, proof and adoption owners;
mark historical conflicting gates held; distinguish current code from target;
validate changed-document links/structure; and show a documentation-only diff.
No runtime tests, production readiness, lower resource usage, removal of the
current scan, or proof of selected-target execution follows from that validation.
Implementation will use the repository's ordinary scoped review and test gates.
