# Parent-qualified Product HTTP mutations

Status: accepted bounded correction; individual routes remain subject to their
connected implementation and validation gates in the Medusa adoption roadmap.

## Source and reason

The pinned Medusa fork is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
Its nested Variant deletion handler explicitly omits the URL Product ID. The
native deletion workflow independently uses the requested Variant IDs for its
query, Link/Price cascade, final soft deletion, workflow events and hook. A
request through Product A can therefore delete Product B's Variant and links.

The user authorized enforcing Product ownership for nested deletion and
association routes. Correct the native workflow and module lifecycle owners;
an HTTP prefetch followed by an ID-only mutation cannot enforce this boundary.
Keep the pinned comparison snapshot unchanged and authenticate the promoted
fork adaptations with narrow source guards.

## Variant deletion contract

The workflow accepts `{ ids, product_id? }`. Existing unscoped callers retain
their requested-ID semantics, including duplicate, missing and repeated IDs in
hooks and workflow events. Scoped callers query both IDs and parent and retain
the request order and duplicate occurrences of matching Variants. Only these
effective IDs may reach Link/Price cleanup, Inventory ownership calculations,
workflow events and the `{ ids }` hook.

The final Product service mutation receives `{ id: effectiveIds, product_id }`.
Its existing generated service normalizes selectors before the DAL; the
Product lifecycle must authenticate every selected root's actual parent before
planning or applying transitions. A mismatch refuses the entire atomic root,
including earlier Link/Price changes. Receipt validation authenticates the same
selection against authoritative row evidence. Core read dependencies and OCC
still own conflicting concurrent changes and settlement. No second transaction,
SQL path, HTTP reconciliation or callback replay is introduced.

The native step retains `transactionCovered` compensation and ID-array
compensation data. The public Product service declaration admits the exact
parent selector already supported by the executing service, without broadening
other methods or inserting unchecked casts.

## Option deletion contract

Option deletion uses the same optional parent request and exact parent-qualified
final selector, but its native unscoped workflow performs no prequery. Execute
the Option ownership query only within the SDK's scoped conditional branch.
Use the matching requested IDs, preserving order and duplicates, for final
soft deletion, the `{ ids }` hook, Link dispatch and workflow events. Preserve
the native order: soft deletion, hook, then parallel Link dispatch and events.

The existing Option graph, lifecycle and event owners authenticate Option roots
against their actual Product before planning transitions. Values belong to
Options through `option_id`; apply Product checks to root rows and retain the
existing selected-Option checks for Value rows. Preserve native soft deletion
and retimestamping of already-deleted Values, including their updated events.
Product and Variant rows, Variant/Value pivots and Pricing/Inventory links are
retained. The existing native `Link([])` router still owns dispatch because
this profile has no stored external Option Link family.

The bounded profile retains four Options, four Values per Option, sixteen
Values in total and its existing call/event budgets. Both public service
overloads are authenticated together by one exact source guard on their shared
declaration file. The Variant and Option workflow/step adaptations retain their
own exact source pairs; the service file is not duplicated under classifications.

## Observable HTTP behavior

The nested DELETE passes both route identities. Product read, Variant read and
Variant delete policies remain native. Admit the parent response projection
before mutation and refetch the URL parent independently after settlement.
Keep the native `{ id, object: "variant", deleted: true, parent }` envelope.

A wrong-parent, missing or already-deleted scoped Variant selects nothing and
does not mutate child, Link, Pricing or Inventory rows or emit deletion events.
The HTTP success envelope has the same idempotent shape as native deletion;
it is not evidence that a row transitioned on this call. An empty root outcome
may still settle. A later response-refetch failure cannot undo a committed
workflow and must not cause an HTTP-layer retry.

Option DELETE follows the same scoped no-op and policy rules, with native
Product read, Option read and Option delete policies. Its native envelope is
`{ id, object: "product_option", deleted: true, parent: product }`. The parent
is deliberately not passed through `remapProductResponse`, even though its
refetch fields use `remapKeysForProduct`. Rich price/inventory responses must
preserve that executing native shape.

## Image and Variant associations

Both native association workflows accept an optional Product constraint. Every
add/remove Step carries it to the actual Product service, which checks both
Image and Variant ownership under the same shared context before assignment
operations. The constraint is then removed from the unchanged persisted pair
shape. Constrained foreign, missing or inactive endpoints refuse the atomic
root, including any other branch's pending assignment and thumbnail changes.
The workflow's thumbnail queries and final update selectors also retain the
Product. Receipts authenticate endpoint parents and thumbnail selections from
authoritative observations and mutations.

Unscoped private callers retain native same-tenant cross-Product behavior.
Empty operations keep native empty results without endpoint existence checks.
Variant-to-Images retains sequential add/remove and its existing refusal of
duplicate or intersecting request arrays. Image-to-Variants retains native
parallel branches, raw duplicate/intersection semantics and its separate
bounded complete-preparation profile. Native insert identities, raw removal
results and URL-based thumbnail decisions are retained. No universal
association engine, stored parent column or additional transaction is added.

The HTTP handlers always supply the URL Product and keep native validators,
policies and `{ added, removed }` envelopes. They perform no HTTP existence
read or Product refetch. Native parser size metadata is kept without widening
the private Fetch ceiling; the pinned Fetch host itself does not interpret
`sizeLimit`.

## Variant Inventory Link contract

The four nested Inventory Link methods use named Product-scoped workflow roots.
One genuine Product Variant list operation checks every requested Variant against
the URL Product within the same trusted root before generic Link execution.
Its checked read receipt and Core dependencies retain the parent constraint;
no separate HTTP ownership read or transaction is added. Foreign, missing and
soft-deleted Variants refuse the whole nonempty operation. Empty operations
retain native empty results without a Product existence check.

Generic native create/update/dismiss/batch Link workflows retain their original
preimage queries, exact update existence-count check and compensators. Batch
arms retain native parallel declaration, with queued borrowed operations under
the single settlement owner. The finite profile admits eight definitions in
total across all three arms and signed-int32 quantities. Native HTTP already
materializes omitted arms as empty arrays; the private wrapper requires those
three arrays rather than extending the generic proxy's omitted-input behavior.

Inventory Link endpoints form the composite primary key. Native create/upsert
generates a new scalar non-primary `id` when the caller omits `data.id`, including
quantity-only updates. Native Link-definition preimages contain endpoints and
declared extra fields such as required quantity, rather than the scalar row ID.
Compensation restores that native definition and may regenerate the scalar ID.
Proof must preserve endpoint identity, exact quantities and unrelated links;
it must not impose scalar-ID stability absent from the pinned repository.

Single-method Variant response fields are admitted before mutation. Native
callable `product_variant` Remote Query retains its own tree-shaped producer,
checked projection and complete-array result; it delegates reads to the existing
Variant graph. The batch response needs no independent refetch.

## Variant batch contract

The nested Variant batch supplies the URL Product to the native batch workflow.
Its scoped validation step checks the combined existing update/delete cohort
before any child runs. Both creation and update receive that Product explicitly;
deletion forwards it to the existing scoped deletion child. The actual Product
mutation and authenticated receipt check the selected row's parent, including
tombstones. A supplied parent cannot resurrect or move a foreign Variant.
Missing deletes retain their native no-op and requested-ID response behavior.

The shared Variant parent-read receipt also serves the Inventory Link wrappers.
It authenticates the actual read command and selection; HTTP prefetches and
separate settlement lifetimes do not enforce this boundary. Existing unscoped
batch callers retain native normalization and all three empty child calls.

## Remaining scope and gates

Image/Variant associations and scoped Option deletion have bounded actual DO
acceptance, including durable graph checks across serialized owner recreation.
The Core lease-handoff prerequisite is resolved for that host contract. Variant
Inventory Links also have connected actual-host acceptance, including scoped
refusals, quantity changes and native active/tombstoned rows across recreation.
Variant batch update and deletion also have bounded actual HTTP/DO acceptance
through their scoped native mutation and receipt owners. General managed-host
election remains separate.

Preserve unscoped workflow and batch regressions. Prove scoped wrong-parent and
mixed-ID behavior, complete valid deletion, shared Inventory rules, late
failure rollback, matching identities in different tenants and parent-change
conflicts around the final mutation on PGlite and ordinary-role PostgreSQL.
Prove Option's unscoped no-query sequence, complete Value events, retained pivots
and raw parent response. Prove the HTTP paths and durable graphs after
recreation in actual Workerd/DO.
Source-guard mutations must reject removal of the parent constraint or use of
raw request IDs in a scoped cascade, event or hook. Production activation and
performance acceptance retain their separate gates.
