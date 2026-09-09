# Local Graph Query

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Prepare useful local graph reads for workflows over admitted module entities
and relationships. Assess the existing shared reads and pinned Query behavior
before deciding whether extension or refactoring is necessary.

## Questions For Preflight

- Which entity names, aliases, fields, relations, filters, ordering, pagination,
  result shapes, and options are needed by the first consumers?
- What do the pinned portable and full Query implementations actually support?
- Which normalization, model metadata, service behavior, and read mechanics can
  be reused without bypassing domain semantics?
- How are prepared graph metadata and runtime scope/table authority separated?
- What consistency and pending-write visibility does one graph operation offer?
- What happens when a graph read is replayed as a workflow step: fresh data,
  a recorded result, or a separately declared policy?
- How are traversal, output size, query count, and unsupported paths bounded?

## Starting Sources

- [Shared adapter](../flarexdb-framework-integration/preflight/47-medusa-shared-persistence-adapter.md)
- [Checked query catalog](../../packages/medusa-adapter/src/query/catalog.ts) and
  [shared read execution](../../packages/medusa-adapter/src/query/read.ts)
- [Pinned portable Query](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts)
- [Relation and Link ownership](../flarexdb-framework-integration/05-relations-links-and-references.md)

## Outcome To Establish

A supported local graph query contract and a reuse/refactor inventory, with
Product's existing entities as the initial example. This topic can progress
independently of Task continuations. Stored Module Links, a universal query AST,
query.index, reactive subscriptions, and additional modules are not implied;
evaluate any such dependency explicitly.
