# Untraced native hot paths

Status **Implemented.** Flarex baseline `fdc7c65c4`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

No Convex mechanism changes; this is an Effect cost at the TypeScript owner. Pinned
Convex pays no per-call tracing cost on the equivalent Rust paths.

## Measured reason

A named `Effect.fn("Name")` allocates an `Error` for its stack frame on every call and
on every definition, and opens a span. One native Product create made 1,454 named
calls and 886 named definitions, about 8–9 ms of 62 ms CPU in the profile.

83 functions with at least five calls or five definitions per create now use
`Effect.fnUntraced` (generator bodies) or a plain function returning a lazy effect.
Functions below that threshold keep their names. After the change one create makes
355 named calls and 157 named definitions.

Kept traced regardless of count because tests or diagnostics read their spans:
`MedusaAdapter.withService`, `CommerceRepository.select`, `CommerceRepository.checked`,
`MedusaRead.execute`, `MedusaRead.window`, `CoreNativeScopeExclusion.beforeDeadline`,
`CoreNativeRelational.read`.

## Independent review

| Finding | Outcome |
| --- | --- |
| The managed-read test asserts no `CoreNativeRelational.read` span and became vacuous | Tracing restored on that function. |
| Low-count functions converted without evidence | Reverted; the threshold above applies. |
| `Effect.suspend` around already lazy effects | Removed where the reviewer named them. Wrappers around the transaction `run` helpers stay: harmless, and they keep the conversion mechanical. |
| Converted functions no longer emit spans or named stack frames | Accepted cost. Outer request, service and repository spans remain. |

## Measured outcome

Product create on ordinary-role PostgreSQL, one local host, no added latency. Medians
of five alternating rounds against a clean baseline clone, 128 operations each.

| Callers | CPU per create | Throughput | Median latency |
| --- | --- | --- | --- |
| 1 | 69.9 → 65.0 ms | 9.6 → 10.4 /s | 102 → 95 ms |
| 16 | 73.2 → 64.9 ms | 13.3 → 14.9 /s | 1,172 → 1,048 ms |

The host carried unrelated load, so absolute values are high; the pairing is the
evidence. Round trips did not change.

## Converted functions

Per Product create, before the change.

| Function | Calls | Definitions |
| --- | --- | --- |
| `CoreTransaction.nativeFind` | 82.8 | 33.8 |
| `CoreSchemaModel.getByState` | 89.7 | 1.0 |
| `CoreIndexSnapshot.rangeBatch` | 13.5 | 75.2 |
| `MedusaWorkflow.captureValue` | 75.0 | 0.0 |
| `CoreTransaction.insert` | 29.9 | 35.7 |
| `Commerce.checkedValue` | 48.1 | 0.0 |
| `MedusaWorkflow.resolve` | 42.3 | 4.8 |
| `CorePostgres.query` | 43.4 | 0.0 |
| `NativeCommerce.returnRows` | 15.4 | 27.0 |
| `NativeCommerce.write` | 15.4 | 27.0 |
| `CoreTransaction.delete` | 0.0 | 35.7 |
| `CoreTransaction.get` | 0.0 | 35.7 |
| `CoreTransaction.normalizeId` | 0.0 | 35.7 |
| `CoreTransaction.patch` | 0.0 | 35.7 |
| `CoreTransaction.replace` | 0.0 | 35.7 |
| `CorePostgres.read` | 35.6 | 0.0 |
| `CoreTransaction.enforceSchema` | 29.9 | 1.9 |
| `NativeCommerce.initializationBinding` | 31.0 | 0.0 |
| `CoreSchemaModel.checkStagedWrite` | 29.9 | 1.0 |
| `CoreSchemaModel.enforceDocument` | 29.9 | 1.0 |
| `CoreNativeActivity.prepareMutation` | 27.0 | 1.9 |
| `NativeCommerceActivity.read` | 21.2 | 7.8 |
| `CoreNativeForeignKeys.probe` | 27.9 | 1.0 |
| `NativeCommerceActivity.since` | 20.2 | 7.8 |
| `NativeCommerce.readRelated` | 0.0 | 27.0 |
| `CoreTransaction.nativeWriteRows` | 15.4 | 10.6 |
| `CoreTransaction.prefetchNativeSlots` | 23.1 | 1.9 |
| `MedusaWorkflow.node` | 19.2 | 4.8 |
| `CoreNativeRelational.inspectCohort` | 21.2 | 0.0 |
| `CoreQuery.captureIndexRange` | 19.2 | 0.0 |
| `CoreTransaction.nativePrepareDeleteClosure` | 7.7 | 10.6 |
| `CoreTransaction.prepareNativeRowBatch` | 15.4 | 1.9 |
| `MedusaAdapter.decodeExactNumeric` | 17.3 | 0.0 |
| `ProductEvents.capture` | 17.3 | 0.0 |
| `Workflow.moduleEvent` | 17.3 | 0.0 |
| `Workflow.selectModuleEvent` | 17.3 | 0.0 |
| `MedusaAdapter.populateTree` | 16.4 | 0.0 |
| `MedusaGraph.captureNode` | 11.6 | 1.9 |
| `AtomicCommerceNative.invoke` | 12.5 | 1.0 |
| `CoreNativeKeyProbe.capture` | 13.5 | 0.0 |
| `CoreTransaction.nativeFor` | 10.6 | 1.9 |
| `CoreTransaction.nativeRange` | 10.6 | 1.9 |
| `Commerce.withCommandContext` | 12.5 | 0.0 |
| `ScalarRepository.find` | 1.9 | 10.6 |
| `Workflow.validateModuleCall` | 12.5 | 0.0 |
| `ScalarRepository.create` | 1.0 | 10.6 |
| `LinkEvents.captureLogical` | 11.5 | 0.0 |
| `CoreTransaction.checkpointReferences` | 0.0 | 10.6 |
| `CoreTransaction.matchRelational` | 0.0 | 10.6 |
| `CoreTransaction.nativeAssertPendingDelete` | 0.0 | 10.6 |
| `CoreTransaction.nativeAssertProtectedReferenceGeneration` | 0.0 | 10.6 |
| `CoreTransaction.nativeDeleteRows` | 0.0 | 10.6 |
| `CoreTransaction.nativeFindPage` | 0.0 | 10.6 |
| `CoreTransaction.nativeGetMany` | 0.0 | 10.6 |
| `CoreTransaction.nativeIncomingReferences` | 0.0 | 10.6 |
| `CoreTransaction.nativeIsEmpty` | 0.0 | 10.6 |
| `CoreTransaction.nativeLifecycle` | 0.0 | 10.6 |
| `CoreTransaction.nativePendingDelete` | 0.0 | 10.6 |
| `CoreTransaction.nativeProtectedReferencePage` | 0.0 | 10.6 |
| `CoreTransaction.nativeReconstituteRows` | 0.0 | 10.6 |
| `CoreTransaction.nativeReferenceReplacementChanges` | 0.0 | 10.6 |
| `CoreTransaction.nativeReplaceReferenceSet` | 0.0 | 10.6 |
| `CoreTransaction.nativeReplayRows` | 0.0 | 10.6 |
| `CoreTransaction.planSetNullReferences` | 0.0 | 10.6 |
| `CoreTransaction.readRelated` | 0.0 | 10.6 |
| `MedusaAdapter.readRelationRows` | 10.6 | 0.0 |
| `MedusaAdapter.readRelation` | 10.6 | 0.0 |
| `CommerceEvents.created` | 3.9 | 6.7 |
| `CommerceEvents.invoke` | 3.9 | 6.7 |
| `CoreNativeRoot.native` | 8.7 | 1.0 |
| `CoreTransaction.captureObservation` | 7.7 | 1.9 |
| `CoreTransaction.nativeRemember` | 7.7 | 1.9 |
| `CoreTransaction.prepareNativeSetNull` | 7.7 | 1.9 |
| `MedusaAdapter.populateRelations` | 8.7 | 0.0 |
| `LinkRepository.find` | 1.9 | 5.8 |
| `LinkEvents.identifyLogical` | 7.7 | 0.0 |
| `CommerceEvents.cascades` | 0.0 | 6.7 |
| `CommerceEvents.dispatch` | 0.0 | 6.7 |
| `CommerceEvents.rows` | 0.0 | 6.7 |
| `CommerceModule.use` | 6.7 | 0.0 |
| `MedusaAdapter.projectExactNumericColumns` | 6.7 | 0.0 |
| `NativeCommerce.makeParticipant` | 5.8 | 0.0 |
| `InventoryQuantity.decodeRows` | 0.0 | 5.8 |
