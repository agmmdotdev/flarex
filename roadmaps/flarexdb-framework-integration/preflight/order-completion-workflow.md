# Native Order completion workflow

## Status and authority

Status: implemented private completion profile for zero to four raw existing
Order IDs on PGlite and ordinary-role PostgreSQL. This extends the existing
[Order foundation](./order-archive-foundation.md) with an independent profile.
It does not grant Order
creation, serial allocation, payment, fulfillment, returns, public API or hosted
activation capabilities. Cart/Tax and Payment retain their existing owners.

The executing reference is Medusa 2.13.4 fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Native model/service metadata and
business guards remain framework owned. The existing logical commerce and
atomic workflow owners govern reads, facts, events, receipts, replay and outer
settlement; no Order participant receives raw SQL or settlement capabilities.

## Connected profile

The selected root is native `completeOrderWorkflow` (`complete-order-workflow`)
and its `completeOrdersStep`. The step lists `id,status`, invokes genuine
`OrderModuleService.completeOrder`, and retains prior statuses for the genuine
`updateOrders` inverse. The native public list serializes its projection before
completion mutates returned Orders. Unlike archive's approved correction, this
step needs no business change. Promotion permits only portable imports, the
direct selected step import and transaction-covered compensation configuration.

The service refuses canceled Orders. Pending, completed, archived, draft and
requires-action Orders are eligible; this native method imposes no payment or
fulfillment readiness guard. Missing or historical roots refuse through the
existing service. Zero to four raw IDs are admitted, preserving duplicates in
the root's ordered `order.completed` messages while module updates describe
actual distinct rows. The returned complete native DTOs retain pre-write
timestamps; inverse DTOs contain the newly written timestamps. Existing serial
display IDs and live/historical owning Address references remain unchanged.

The selected portable Drizzle owner writes an explicit same-status patch and
emits its module update event, including a repeated inverse under a new request
key. The pinned MikroORM PostgreSQL dirty-check lane may omit that same-status
write. Those are separately characterized native lanes; their difference is
not a reason to change the selected Drizzle command contract.

Completion commands use source `flarex-order-complete`, profile `order.complete`.
They share the existing complete-row decoder and confined status repository
with archive, retaining distinct transition and inverse admission. Archive's
inverse still accepts only completed/canceled/draft. Completion's inverse
accepts only the five eligible non-canceled statuses. No general update method
or relation write becomes available.

## Hook and event contract

The root invokes `ordersCompleted` with complete Orders and optional finite JSON
`additional_data`. Hooks are trusted, revision-pinned, finite callbacks inside
the existing outer transaction. They may inspect the selected Order read
capability. The completion receipt permits exactly one forward completion and
no status restoration call, so hook status writes refuse and roll back. Extra
workflow messages also refuse. This profile grants no remote-effect or pause
capability. Escaped callbacks lose authority after their finite lifetime.

The original root invokes module completion before `order.completed`, then the
hook. Captured messages settle atomically with data and durable outcomes. Replay
returns the authenticated complete DTO result without repeating the hook or
events. All immediate and replayed rows use the same DML-derived scalar and
Address-reference decoder; valid JSON alone is insufficient.

## Admission gates

Require genuine original-source characterization and actual retained callbacks,
then PGlite and ordinary-role PostgreSQL witnesses for the maximum root,
heterogeneous and repeated inverse, same-root roundtrip, canceled/missing/
historical refusal, duplicate/empty/oversized requests, late-parent and hook
rollback, event ordering, hook authority, replay corruption, Address references,
scope isolation and resource cleanup. Preserve existing archive behavior after
the bounded shared fixture extraction. Source and boundary guards must admit
only the exact two completion source pairs. The existing full-native schema,
serial preservation, empty JSON default and ordered non-null index prerequisites
remain unchanged; this slice introduces no shared storage capability.
