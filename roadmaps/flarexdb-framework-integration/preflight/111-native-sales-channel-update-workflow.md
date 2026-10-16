# Native Sales Channel Update Workflow

## Status And Authority

Status: complete for the private bounded selector-update profile.
This follows the bounded native Sales Channel creation admission. Chunked File
import and Product export remain deferred.

Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 pinned at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The continuing integration goal
authorizes necessary correct-owner changes, validation, review and a scoped
commit. The pinned source island remains read-only.

## Native Closure And Behavior

The pinned `sales-channel/workflows/update-sales-channels.ts` invokes the native
update step, normalizes its result to an array only for ID event mapping, emits
`sales-channel.updated`, and returns the original result. The step reads native
preimages through `listSalesChannels`, calls `updateSalesChannels`, and retains
`upsertSalesChannels` compensation.

For selector plus object updates, the native service writes every match but
returns only the first result. One to four matches therefore return one complete
row and produce one workflow event; internal module update events still cover
the affected rows. Zero matches produce `undefined`, and the native composer
fails when reading its ID. Do not substitute successful `[]` or `null` results.

Reuse `NativePreimageConfig` and `nativePreimageSelection` from the existing
workflow preimage owner. They preserve selected IDs, normalize an empty select
to ID selection and discard unsupported nested metadata paths like native
Drizzle. Native preimages for nested metadata updates can consequently contain
only IDs. Retain and characterize that compensation behavior rather than
silently expanding the snapshot or changing the pinned helper.

## Bounded Admission

The profile admits empty selectors and supported combinations of `id`, `name` and
`is_disabled`; ID/name arrays contain at most four entries. Admit at most four
actual matches, rejecting a fifth before writes. Admit `name`, nullable
`description`, `is_disabled` and nullable object `metadata` updates. Refuse
managed fields, unknown fields, free-text search and unsupported operators.

Ordinary Sales Channel service commands and reads retain their ABI. Native list
and selector-update workflow methods use the existing finite repository profile
pattern and complete checked-DML row decoder. The native upsert compensator and
transaction-covered declaration remain. The finite atomic host remains
the sole settlement owner; no Store, Link, Task, schema migration or broader
transaction profile is required by the known closure.

## Boundary Behavior And Owners

The native undefined serialization witness fails at the shared scalar serializer
before the native composer can observe the zero-match result. Its correction
belongs to that serializer: native Drizzle serialization is identity, including
undefined. A selected optional service result uses a private tagged JSON
envelope through the existing command capture/byte budget, then restores the
native value at its workflow method. Durable/public JSON contracts and ordinary
service command result capture remain unchanged.

The ordinary Sales Channel empty-update witness changes `updated_at` on the
pre-slice repository. Its native repository owner now reads the existing entity
and skips the update and `afterUpdate` dispatch when scalar update data is empty,
matching the pinned Drizzle branch. Ordinary keyed commands retain their ABI;
the new workflow profile separately bounds selector matches and preserves native
primary-key filter order. Its module receipt validator correlates the native
scalar-first result, requested field changes and ordered internal events with
actual observed rows and mutations, without additional storage calls.

The existing Product/Pricing serializer identity witness also fails on the
pre-slice baseline. Pricing's numeric projection and graph serializer rebuild
already validated rows and arrays. Their correction retains an unchanged
representation only after all numeric companion validation, comparing changed
values with `Object.is`; no corruption checks or existing assertions are
weakened. Inventory consumers of the numeric projector retain their regressions.

The promoted native service interface, implementation overload, step and workflow
declare the genuine scalar-or-undefined selector result. The ID overload retains
its scalar contract. The named type-only promotion category admits exactly the
Sales Channel interface and service files and verifies emitted JavaScript against
the pinned source after the existing portable utility import relocation. Native
runtime result selection is unchanged. The bounded outer workflow returns a
checked complete scalar row; native absence fails before settlement.

The connected profile retains zero, one, four and fifth-match refusal cases,
selectors, complete returned rows, partial preimages, metadata, empty updates,
native failure, late rollback, replay, conflicts and genuine scope isolation.
PGlite and ordinary-role PostgreSQL establish this bounded private behavior;
they do not establish hosted activation or arbitrary workflow graphs.

The next slice is [native Sales Channel deletion](./112-native-sales-channel-delete-workflow.md),
including its Store default-channel guard and both supported Link families.
