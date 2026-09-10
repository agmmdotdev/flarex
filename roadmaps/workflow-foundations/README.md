# Workflow Foundations

## Status And Scope

Status: the first [private atomic composition capability](./09-atomic-composition.md)
is implemented, validated and reviewed. The
[Local Graph Query capability](./06-local-graph-query.md) is also implemented,
validated and reviewed as a private facade over existing module reads. Other
topics retain their own proportional preflights. The connected
[native workflow preflight](./10-medusa-workflow-integration.md), including
[durable events](./07-durable-workflow-events.md), is ready for its execution
and persistence decision. Fork-source adaptation is authorized; the proposed
shared event contribution and migration are not yet implemented. This folder
does not select a universal API, package layout, or complete workflow architecture.

Prepare reusable native capabilities before full workflow integration. Native
contracts should serve multiple workflow domains. Product and Currency are
available consumers and validation examples; adding another commerce module is
outside the current direction.

## Current Sources Of Truth

- [Accepted Flarex design](../../design-notes/flarex-db-accepted-design.md) and
  [framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
  retain cross-domain authority.
- [Durable Task Engine](../durable-task-engine/README.md) owns existing Task
  lifecycle, persistence, scheduling, and execution contracts.
- [Shared transaction core](../shared-transaction-core/README.md) owns common
  transaction, publication, and recovery boundaries.
- [Framework integration](../flarexdb-framework-integration/README.md) and
  [Medusa adoption](../flarexdb-framework-integration/06-medusa-adoption.md)
  own framework admission and compatibility.
- [Pinned Medusa source](../../third_party/medusa/SOURCE.json) supplies the
  reference revision; each capability preflight must inspect its relevant code
  and tests alongside the current Flarex implementation.

This is a coordinating discussion folder. It does not supersede those owners or
turn a previously deferred capability into implemented behavior. Existing code,
schemas, and tests establish the current baseline; verify it at each preflight
instead of copying changing implementation inventories here.

## Direction And Boundaries

- Keep native execution concepts independent of Product and Medusa vocabulary.
- Reuse existing Task, transaction, query, and publication capabilities where
  their actual contracts fit. Identify concrete gaps before introducing owners.
- Keep workflow dependencies and business compensation policy distinct from
  execution ownership and database settlement.
- Preserve scope, execution authority, bounded resources, and explicit recovery
  behavior. Sharing infrastructure does not imply one universal transaction API.
- Determine compatibility and intentional differences from retained source and
  executable scenarios, rather than assuming either a full port or a rewrite.

## Topic Map

Atomic composition and Local Graph Query have approved, validated source-private
implementations. Topics 07 and 10 now have one connected implementation proposal;
their event/execution contract is pending approval. Other entries remain
**preflight pending**, with related findings linked where useful.
Numbers provide a reading order, not fixed commit boundaries or a requirement
to build every capability before the first useful integration.

| Topic | General purpose |
| --- | --- |
| [01 Execution identity and replay](./01-execution-identity-and-replay.md) | Establish how the same logical work is recognized across attempts. |
| [02 Durable operations and recovery](./02-durable-operations-and-recovery.md) | Retain progress and results and reconcile uncertain side effects. |
| [03 Continuations, waits, and signals](./03-continuations-waits-and-signals.md) | Suspend useful work and resume it without retaining execution resources. |
| [04 Cancellation and compensation](./04-cancellation-and-compensation.md) | Define stopping, cleanup, recovery, and terminal-result relationships. |
| [05 Task command integration](./05-task-command-integration.md) | Connect native Tasks to admitted command owners, including commerce. |
| [06 Local Graph Query](./06-local-graph-query.md) | Provide local graph reads through existing module and query boundaries. |
| [07 Durable workflow events](./07-durable-workflow-events.md) | Establish event intent, publication timing, and recoverable delivery. |
| [08 Resource coordination](./08-resource-coordination.md) | Assess coordination needs between different workflow executions. |
| [09 Atomic composition](./09-atomic-composition.md) | Private bounded composition across authentic commerce installations; native relational OCC remains a separate decision. |
| [10 Medusa workflow integration](./10-medusa-workflow-integration.md) | Connect a supported workflow surface to the proven foundations. |

The first foundation is a private Product/Currency command over the existing
shared transaction owner, including multiple commerce installations, pending
relation reads and one complete publication. Product and Currency are proof
consumers; core contracts contain no module-specific identities. The Local
Graph Query capability binds checked reads to this established context without
adding a Task, SQL transaction or query execution owner.

Native Task extensions are conditional on durable execution needs. General
relational OCC is conditional on a stronger mixed-mutation product promise or
a demonstrated execution need. Workflow events remain an actual dependency
of the proposed first original Medusa workflow. No execution mode may silently
change because a command exceeds its bounds. These remaining topics are not
implementation approval or a promise that every workflow is atomic.

## Working Through The Topics

For one coherent capability at a time:

1. Inspect its current owners, primary references, tests, and nearby work.
2. Discuss the need, alternatives, recommended scope, dependencies, and proof.
   Decide whether to reuse, extend, defer, or drop the proposed work. Related
   topics may share one preflight when they form a coherent capability.
3. Record the accepted contract and exact completion criteria in the relevant
   topic and owning domain. The general outline alone is not implementation
   approval; follow the repository's proportional preflight rules.
4. After approval, implement, validate, review as required, and complete that
   capability before moving to the next. Ordinary in-scope fixes remain part of
   that approval.
5. Reconcile the roadmap with the resulting durable truth. Include replacement
   and cleanup obligations when anything is displaced; Git owns chronology and
   test receipts.

The next recommended capability is the private
[Product-tag workflow integration](./10-medusa-workflow-integration.md), including
the selected SDK fork changes, bounded hook execution and
[durable event delivery](./07-durable-workflow-events.md). Local Graph Query
already supplies its pending-read dependency. These related topics are one
connected proof, not separate planner-only or event-mock completion gates.
