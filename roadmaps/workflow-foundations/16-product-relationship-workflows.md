# Product Relationship Workflows

Status: implemented private atomic capability, using the
[design-quality construction and query contracts](../medusa-design-quality/README.md).

## Behavior And Native Ownership

The pinned Medusa Category child lists the selected Products and their complete
Category memberships, then upserts their new Category ID sets. Removal wins when
an ID occurs in both Category input lists; unrelated Categories remain attached.
The executing fork explicitly selects up to 256 IDs rather than relying on the
native list default. The relation-only upsert command validates that restricted
input at runtime and does not grant arbitrary Product creation or scalar updates.

The Collection child reads the current complete membership, removes requested
IDs, appends additions, then calls the native Collection update. Addition wins
when an ID occurs in both Collection input lists. Membership updates never delete
Products. The executing step returns its native update DTO; an empty request
short-circuits with no result. The immutable reference source remains pinned in
`third_party/medusa/SOURCE.json`.

The combined workflow runs Category work first and captures its pending Category
snapshot. Collection replacement runs last and seals subsequent calls/events.
Its private result contains `productsAfterCategory` and a tagged Collection
result: `skipped` or `replacementRequested` with `requestedProductIds`. Requested
IDs may not exist in storage, so this result deliberately does not claim final
Collection membership. Committed membership is verified independently after
settlement. The former Collection-then-Category/post-replacement graph contract
is displaced; no alternate nonterminal engine or compatibility wrapper remains.

## Construction And Settlement

The trusted Product module binds exact native command tokens, input/output
contracts, call receipts and event declarations. Workflow callers install the
module with scoped logical storage and select methods. The common host derives
event contracts and carries the existing terminal replacement capability. A
same-name counterfeit command cannot satisfy native provenance.

Category and Collection preserve their different native business rules. Shared
core owns scoped reads, pending visibility, resource bounds, settlement and
publication. Replacement selection overlays pending Product inserts, updates and
deletions. Overlapping rows retain original read dependencies and coalesce into
one final revision/fact; untouched derived rows stream through bounded pages.
Native event order remains distinct from final row coalescing.

Each root commits or rolls back as one operation. Caught unsupported calls,
malformed receipts and attempted calls after replacement remain sticky. Replay
returns the durable outcome without repeating native writes or event delivery.
The former aggregate membership transcript and relationship splitter are removed;
call-local receipts enforce footprint, result and event correlation.

## Bounds And Proof Surface

A complete membership read must exhaust its selected set within admitted limits.
An ordered page cannot substitute for that proof. The trusted root may select its
existing admitted call allowance; this does not raise per-participant ceilings,
byte/statement/deadline bounds or grant another transaction. Collection replacement
uses its explicit finite derived-event allowance and bounded streaming owner.

The logical Product creation/workflow suite covers both native children,
add/remove overlap, no-op, missing IDs, actual committed membership, exact events,
replay and rollback. The Category/Collection composition suite covers repeated
calls, pending row overlap and one revision/fact per changed identity. Ordinary-role
PostgreSQL witnesses cover concurrency and outside-transaction visibility alongside
the PGlite lane. Native Category compatibility suites retain framework behavior.

This capability introduces no additional commerce module, durable workflow
engine, external effect, public serving API or hosted activation. Structural
storage migration and broader module admission keep their separate gates.
