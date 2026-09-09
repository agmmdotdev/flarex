# Durable Workflow Events

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Establish when workflow-related event intent becomes publishable and how its
delivery recovers, using the existing publication foundation where compatible.

## Questions For Preflight

- Which events represent a committed command and which depend on workflow
  success, cancellation, or compensation?
- What does the pinned event-group contract require for release and discard?
- Which existing commit facts, outbox, and delivery mechanisms are appropriate,
  and which business-event contracts are still missing?
- How are event intent and its release condition durably correlated?
- What identity, ordering, duplicate-delivery, payload, and retention guarantees
  are required by the selected consumers?
- How are subscriber failure and lost delivery acknowledgements handled without
  changing an already-settled database outcome?

## Starting Sources

- [Framework publication](../flarexdb-framework-integration/04-transactions-and-commit-publication.md)
- [Shared publication and recovery](../flarexdb-framework-integration/preflight/36-shared-publication-and-request-recovery.md)
- [Current Product composition](../../packages/medusa-adapter/src/product-module.ts)
- [Pinned workflow event step](../../third_party/medusa/upstream/packages/core/core-flows/src/common/steps/emit-event.ts)

## Outcome To Establish

An event contract and owner boundary for the first workflow that needs it,
including failure and restart behavior. Do not assume existing wake-outbox
support or local callbacks already establish durable grouped business events.
Choose the storage and dispatch changes only after that comparison.
