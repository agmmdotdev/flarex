# Sales Channel And Stock Location Links

## Status And Scope

Status: implemented bounded private native admission.
The named facade executes the pinned native
`linkSalesChannelsToStockLocationWorkflow` against the named stored
`SalesChannelLocation` Link through the existing finite atomic workflow host.
Performance optimization remains paused.

Input is one Stock Location ID, with independently optional `add` and
`remove` Sales Channel ID arrays of zero to four entries each. Preserve input
order, omissions, empty arrays, duplicate delegation and overlap between arrays.
The native workflow adds first and removes second. Its completed void result
uses the existing top-level null boundary. Each request settles independently.

This is a private stored-Link and workflow admission. Endpoint creation already
has native service/workflow owners and is not part of this root. Fulfillment
links, location selection for Cart/Order, endpoint deletion/restoration,
cross-module graph hydration, hosted activation and scale remain separate gates.

## Authority And Source

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md),
[shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md),
[package boundaries](../../16-package-boundaries.md),
[Medusa adoption](../06-medusa-adoption.md) and
[workflow foundations](../../workflow-foundations/10-medusa-workflow-integration.md)
retain authority. The preceding
[stocking](97-stock-location-inventory-levels.md) and
[reservation](98-stock-adjustments-and-reservations.md) admissions remain distinct.

`third_party/medusa/SOURCE.json` selects Medusa 2.13.4 at fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The immutable source island supplies:

| Pinned source, relative to `upstream/packages/` | Executing responsibility |
| --- | --- |
| `core/core-flows/src/stock-location/workflows/link-sales-channels-to-stock-location.ts` | Transform one location and optional channel arrays into pairs, then invoke association before detachment. |
| `core/core-flows/src/sales-channel/steps/associate-locations-with-channels.ts` | Skip omitted/empty links before resolving `link`; otherwise map to native Link definitions and call `Link.create`. Compensation calls `Link.dismiss`. |
| `core/core-flows/src/sales-channel/steps/detach-locations-from-channels.ts` | Skip omitted/empty links before resolving `link`; otherwise map to native Link definitions and call `Link.dismiss`. Compensation calls `Link.create`. |
| `modules/link-modules/src/definitions/sales-channel-location.ts` | Named many-to-many Link metadata, root aliases and endpoint extension paths. |
| `modules/link-modules/src/services/link.ts` and `link-module-service.ts` | Native tuple creation, tuple-selected soft deletion, serialization and attached/detached event production. |
| `modules/link-modules/src/loaders/container.ts` | Native service and event entity naming; bootstrap mechanics are not runtime dependencies of this private admission. |

The promoted `medusa-modules-sdk` Link router, Link services, structural generator
and shared Link adapter execute with the newly promoted definition, two steps
and composer. The existing `LinkWorkflowInput` supplies the DTO contract.

The native admin route runs this workflow and then refetches the Stock Location
through its HTTP/query infrastructure. That refetch is outside the workflow.
The pinned `integration-tests/modules/__tests__/link-modules/sales-channel-location.spec.ts`
checks hydrated `stock_locations.sales_channels` via Remote Query. It remains a
reference witness; this slice does not port or weaken those hydration assertions.

## Native Semantics And Naming

The table is `sales_channel_stock_location`, with prefix `scloc`, composite
identity `(sales_channel_id, stock_location_id)`, a non-key native `id`, timestamps
and soft deletion. Both endpoint relationships have `hasMany: true`; there are
no extra fields or singular-partner uniqueness checks. Native generation supplies
ID/deletion indexes and active indexes in both endpoint directions.

Keep these separate native identities:

- Link-root aliases `sales_channel_location` and `sales_channel_locations` name
  the query model `LinkSalesChannelLocation`.
- The native loader derives event entity `LinkSalesChannelStockLocation` from
  the table; events are its `.attached` and `.detached` families.
- `LINKS.SalesChannelLocation` is composed using `location_id` as the final
  naming argument, although the persisted endpoint field is `stock_location_id`.
  Reuse the existing promoted `composeLinkName` with those exact native arguments.

The new binding must use the declared query model for its Link-root read
definition and the native loader entity for event receipts. Do not rename the
native definition or change shared service event naming to conflate them.

Native `Link.create` delegates many-to-many tuples without deduplicating them.
The existing Link repository performs endpoint-key upsert: repeated attachment
may replace the generated non-key ID and reactivate a soft-deleted pair. Its
whole-batch duplicate-key refusal remains a compatibility witness. Dismissal
uses native tuple selectors and shared soft deletion; unmatched or already
inactive pairs produce no changed rows. Add/remove overlap therefore leaves the
pair inactive while retaining the actual ordered event evidence.

Neither this workflow, the Link router nor generated Link storage declares
endpoint existence/liveness validation or endpoint foreign keys. Preserve that
native private-profile behavior, including unknown IDs; do not imply that ID
shape validation establishes a live endpoint. Stronger reference integrity and
endpoint cleanup require their own explicit semantic admission and shared-owner
proofs. Link storage and reads remain confined to the authenticated shop scope.

## Implementation And Ownership

1. The definition, two steps and composer use narrow imports/exports and pinned
   provenance. The definition reuses `composeLinkName` instead of the broad
   `LINKS` registry. Native callbacks and compensators remain declared; the
   steps are transaction-covered. The composer returns
   `new WorkflowResponse(void 0)` after both steps, preserving their order and
   existing void-to-null completion. Its transforms construct complete step
   inputs, and the step types admit the omitted links already handled by their
   early-return branches. This is a finite-SDK type seam, not normalization of
   omitted arrays into empty native calls.
2. Named metadata capture and logical definition under `src/links/` reuse
   `captureLinkMetadata`, `linkSchemaOrigins`, DML lowering and normalization.
   The separate source/profile is `medusa.link.salesChannelLocation`, with lineage
   `commerce.link.sales-channel-location`. Existing Product/Variant Link sources
   retain their identities. Schema composition requires both endpoint sources
   when this Link is selected. This adds one logical table over the existing
   physical families, not per-shop DDL or a new migration engine.
3. One named Link preparation entry uses `prepareLinkService`, native
   `Link.create`/`dismiss`, shared service commands, repository and event policy.
   Its authentic workflow methods are `create` and `dismiss`. Link-root
   list/count reads by either endpoint belong to a separate read selection.
   Queries retain both composite keys even when only ID is selected. Ordering
   uses the native leading Sales Channel field with the shared complete-identity
   tie-break; no lexical Stock Location tie order is promised. Paging and counts
   retain their shared owner, native aliases and soft-delete filters.
   The Product-only composed native router remains unchanged.
4. The facade under `src/workflows/stock-location/` selects only the
   new Link module's two methods and internal module events. Sales Channel and
   Stock Location grant no endpoint mutation methods to this root. Neither step
   requires Inventory, Pricing, query, hook, child workflow or Locking resources.
   It retains default atomic admission, one settlement owner and 64-call/64-event
   limits. No core correction or scope-exclusive selection is included. Array
   checks follow the pinned Effect `Schema.mutable` conversion, which rebuilds
   the array AST without earlier checks; both root arrays and method tuples retain
   their four-row bounds. The maximum graph is an explicit acceptance witness.
5. Source selection and fixtures let the connected proof select Sales
   Channel, Stock Location and this Link independently of Product/Inventory/
   Pricing. The existing variant fixture retains its implicit Stock Location
   selection and source order. This is fresh private candidate admission, with
   no populated-source upgrade, durable reset, ownership transfer or consumer retirement.
6. Acceptance requires both drivers, affected consumers, builds/typechecks and source/browser
   guards. Run heavy database and compiler checks separately; constrain compiler
   concurrency as needed without changing resource budgets or test assertions.
   Complete both required read-only project reviews and exact staged lint before
   one implementation commit. Update capability status only after those gates pass.

## Acceptance And Failure Gates

Behavioral gates cover native omission/empty behavior, maximum four-add/four-remove
graphs, many-to-many reuse in both directions, input order, add/remove overlap,
repeated attachment, reattachment after dismissal, duplicate delegation/refusal
and unmatched/repeated dismissal. Link-root filtering in both directions and
stable paging with complete identities remain distinct from cross-module hydration.

Seed real endpoints through their existing native services for the connected
proof, and separately characterize unknown endpoint IDs to make the native
liveness boundary explicit. Verify exact native generated IDs and attached/
detached messages against operation-local mutation/lifecycle evidence, including
an earlier ID replaced or dismissed later in the same root.

Prove replay, changed-identity refusal, uncertain-acknowledgement recovery without
repeating native writes, late failure after association and during dismissal,
cancellation, caught refusal and escaped-capability revocation. Rollback must
restore pre-existing Link state and publish no rows/facts/events; inverse callbacks
must not run as substitute writes in the failed transaction.

Ordinary-role real Postgres separately proves competing same-pair roots under
default OCC, constraint/rollback behavior and matching IDs/request keys in two
shops. PGlite proves its semantic lane, not database contention. Regress current
Product/Variant Link consumers, Stock Location stocking, stock/reservation roots
and shared schema/Link owners affected by the new admission.

If shared storage, lifecycle, query coverage or receipt enforcement fails,
preserve the failing witness and identify its owner. Stop dependent integration
until a scoped correction is explicitly authorized; do not add adapter SQL,
mutexes, fallback transactions, looser limits or weaker expectations.
