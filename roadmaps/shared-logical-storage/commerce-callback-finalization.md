# Commerce Callback Finalization

## Status And Scope

Active: implemented in the shared commerce FIFO and command-context owners;
validation and broader activation remain separate gates. This domain owns
callback completion and queue cleanup, including borrowed native callbacks.
It does not own framework business validation, row-constraint ordering, failure
presentation, or transaction settlement.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md) controls
transaction authority and distinct execution profiles. Current behavior belongs
to the [FIFO](../../packages/persistence-postgres/src/frameworks/commerceTransaction/operations.ts),
[borrowed command context](../../packages/persistence-postgres/src/frameworks/commerceTransaction/context.ts),
[atomic root](../../packages/persistence-postgres/src/frameworks/atomicCommerce/execution.ts),
and [bounded lifetime](../../packages/persistence-postgres/src/execution/preparation/boundedRequestLifetime.ts).
The [execution architecture](../execution-architecture/README.md) owns the wider
host/participant boundaries. Tests constrain implementation; this note does not
supersede the accepted design.

## Current Architecture

Each queued command or borrowed context captures its callback's complete `Exit`
and finalizes its FIFO once before revoking the context. A callback can fail
outside a queued job, including during a native transaction flush. Finalization
retains that failure together with an earlier queue failure or an independent
escaped-work refusal. The bounded lifetime authenticates originating Reasons
when the failed callback and queue transport the same failure with annotations.

Known failed completion does not perform a new admission checkpoint against its
already-poisoned lifetime. Successful completion still checks pending work and
the live context. Queue release rejects pending jobs and interrupts and joins
its worker before the borrowed manager leaves its lifetime.

## Invariants And Trust Boundaries

- Retain complete typed failures, defects, interruptions and diagnostic
  annotations. Error identity alone cannot authenticate or deduplicate Causes.
- A swallowed queued failure cannot turn callback success into accepted success.
  Escaped active or queued work remains a refusal, even beside a body failure.
- New DAL calls, admissions and checkpoints retain their rollback-only,
  deadline, authority, overlap and resource checks.
- Only the trusted outer owner seals and settles the transaction. Its failure
  evidence, rollback-only refusal and publication authority remain unchanged.
- Promise transport and native presentation do not select a convenient leaf
  from a compound Cause or discard unknown failures.

## Decisions And Rationale

One exit-aware completion operation replaces separate success sealing and
failure resealing. Cleanup of an already-failed callback is not a new request
operation: adding a checkpoint refusal there would manufacture another failure
and obscure native presentation without improving the request's failure fence.
This distinction grants no recovery, commit or renewed execution authority.

## Convex Compatibility And Flarex Divergences

Application OCC retains its own execution profile. This private framework
callback boundary preserves the shared singular-settlement rule without adding
a developer-visible Convex API or treating independent calls as atomic.
The FIFO supports admitted native framework Promise callbacks; it does not
establish a universal transaction abstraction.

## Implemented Capabilities

The shared owner finalizes callback and queue outcomes once, preserves their
complete failure evidence, and retains the ordinary successful-completion
checkpoint. Focused obligations are expressed in
[callback finalization tests](../../packages/persistence-postgres/test/commerceOperationFinalization.test.ts),
[queue lifetime tests](../../packages/persistence-postgres/test/atomicCommerceOperations.test.ts),
and [native Promise Cause tests](../../packages/medusa-adapter/test/native-promise-cause.test.ts).
Their presence does not establish a passing validation run or full framework
compatibility.

## Known Gaps And Limitations

Worker release still uses `Scope.close` with a scoped fiber whose interrupt
finalizer waits for termination but discards the worker's terminal `Exit`.
Independent worker cleanup defects during forced shutdown may therefore remain
unreported. This correction does not solve that baseline limitation. A Cause
actually raised by release remains subject to Effect's compound finalization
semantics; joining alone does not prove complete worker-failure reporting.

## Target Direction

Keep callback completion, failure provenance and FIFO cleanup at the shared
owner, while adapters retain native business behavior and the outer owner
retains settlement. Any worker-shutdown correction must distinguish owned
cancellation from independent failures without broadly dropping interruption.

## Next Correctness Gates

- Verify failed flushes outside otherwise-successful queues, swallowed queue
  failures, annotated re-entry, compound causes, escaped work and single
  successful-completion checkpoint refusal through the real shared owners.
- Verify affected consumers on PGlite and ordinary-role PostgreSQL separately,
  preserving complete rollback, event suppression and trusted settlement.
- Characterize forced worker-finalizer failure and define its authenticated
  cancellation disposition before claiming complete cleanup-failure retention.
