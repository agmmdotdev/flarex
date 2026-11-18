# Native Delete Order Change

## Status and scope

Implemented private bounded support. Native behavior is characterized on SQLite
and ordinary PostgreSQL. The private `flarex-order-change-deletion` /
`order.changeDeletion` profile implements `deleteOrderChangeWorkflow` over zero to
four raw existing Change IDs and at most eight Actions in the complete selected
historical closure. Duplicate, empty and missing IDs remain raw requested
positions. Scalar IDs and inputs beyond these bounds are outside this profile.
The full 23-model Order definition remains installed; construction grants no
other Order, Payment, Claim, Return or Exchange operation authority.

## Native contract and compensation

Pinned Medusa fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` owns the
workflow, retained `deleteOrderChangesStep`, generated Order service lifecycle
and Change-to-Action cascade. The root returns void. Its step calls
`softDeleteOrderChanges(data.ids)`, returns the native cascade result map and
retains the raw requested IDs. The inverse calls `restoreOrderChanges(ids)`
whenever the retained array is present, including an empty array.

The native joiner configuration maps Change roots to `order_change_id` IDs but
does not register Action linkable keys. Its result therefore retains the
unmapped `OrderChangeAction` row array. The portable profile decodes complete
Action rows from checked DML and authenticates their full postimages. Native
PostgreSQL witnesses instead return projected Action objects; complete portable
rows do not establish equality with that provider's projection.

Native restoration is not a preimage restore: it can revive a previously
deleted requested Change that forward deletion skipped, and it restores all
historical Actions associated with selected roots. Forward deletion likewise
rewrites historical Action deletion timestamps. This preserves the native
grammar already admitted by [Store deletion](./123-native-store-delete-workflow.md).
Whole-root failure rollback separately preserves the complete initial snapshot.
No exact-undo correction, delayed compensation or durable inverse capability is
introduced by this slice.

The selected presentation profile follows native PostgreSQL/Mikro eligibility.
Its required `Change.order` relation participates in the default active-parent
filter during forward deletion. Native restoration uses `withDeleted: true`
and accepts historical owning Orders. The pinned Drizzle implementation instead
updates Change roots directly, without forward parent filtering. Preserve and
label these native lane differences in comparison witnesses; do not claim
universal raw native equivalence.

This composes the existing [Order Change update profile](./order-change-update-workflow.md):
PostgreSQL required-parent eligibility with the selected portable mutation and
event contracts. It does not introduce general PostgreSQL or Drizzle provider
parity.

The persistence lifecycle and event profile reuses the existing
[Store lifecycle](./123-native-store-delete-workflow.md) and
[shared mutation dispatch](./47-medusa-shared-persistence-adapter.md#implemented-shared-mutation-dispatch-boundary)
contracts. Pinned Drizzle announces every selected cascaded deletion as deleted,
including historical Actions, and uses conventional restored dispatch without a
registered internal-service subscriber. The private profile preserves that event
grammar. Shared managed restoration leaves already-active rows unchanged while
retaining this conventional restored notification.

Native PostgreSQL/Mikro instead classifies a rewritten historical Action as
updated. Its generated internal restore method does not register the mutation
subscriber, and the standalone witness restores rows without emitting module
messages. Repeated restoration leaves its physical state unchanged; native
Drizzle writes again. These are separately characterized provider behaviors,
not evidence that all provider hooks, write counts or event streams coincide.
No native hook or publication correction is introduced by this profile.

Pinned delete integration tests contain a scalar `ids` example and a rollback
example with an `id` key. Their source provenance does not prove correct-array
execution or the retained inverse. New witnesses must execute the genuine
callbacks with `{ ids: [...] }` and inspect actual full rows and events.

## Owners and implementation boundary

Checked Order DML and existing Change contracts own full rows and references.
The deletion profile checks the exact Action FK/cascade and decodes every
selected Change and Action field before applying a managed transition. It
reuses the shared Medusa lifecycle planner, scalar bridge, module event bus,
complete graph receipt correlator and queued workflow host. Native service
construction and lifecycle result mapping remain native-owned.

Complete Action history uses the existing unconditional FK reverse access
derived from `order_change_id`. Native active-only partial indexes are not
substitutes for this access. No new schema, migration, raw SQL, transaction
lifetime or independent settlement mechanism is proposed. Unsupported closure
size or missing access must refuse before mutation.

The receipt policy binds raw IDs, forward parent eligibility, each complete
root/parent/Action read, selected graph membership, managed transitions, full
mutation preimages/results, native cascade maps and ordered native module
events. Only `order.order-change.deleted/restored` and
`order.order-change-action.deleted/restored` are admitted. The root emits no
additional workflow event and performs no graph query or remote effect.

Storage may observe an owning Order anchor before applying the active-parent
residual predicate. Historical anchor observations remain authenticated while
the Order read's matched counts and forward eligibility include only active
parents. Restoration performs no per-call parent eligibility read.

The two promoted native modules retain their callback bodies. Adaptations are
portable/direct imports, the established transaction-covered compensation
declaration, erased void authoring annotation and JSDoc whitespace transport.
No native Order class, Types or generated artifact change is required.

Payment's physical finance compensator and its Change/Action creation paths
remain separate. Shared policy, package-export and promotion-manifest edits
must preserve other sessions' changes in the shared checkout.

## Admission gates

Native SQLite and ordinary PostgreSQL witnesses must characterize active and
historical roots, Actions and parents; raw IDs, native maps and events;
retained and repeated inverse; and no creation of missing rows. Adapter tests
must separately cover PGlite and ordinary PostgreSQL, full business-row
preservation, historical closure bounds, parent eligibility, replay, scope,
sticky refusal, escaped methods and late parent rollback. Fixed receipt
transcripts must reject omitted descendants, changed business fields, incorrect
read membership/count/order, forged observations, wrong transitions/maps and
unadmitted events. Ping tsc-rs semantic checks, exact native source/promotion
guards, portability and both required reviews precede private admission.
Public/hosted activation, scale and other Order workflows remain outside scope.
