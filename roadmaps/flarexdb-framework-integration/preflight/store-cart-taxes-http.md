# Store Cart explicit Tax refresh HTTP

Status: private bounded HTTP promotion complete; production activation remains gated.

## Scope and authority

Promote pinned `POST /store/carts/:id/taxes` through the existing private Cart
host. Run genuine `update-tax-lines` as a child of the trusted atomic root with
`cart_id` from the route and `force_tax_calculation: true`. Retain the existing
eighteen-source graph, scope exclusion, queued native calls, resource-digest
identity and sole outer settlement. Only Cart Tax list/set methods and native
Tax calculation are selected for execution; other sources supply graph reads.
No schema, retained-data reset or new Core mechanism is selected.

Two independent readers challenged current Core, accepted direction and Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`, then exchanged findings. Native
transactional outcomes, recovery before execution and shared nested state fit
the existing root. Ordinary construction and the existing root resource limits
remain with their current owners.
The dedicated wrapper has ten recursive nodes and at most 23 SDK control
operations, fits ordinary 64-node construction and the 64 KiB raw identity
capture, and retains the existing 512-operation root allowance.

## Native behavior

The route admits the full requested response projection before mutation and
independently refetches the committed Cart afterward. Its body schema is native
`StoreCalculateCartTaxes`, based on `createSelectParams`. The shared native body
validator enforces strict keys. Empty objects and valid body `fields` strings
are accepted; the handler ignores body fields and uses query fields for refetch.
Caller-supplied Cart IDs, force flags and extra body members do not enter the
workflow. Native publishable-key and locale behavior remain intact.

Forced calculation overrides disabled automatic taxes. A shipping country is
required before the native step checks whether the Cart has items, so missing
country returns 400 even for an empty Cart. An empty Cart with country succeeds.
The graph's native missing-key path returns 404.

The pinned workflow does not fetch `completed_at` before native Cart validation.
Completed Carts also refresh and return 200 while retaining their completed
timestamp in the response. Adding a completed-Cart precheck would be a separate
native behavior change.

Cart Tax replacement retains native history, module events and retained
inverses. The workflow emits no `cart.updated` event and does not refresh Payment
Collections or invalidate Sessions. Payment state therefore remains unchanged
even when recalculated Cart totals differ from the collection amount.

## Acceptance and remaining gates

Prove forced calculation in a Region with automatic taxes disabled, changed
values, repeated replacement, complete history and module event settlement,
unchanged populated Payment state, body/key/projection refusal, native absence
and country behavior, provider failure and failure after pending item-Tax writes.
Failure must preserve the exact committed business rows and events.

The native retained inverse recreates prior Tax values with new row identities;
it does not restore exact historical IDs. Verify that behavior separately from
whole-root rollback. Direct prepared-root lost-acknowledgement recovery and
same-key replay remain with the native outcome owner; the pinned-generation
HTTP fixture does not establish HTTP transport-loss recovery.

Acceptance requires PGlite, ordinary-role PostgreSQL and actual Workerd HTTP
with durable observation and refetch after recreation. Existing authoring,
query, identity, byte, event and request limits remain enforced. Populated Shipping
Tax and Shipping Method lifecycle are selected by the connected
[Shipping HTTP profile](./store-cart-shipping-http.md). Remote Tax providers,
translation, Payment setup, checkout completion HTTP, mixed deployment, capacity and production
activation retain separate gates.
