# Native Order foundation and archive workflow

## Status and authority

Status: implemented private foundation and finite archive profile for zero to
four raw existing Order IDs. The full native model/service closure, complete
DTOs, genuine retained inverse, replay, refusal and rollback branches are
supported on PGlite and ordinary-role PostgreSQL. The approved serial-value
preservation, shared non-null ordered predicates and native primitive
status-preimage correction are implemented. The shared empty-object default
capability is a required predecessor. Cart/Tax and Payment workflows retain
their independent owners and activation gates.

The reference is Medusa 2.13.4, fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Accepted shared logical storage, package
boundaries and the existing atomic workflow/transaction owners apply. Postgres
owns committed state, facts and durable outcomes. Only the trusted outer owner
settles; the Order participant receives no raw SQL or settlement capability.

## Connected scope

The selected native root is
`packages/core/core-flows/src/order/workflows/archive-orders.ts`. It constructs
`order.archived` messages from the original requested IDs, invokes the event
step before `archiveOrdersStep`, and returns that step's Order DTO array.

The step calls genuine `OrderModuleService.archive(orderIds)`. Its protected
archive method lists active Orders, permits completed, canceled and draft
statuses, mutates the selected returned objects to archived, and asks the
native internal Order service to update the original requested IDs. Preserve
the original error wording, empty/missing/duplicate IDs, selection/result order,
timestamps, module events and workflow event order; characterize these before
admission. Do not fabricate success for missing rows or replace native guards.

The native read uses no selected total fields, so it requests neither totals nor
Cart/Tax dependencies. The genuine Order service, its full model/type closure,
formatting and native persistence decorators remain framework owned. The first
adapter profile must admit only the necessary root reads/status writes and
retained inverse. Order creation, display-ID generation, line-item/shipping
mutations, payments, fulfillment, returns, claims, exchanges, public APIs and
hosted activation remain separate capabilities.

## Identified admission gates

### Native empty JSON defaults

The complete native Order model closure includes
`OrderChangeAction.details: model.json().default({})`. Although archive never
writes that table, its original default belongs to the installed schema and must
remain intact. The original shared compiled-DML decoder refuses this default.
Order therefore depends on the implemented shared `emptyJsonObject`
schema/default capability, independently owned and validated by the Payment
integration. An exact candidate that excludes that owner correction refuses the
full native metadata; successful execution in a combined checkout does not
remove this dependency. Preserve the native field and its default through the
shared owner. This dependency grants no OrderChangeAction mutation capability.

### Native archive compensation

The original `archiveOrdersStep` derives its retained `{ id, status }[]` from the
returned archived Orders. `OrderModuleService.archive_` already assigned
`OrderStatus.ARCHIVED` to those values. Its inverse calls `updateOrders` with
archived statuses; the source does not retain the prior completed/canceled/draft
statuses. An executable original-source witness must establish forward,
retained-inverse and late-parent behavior before selecting a disposition.

The original native service, step and SDK cancellation confirm that completed,
canceled and draft inputs all receive archived statuses in the forward call
and again in the retained inverse. This fixed-port witness establishes the
native payload contract, not stored database behavior.

The owner approved a correction in the promoted native workflow step: list
`id,status`, capture primitive preimages before archive, and pass those values
to the unchanged genuine `updateOrders` inverse. The frozen snapshot remains
unchanged and the source guard checks the explicit fork correction separately.
Whole-root rollback does not establish genuine native compensation. The bounded
atomic root must prove its actual retained callbacks against both drivers;
standalone concurrent native workflows remain outside this admission.

### Native serial columns

The native Order model declares `display_id: model.autoincrement()`.
`AutoIncrementProperty` reports DML type `serial`, and the native DML compiler
preserves that type. The shared Medusa compiled-schema decoder and
`SchemaColumn` union originally excluded `serial`, refusing complete genuine
Order DML before logical schema preparation.

Do not delete display IDs, coerce serial to ordinary number/text in the Order
adapter, replace the native model, or seed around the schema admission failure.
The correct owner is shared DML schema admission/lowering, with the shared
logical schema/storage owner responsible for any generated-value semantics.
A focused correction must state whether it supports preserving existing serial
values during archive only or also allocation, the exact integer/range/default
contract, unsupported-write refusal and implications for other consumers.
Generation and sequence/identity lifecycle require their own explicit scope.
The owner approved preservation-only serial support: signed int32 values with
no generated default/allocator, complete and selected-row validation, and no
Order creation/upsert/display-ID mutation grant. The original full-native
schema refusal witness is retained independently. This approval does not admit
arbitrary additional DML or query features.

### Native non-null partial indexes

After serial decoding, complete native metadata reaches 34 non-unique indexes
whose predicates require `IS NOT NULL`. The distinct forms are
`deleted_at IS NOT NULL`, `claim_id IS NOT NULL AND deleted_at IS NULL`,
`exchange_id IS NOT NULL AND deleted_at IS NULL`,
`return_id IS NOT NULL AND deleted_at IS NULL`, and
`deleted_at IS NULL AND product_type_id IS NOT NULL`.
The original checked DML predicate grammar and shared relational index predicate
union refused these forms. Dropping these native indexes or replacing their
predicates in the Order adapter is not an acceptable admission path.

The shared correction adds explicit `isNotNull` and
`isNullAndNotNull` predicates to the existing schema/canonicalization, logical
requirements, ordered-index membership and read-eligibility owners. Normalize
the two native conjunction orders to one semantic contract while preserving
the original DML spelling in source metadata. A missing document path is not
`IS NOT NULL`; false, zero and the empty string are non-null values. Native
unique indexes do not need these predicates; keep unsupported unique/physical
profiles explicitly refused until their own connected proofs exist. This is
a bounded predicate capability, not a SQL parser or a new index engine.

Preserve the full-native metadata refusal and require neutral plus Order
PGlite/ordinary-role PostgreSQL witnesses for index membership, build/readiness,
status updates and replay. The owner approved this additional shared correction;
its connected generic owners, additive catalog migration and complete native
metadata preservation are implemented within this bounded profile.

## Native presentation and event profile

Original native ordinary-role PostgreSQL characterization uses genuine
`createOrders` generation, the full 23-model schema, native repositories/internal
services and the unchanged full archive root. It establishes missing/invalid/
duplicate/empty behavior and the original inverse defect independently of the
adapter. A separate native SDK wrapper executes the exact approved corrected
step and restores the original heterogeneous statuses.

Archive returns the earlier selected DTO, with its pre-write `updated_at`;
persisted rows advance that timestamp. Default owning Address references need no
population: a non-null FK returns both the scalar FK and `{ id }` relation, even
for a soft-deleted Address; null FKs are omitted while relation fields are null.
The retained status inverse returns fresh write timestamps with that same
reference shape. Validate complete stored rows before translating this native
presentation, and compare immediate and cold results separately.

The selected persistence mutation contract follows the pinned portable Drizzle
repository: a supplied status patch still advances `updated_at` and emits
`order.order.updated` when that status already matches. A genuine retained
inverse invoked as a new operation therefore writes again; replaying its same
request key returns the retained outcome without another invocation. Native
PostgreSQL/MikroORM instead dirty-checks an equal status into a no-op. These are
separate characterized native lanes; this profile does not claim the latter's
no-op behavior. Repeated SDK cancellation that skips an already-run callback is
also distinct from invoking the genuine inverse as a new operation.

Immediate and retained workflow outputs use the same complete DML-derived DTO
decoder, including signed serial values and consistent owning Address references.
Committed result replay does not rerun Order methods or weaken that decoder.

This private profile uses the existing accepted atomic event-capture contract in
`workflow-foundations/07-durable-workflow-events.md`: preserve observed emission
and source ordinals and publish only with the one committed result. Native
invocation queues `order.archived` for the raw requested IDs before emitting
actual module update messages. Its original subscriber delivery releases those
grouped workflow events after module messages. The atomic profile records the
native invocation order, and does not implement that separate after-commit
group-release state machine or claim native subscriber-delivery timing parity.
Hosted delivery remains outside this slice.

## Validation and ownership

Use source-authenticated original native characterization and genuine service/
workflow execution; test harnesses must not implement Order business behavior.
Compare immediate DTOs, cold state, mutations and ordered events, including
retained callbacks and late failures. Schema/storage/transaction claims require
separate PGlite and ordinary-role PostgreSQL evidence. Bounded acceptance does
not establish general Order compatibility or production activation.

Use pingdotgg `tsc-rs` for this slice's typechecks as requested. Do not invoke
package scripts that dispatch the TypeScript 7 native compiler.

Work in the existing shared checkout. New Order module/workflow/fixture/guard
files belong to this slice; preserve existing Cart, Tax, Payload and persistence
changes. Coordinate additive shared export, package, source-manifest and guard
edits with the owning chat, and stage only this slice's exact paths/hunks.
