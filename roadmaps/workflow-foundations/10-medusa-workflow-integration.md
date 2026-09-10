# Medusa Workflow Integration

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Connect a supported Medusa workflow surface to proven native execution and
command/query capabilities. Use Product and Currency as available consumers;
native contracts remain independent of those domains.

The [atomic composition foundation](./09-atomic-composition.md) now supplies
private multi-installation commands and transactional reads. The
[Local Graph Query proposal](./06-local-graph-query.md) builds on that context
and awaits implementation approval. An atomic workflow need not use a Task.
The first original Product-tag workflow still requires
hook and grouped-event semantics; the current local Product event buffer is
insufficient. Keep the event-free internal-service database proof distinct from
that later source-compatible workflow proof. Replacing only Medusa's engine
service does not replace the SDK's LocalWorkflow/orchestrator execution chain.

## Questions For Preflight

- Which Product-only workflow or composition of retained steps is a useful
  first proof, and which dependencies does it actually require?
- Which SDK, orchestration, Query, hook, event, and compensation semantics must
  remain compatible? Which intentional adaptations are justified?
- What selected source and test closure should be promoted from the pinned
  island, and what stays reference-only?
- How should workflow definitions, registries, runtime services, and persistence
  be bound to the correct application revision and scope?
- How do Medusa step decisions compose with native attempt, retry, wait,
  cancellation, and result ownership without competing lifecycle authorities?
- Which preceding topics are real prerequisites for this workflow, and which
  may remain deferred?
- What displaced code or infrastructure should be retired after the proof?

## Starting Sources

- [Medusa adoption](../flarexdb-framework-integration/06-medusa-adoption.md)
- [Pinned source identity](../../third_party/medusa/SOURCE.json)
- [Pinned workflow SDK](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts)
- [Pinned orchestration](../../third_party/medusa/upstream/packages/core/orchestration/src/workflow/workflow-manager.ts)
- [Task command integration](./05-task-command-integration.md) and
  [local Graph Query](./06-local-graph-query.md)

## Outcome To Establish

One bounded integration contract, a keep/port/adapt/remove inventory, and a
connected proof using retained Medusa behavior plus native failure/recovery
scenarios. Include restart, exact replay, required compensation, and any admitted
events or coordination. Preserve existing Product/Currency regressions.

The full create-products workflow has dependencies beyond the current two
modules; its name does not make it a Product-only proof. Full module bootstrap,
all core flows, distributed deployment, public APIs, and production activation
are separate decisions, not consequences of this roadmap.
