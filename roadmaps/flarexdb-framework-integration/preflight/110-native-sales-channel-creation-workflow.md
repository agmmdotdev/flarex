# Native Sales Channel Creation Workflow

## Status And Authority

Status: complete for the bounded private profile.
The connected admission is native `createSalesChannelsWorkflow` for zero
to four Sales Channels. Chunked File import and Product export remain deferred.

Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 pinned at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The pinned source island stays
read-only. The continuing integration goal authorizes correct-owner changes,
implementation, validation, review and a scoped commit.

## Native Closure

The pinned `sales-channel/workflows/create-sales-channels.ts` calls the already
promoted `createSalesChannelsStep`, transforms the returned rows to ordered ID
messages, emits `SalesChannelWorkflowEvents.CREATED`, and returns those rows.
The step resolves the native Sales Channel service, retains its delete
compensator, and declares transaction-covered compensation in the finite fork.
The existing `emitEventStep` supplies the EventBus dependency.

The required owners are the native composer, existing Sales Channel service and
checked DML/DAL, the existing finite atomic workflow host, and the existing event
and publication owners. No Product, Store, Link, Task, Notification, File or
Region dependency is required. Empty input still resolves Sales Channel and
EventBus, returns `[]`, and emits no messages. Explicit native compensation with
an empty returned ID array still invokes `deleteSalesChannels([])`.

## Admitted Profile

Admit `salesChannelsData` with zero to four entries. Creation accepts optional
`id`, required `name`, optional nullable `description`, optional `is_disabled`,
and optional nullable object `metadata`. The checked native DML/DAL continues to
own defaults, managed fields, scalar/storage validation and constraints. Refuse
unknown and framework-managed input fields before mutation, and validate complete
native output before returning it. Keep the existing narrow
`SimpleSalesChannelInput` for its Product association consumer.

The shared workflow method retains its existing 256-row ceiling. Only this new
root selects the four-row limit. Existing scalar/array service commands retain
their behavior. Reuse the checked metadata/value contract owner for complete
row decoding rather than adding a second domain-specific compiler.

One Sales Channel participant selects only `createSalesChannels`, with graph
reads disabled and EventBus enabled. Existing limits suffice: 64 calls,
64 events, 1 MiB command input, 256 catalog rows and 128 logical identities.
Four creations produce at most eight internal and workflow event messages.
The root keeps existing transaction deadlines and isolation.

Validate the native internal `sales_channel.sales-channel.created` receipts and
the distinct workflow `sales-channel.created` messages, preserving returned ID
order and native empty behavior. Reuse the ordered workflow-event validator
through its shared owner if generalized; do not cast a Sales Channel event into
the closed Product event-name contract.

## Implementation And Closure Gates

1. Promote the exact pinned composer with portable imports and its existing
   native step and event dependencies. Add the narrow package export and exact
   source/build provenance; introduce no new package dependency.
2. Extend the existing Sales Channel workflow argument/output contract through
   checked metadata. Preserve existing service commands and Product association
   callers.
3. Bind the bounded root to the existing atomic host and genuine logical Sales
   Channel installation. Test defaults, supplied scalars, generated identities,
   zero/four/five entries, replay/conflicts, input/output refusal, late failure
   rollback and both event families on PGlite and ordinary-role PostgreSQL.
4. Run affected existing Sales Channel and Product association regressions,
   typechecks/builds, promotion/portability guards and lint. Obtain both required
   read-only reviews, resolve findings, clean owned resources and commit this
   slice separately.

Selector update is a separate admission: its native preimage selection, retained
upsert compensation, scalar-versus-array result and zero-match behavior need
their own witnesses. Deletion separately depends on the Store default-channel
guard. Neither follows implicitly from creation. Hosted activation and arbitrary
workflow graphs remain outside this profile.
