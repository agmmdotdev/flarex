# Mixed Product consumer construction

Status: **Selected Product-only consumer implemented; broader finite migration
and performance gates remain open.**

## Scope and challenge

Replace the actual `mixed-product` scenario selected by
`packages/executor/test/performance/support/mixed.ts`. Its Application insert,
native Product update/retrieve/list and Application patch must share one current
Core root. Preserve native Product input/output and event behavior, committed
readback and resource cleanup. Performance measurement remains paused under the
[resource investigation](../../../../roadmaps/shared-logical-storage/README.md#translated-core-consumer-acceptance).

Two independent readers inspected current construction and callers, accepted
direction and pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`, then
exchanged counterexamples. `transaction.rs` subtransactions and finalization and
`application_function_runner/mod.rs` SessionRequest lookup/write retain one
transaction and an atomically stored outcome. Existing
[private Worker context](../divergences/native-protected-worker-context.md) and
[durable event delivery](../divergences/native-durable-event-delivery.md)
differences cover sequential native/Application calls and logical event storage.
No new Core algorithm or native guarantee is selected.

## Replacement map

| Current responsibility | Keep, adapt or replace | Correctness boundary |
| --- | --- | --- |
| Finite/journal Product-only scenario construction | Replace its actual dispatch with current Core construction | One Application/native root, with no nested standalone Commerce transaction |
| Native Product commands, input translation and DTOs | Reuse executing native implementations | Complete returned values, pending update/retrieve/list visibility and committed readback |
| Commerce command execution and event capture | Extract/reuse the existing framework owner as a borrowed invocation without settlement | Selected opaque command tokens, captured input/output, sticky failure, drained work and events staged on the same root |
| Application invocation, request claims and recovery | Reuse `makeCoreNativeApplicationMutationPort` | Sole outer finalizer, same-key and reconstructed-owner replay without native body replay |
| Legacy finite receipt/retry/grant fixtures | Retain for their named conformance consumers | No fabricated old publication/receipt values in the Core scenario |

## Coordination and acceptance

Framework-owner work owns borrowed Commerce invocation and its existing caller
migration. Consumer work owns current mixed Product construction, actual scenario
selection and connected tests. Root integrates types, source inventories,
documentation, cleanup, database validation and both required read-only reviews.
Workers share this checkout and preserve the unrelated workspace configuration.

Prove paired PGlite and ordinary-role PostgreSQL behavior: complete mixed graph,
one committed Application/Product/event outcome, pending reads, rejection rollback,
caught failure, selected-command authority and same-key/cold replay without
reexecuting native callbacks. Preserve the original native assertions. Do not run
timing scenarios or infer a PostgreSQL timeout correction from passing tests.

The remaining `productPayload`, workflow, repeated/native-read instrumentation,
private reference and finite grant/retry/recovery callers retain their actual
legacy constructors until independently migrated. This slice neither retires the
whole `mixedMutationProductFixture.ts` closure nor the old Payload reference
factory. No named durable dataset is changed or reset.

## Focused checks

Use Oxc `tsrs` with
`packages/executor/test/performance/tsconfig.core-mixed-product.json`. The
correctness suite uses
`packages/executor/test/performance/vitest.core-mixed.config.ts`; select
`FLAREX_TEST_DRIVER=postgres` with separate ordinary/provisioning endpoints for
the real PostgreSQL lane. Its portable host-boundary guard remains active.
The parent performance typecheck also includes optional native-business
comparison dependencies and pinned builds, which must be provisioned separately.
Neither correctness execution nor setup observations resume performance work.
