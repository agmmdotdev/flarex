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

## Remaining scope and gates

Option deletion, Image/Variant associations, Variant Inventory Links and
Variant batch deletion require the same owner-level analysis and their own
connected corrections. A corrected Variant route does not complete them.

Preserve unscoped workflow and batch regressions. Prove scoped wrong-parent and
mixed-ID behavior, complete valid deletion, shared Inventory rules, late
failure rollback, matching identities in different tenants and parent-change
conflicts around the final mutation on PGlite and ordinary-role PostgreSQL.
Prove the HTTP path and durable graph after recreation in actual Workerd/DO.
Source-guard mutations must reject removal of the parent constraint or use of
raw request IDs in a scoped cascade, event or hook. Production activation and
performance acceptance retain their separate gates.
