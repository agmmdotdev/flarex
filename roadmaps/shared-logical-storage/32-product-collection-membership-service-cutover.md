# Native Collection membership service cutover

Status: selected explicit-ID native Collection membership path implemented on
shared logical Product storage. Generated-ID creation and mixed upsert have
since moved under the [result-bound cutover](./33-product-collection-generated-id-membership-cutover.md).
Broader Product operations remain with the named physical compatibility runner.

## Connected outcome and owners

Move the existing native ProductCollection create/update/upsert commands with
explicit-ID `product_ids` membership to the shared Product logical source.
Keep Medusa's normalization, association/dissociation selectors, DTOs and
events with its native service. Flarex owns indexed scoped row access, FK
checks, transaction resource accounting, one settlement and publication.
The selected native Collection assignment workflow already runs logically;
this slice closes the direct service path for explicit-ID memberships and
replaces the physical-only 20-member boundary witness.

The pinned `ProductModuleService.createCollections_` uses
`upsertWithReplace(..., { relations: ["products"] })`; `updateCollections_`
updates the Collection and then associates or dissociates Products through
its native Product service. The adapter's `collectionMembership` profile
already selects those Product rows by declared ID and reverse-collection
indexes. No adapter SQL, second transaction, or new event producer is needed.

## Challenged alternatives and replacement contract

Keeping the scalar-only validator as a second serving profile would leave a
compatibility-led split for the same native commands. Replace it with one
Collection receipt policy for root and Product attempts. Authenticate the
captured command name and operation, Collection insert/update roots, Product
`collection_id` changes related to a requested Collection root, and exact
created/updated module events. A scalar call still permits only Collection
facts. Unrelated Product fields, foreign roots, missing events, lifecycle
observations and sealed transitions must refuse. Check explicit membership
intent, including an empty list, without treating no-op lists as a reason to
skip receipt validation.

This breaks the selected private scalar host's rejection of `product_ids` for
admitted explicit-ID Collection commands. Native public signatures and generic
durable row format stay unchanged. The full physical Product runner remains
for auto-ID membership creation, larger or more complex membership batches,
and other unported methods until original cases have logical replacements.
Do not lift request limits or silently split a command into commits. A core
capacity problem exposed by the native path must be recorded and corrected at
the shared owner, not hidden with adapter pagination or direct SQL.

## Proof and cleanup gate

Use the native service on PGlite and ordinary-role PostgreSQL to create,
replace, move and clear a 20-Product membership. Check pending and committed
Collection→Product reads, root/Product facts and events at one sequence,
replay, rollback on a late failure and two-shop ID collisions. Preserve the
scalar and high-fan-out delete witnesses. Move the displaced physical-only
20-member boundary case and keep its original semantics in the logical test.
The remaining physical runner must have named unported cases and a removal
gate. Run affected typechecks, lint, both read-only reviews and a scoped
commit. No result here proves arbitrary fan-out or full Product retirement.

## Selected result and remaining gate

One Collection receipt policy now covers scalar roots and explicit-ID
`product_ids` create, update and upsert. It admits only native Collection root
attempts and Product `collection_id` updates tied to requested roots, with
matching native events; unrelated Product fields, lifecycle observations and
sealed transitions refuse. Explicit empty lists remain meaningful. The
logical two-driver witness replaces and clears 20 members, moves a retained
Product between Collections, checks pending and committed relation reads,
replay, rejected receipt rollback and colliding IDs in two shops. The displaced
20-member physical boundary case is removed; original native Collection cases
remain in the physical runner until their own selected logical replacements.

At this checkpoint, this selection rejected membership creation without an
explicit Collection ID because the authenticated input could not name its root
before Medusa generated one. The later result-bound cutover admits generated-ID
creation and mixed upsert. More complex multi-root membership batches and other
unported Product methods retain the physical runner; it is not a fallback for
the selected logical paths.
Replacing membership beyond the shared complete indexed-read budget currently
refuses atomically; the 129-member witness prevents a partial detach from
appearing successful. General high-fan-out replacement needs a core-owned
bounded complete-selection design, not adapter-side pagination or a larger
unchecked `take` value.
