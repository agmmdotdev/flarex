# Task Cutover And Complete Retirement

Status: **accepted migration direction; no runtime cutover or data reset yet**.
The [Task roadmap](../../roadmaps/task-system/README.md) owns current gates.

## Isolated Fork First

Create the new private engine package from adopted Trigger source. Prove the
connected lifecycle through Flarex logical storage and injected hosts while
existing callers remain on the current engine. Isolated fixtures have distinct
identities and installation state; no run is controlled by both engines.

The first deliverable is enqueue -> claim -> start -> heartbeat ->
complete/retry/cancel -> fresh-host recovery, including required wait/resume
paths for workflow consumers. A package scaffold, copied helpers or a wrapper
around legacy decisions is not that proof. Test original lifecycle assertions
against the actual adopted methods and intentional Flarex differences explicitly.

Do not expand the old engine as the destination. Necessary fixes and already
authorized consumer work remain independently scoped; preserve unrelated
working-tree changes and refresh the consumer inventory before cutover.

## Inventory By Responsibility

| Existing area | Disposition |
| --- | --- |
| `packages/durable-task/src/runAttempt/Layers/RunAttemptLifecycleLive.ts`, `Policy.ts` and aggregate-specific codecs/store choreography | Replace with adopted engine methods; migrate meaningful behavior/tests and delete displaced algorithms |
| Task-specific physical schema in `taskRuns.ts`, `taskCompute.ts`, workflow checkpoint schemas and related definitions | Move required records to logical schemas; remove the complete old Task-specific physical representation |
| Task discovery directories, scheduler ownership, repair checkpoints and dispatch/delivery bookkeeping | Move Task-owned state to platform/scope logical records; no physical exception for routing or repair |
| Application Task admission, reads, result/attempt/event queries, await and cancellation callers | Preserve admitted caller meaning; migrate to the new shared owner without a second public API |
| Trusted workflow bindings, continuations/checkpoints, commerce children, callback outcomes and event eligibility | Preserve authentic identities, replay and native behavior; move their Task authority and Task-owned state together |
| Existing queue, scheduler, supervisor, runtime and compute adapters | Reuse justified mechanics through new contracts; remove duplicate lifecycle/retry policy and old storage wiring |
| General core scope/catalog, transaction, commit, artifact and publication owners | Retain correct shared authority; inventory actual dependencies before removing Task-specific projections |

This table starts an inventory; it is not an exhaustive drop list. Inspect
physical table names, exports, migrations/journals, schema registration,
installation/readiness, reset/setup paths, guards, fixtures and live callers.
Task-owned data outside files named `task*` still belongs in the retirement.
Do not delete shared Application or commerce outcomes merely because Tasks use
them. Preserve existing behavior by moving assertions to the new owner.

## Development Data And Physical Schema Removal

The project is pre-production and selects full replacement. There is no default
requirement for indefinite old-format decoding, dual writes or a production
migration product. Inventory actual environments and choose explicit reset for
confirmed disposable development records. Name the database/schema/scope,
dependent records and reset effects before executing destructive operations.
Reset and rebaseline is the default for those confirmed disposable stores; do
not retain Task-only migration machinery for hypothetical future consumers.
If a real surviving record or external identity is discovered, account for it
explicitly rather than assuming it away or retaining an entire legacy engine.

After consumer cutover, retire every Task-specific physical table, constraint,
index and definition. Remove runtime registration, exports, fixtures, seeds and
setup code that recreate them. Reconcile the migration journal and bootstrap
path with the repository's reset/upgrade contract: a fresh supported install
and an explicitly retained upgrade path must both end with no Task-specific
physical objects. Historical migrations, if required for a named supported
upgrade, are history only and must reach a schema where those objects are gone;
otherwise clean them with the reset-based baseline. Do not blindly delete a
shared migration file containing unrelated changes.

Generic physical tables underpinning Flarex logical storage remain. Preserving
those is not retaining the old Task schema. A new dedicated physical Task table
under a different name would violate the target just as retaining an old one
would.

## Consumer Cutover

Prove an Application producer, a Payload operation/hook and an admitted Medusa
workflow through the same engine early. Business rollback must create no Task
obligation; committed enqueue intent must survive crash-before-dispatch;
duplicate publication must recover the same run or reject a conflicting replay.

Migrate a consumer's complete connected behavior, including task reads,
cancellation, delayed work, native workflow waits, checkpoints and child outcomes.
Do not move success while leaving failure/recovery on the old engine. Preserve
real external IDs and committed-child identities unless the concrete reset
disposition includes them. A bounded proof is not arbitrary workflow support.

Each activated cutover removes the displaced path for that capability. Temporary
old/new package coexistence during proof has a named unmigrated consumer and an
exit gate; it is not a permanent fallback. Final retirement removes the old
lifecycle and the entire Task-specific physical schema.

## Completion Evidence

- Actual adopted methods execute through the finite logical store, with used
  original tests and preserved current regressions. Provenance/licenses remain.
- Separate PGlite and ordinary-role PostgreSQL proofs cover atomic claims,
  capacity, scope/privacy, lock order, visibility, wait races, uncertain commits,
  bounded fan-out and clean installation/reset/retirement.
- Competing and stale workers, lost queue hints, unavailable transport, expired
  leases, duplicate completions, native cancellation/compensation and cold
  recovery preserve the designated owners and observable outcomes.
- Measure discovery/index work, contention and heartbeat amplification against
  explicit acceptance questions; logical storage is not automatically faster.
- Active fork bundles contain no Prisma/Redis/Redlock, product-only Trigger
  infrastructure or unintended host dependency. Runtime imports cannot reach
  the frozen reference or displaced custom algorithms.
- Supported final installations contain zero Task-specific physical tables;
  schema/setup/consumer scans find no live old representation or dual writes.
- Follow AGENTS.md for implementation checks, required read-only code reviews,
  scoped commits and cleanup. Public APIs and production activation are separate
  from private engine correctness.
