# Native Sales Channel Update Workflow

## Status And Authority

Status: source preflight complete; boundary witnesses precede implementation.
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

## Proposed Bounded Admission

Admit empty selectors and supported combinations of `id`, `name` and
`is_disabled`; ID/name arrays contain at most four entries. Admit at most four
actual matches, rejecting a fifth before writes. Admit `name`, nullable
`description`, `is_disabled` and nullable object `metadata` updates. Refuse
managed fields, unknown fields, free-text search and unsupported operators.

Keep ordinary Sales Channel service commands and reads unchanged. Add the native
list and selector-update workflow methods using the existing finite repository
profile pattern and complete checked-DML row decoder. Retain the native upsert
compensator and transaction-covered declaration. The finite atomic host remains
the sole settlement owner; no Store, Link, Task, schema migration or broader
transaction profile is required by the known closure.

## Boundary Witnesses And Implementation Order

1. Preserve a genuine zero-match witness through native service serialization
   and private workflow-command transport. The current JSON-only intermediate
   result boundary cannot carry native `undefined`. Identify and correct its
   framework owner without altering durable JSON, fabricating a row or bypassing
   the native composer failure.
2. Characterize empty updates. Native Drizzle skips root update and its update
   event for `{}`, while the current Sales Channel repository writes and reports
   rows. Correct the actual repository owner before admitting this case.
3. Promote the exact native composer and step with portable imports. Extend the
   named Sales Channel workflow methods and finite selector repository profile,
   then bind the bounded root and scalar-result event validation.
4. Validate zero, one, four and five matches, selectors, complete returned rows,
   preimages, metadata, empty updates, native failure, late rollback, replay,
   conflicts and genuine scope isolation on PGlite and ordinary-role PostgreSQL.
   Run affected consumer regressions, types/builds, provenance, portability and
   lint; obtain both required read-only reviews and commit separately.

Deletion remains a later slice because its native workflow includes the Store
default-channel guard. Hosted activation and arbitrary workflow graphs remain
outside this admission.
