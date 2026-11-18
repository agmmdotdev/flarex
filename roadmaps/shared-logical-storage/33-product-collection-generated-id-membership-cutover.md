# Native Collection generated-ID membership cutover

Status: selected native generated-ID create and mixed upsert membership path
implemented on shared logical Product storage under the standing approval.

## Outcome and owner

Move the pinned native `createProductCollections` case with generated Collection
IDs and `product_ids` onto the existing logical Product source. Include mixed
`upsertProductCollections` creation/update when the same result contract is
proved. Medusa continues to generate IDs, normalize memberships and emit module
events. Flarex authenticates the completed command transcript, scoped row facts,
result and events before its one settlement. No new core storage or ID allocator
is needed; unrelated Product methods and broader membership capacity are outside
this slice.

The native service calls `upsertWithReplace` for Collection creation and returns
created entities in input order. Mixed upsert returns created entities first,
then updated entities. The current logical Collection receipt obtains membership
root IDs only from input, so it refuses an auto-ID request after the native
service has already generated the ID. The outer transaction rolls this back,
but the existing native creation case remains on physical storage.

## Decision and breaking contract

Resolve a generated root ID from the captured native result, using the native
result ordering for created inputs and explicit IDs for updates. Require result
shape, cardinality and distinct IDs, then match result IDs to root facts by ID
rather than relying on the mutation transcript's order. Bind each requested
membership to a Collection root mutation, the exact Product `collection_id`
changes and native events. A malformed or contradictory result must fail the
receipt and roll back.
Do not pre-generate an ID in the adapter, infer identity from title/handle, or
let an uncorrelated Product update pass merely because an event was emitted.

This replaces the private logical receipt's auto-ID refusal. Public Medusa
inputs/results and generic durable row format do not change. Existing physical
Product storage remains for named unported runner methods, not as a fallback
for this admitted command. No named durable data is reset or converted.

## Proof and cleanup

Run native generated-ID create with Products, a mixed create/update upsert,
pending and committed membership reads, replay, late receipt rollback and
two-shop isolation on PGlite and ordinary-role PostgreSQL. Preserve explicit-ID
and bounded-overflow witnesses. Add a forged or mismatched result receipt witness
so result correlation cannot silently weaken. Update the completion inventory,
remove the old auto-ID refusal expectation, run affected typechecks and lint,
obtain both required read-only reviews and commit the connected slice.

This does not lift the shared complete indexed-read limit for large membership
replacement. That remains a separate core-owned capacity gate.

## Selected result

The Collection receipt now correlates a generated root from the captured native
result with the input membership, root fact, Product `collection_id` facts and
native events. For mixed upsert, it uses Medusa's created-then-updated result
order and checks returned update IDs. A forged result, late receipt failure or
missing root still rolls back the whole request. The native two-driver witness
exercises generated create, pending membership, mixed upsert, replay, rollback
and shop-local membership; explicit-ID and overflow witnesses remain.
