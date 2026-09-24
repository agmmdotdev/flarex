# Product–ShippingProfile Link And Workflow Cutover

Status: implemented under the approved shared-storage completion goal. The
remaining physical commerce callers and structural migration owners remain in
the [completion inventory](./03-completion-plan.md).

## Owner And Decision

The retained native Product–ShippingProfile workflow uses Product, SalesChannel,
ShippingProfile and one Medusa Link router that writes two stored Link tables.
The existing logical workflow host correctly grants one authenticated logical
source per participant. Giving the router two independently selected sources
would require a new multi-source participant contract and settlement proof for
this one use. The simpler correct contract is one Medusa-owned Product Links
source containing the selected native stored Link definitions; a source can
already own multiple logical tables. The router remains native and Flarex keeps
one scoped transaction, row/index/unique authority and publication owner.

Compile `product_sales_channel` and, when selected, `product_shipping_profile`
under one stable Product Links lineage. Preserve native endpoint keys, active
pair/ShippingProfile cardinality, soft-delete behavior and indexed endpoint
reads. Add a derived unconditional shipping-profile endpoint access path only
where native restore needs deleted rows. Select only the requested Link models;
unselected Fulfillment tables and providers stay closed.

The private single-Link source key/lineage and its test fixture will break as
the Product Links source becomes the owner of the same SalesChannel Link table.
No named durable environment is converted or reset by this slice. Migrate the
existing SalesChannel Link and workflow consumers in the same change. Keep the
other previously selected logical module sources and their semantics intact.

## Connected Proof And Cleanup

Move the four-participant native workflow and its pending graph reads to Product,
SalesChannel, ShippingProfile and Product Links logical participants. Preserve
native event correlation per Link table and exact call/row order. Exercise the
complete four-Product envelope, replay, late rollback, generated IDs, singular
ShippingProfile assignment, mixed-family refusal, resource and hydration
refusal, cancellation, uncertain settlement, subscriber failure, two-shop
isolation on both drivers and same-scope contention on PostgreSQL. Unlike the
old physical host, the logical owner does not hold a database transaction while
a native callback waits. Two same-scope roots can both reach their callbacks;
one conflicting publication may return `writeConflict`. A new request can retry
after the winning commit, leaving one active Link row and exact events. This
replaces an old test assertion that required a PostgreSQL lock wait during the
callback; it does not add an adapter retry or weaken settlement validation.

Retire the physical seventeen-table schema/profile helper, physical workflow
fixture, and remaining physical Link router profile entry point once these
witnesses run on the logical source. Do not retain generated commerce DDL for a
test-only consumer. General Medusa expansion, developer APIs, hosted activation
and populated-data upgrade orchestration remain outside this slice.

Validate the affected Medusa and core typechecks, native source guards, focused
PGlite and ordinary-role PostgreSQL suites, lint and both read-only reviewers
before committing.
