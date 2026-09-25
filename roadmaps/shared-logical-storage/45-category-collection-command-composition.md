# Category and Collection command composition

Status: implemented for the selected direct Category and Collection commands.

## Outcome and ownership

The selected public and internal Category and direct Collection commands use
the shared outer-call validation boundary. Repeated and mixed native calls
use one logical Product source, pending state and settlement owner. Medusa owns
tree, membership and event semantics; persistence owns immutable call evidence,
operation admission and publication. No new workflow methods or storage APIs
are needed.

## Evidence and challenged alternatives

The displaced policies in `product-local-events.ts` accepted transaction
transcripts and selected one operation at construction. Category reconstructs each
changed row from its first before-image, so call-local attempts and current
pending observations suffice for native rank/path maintenance. Collection's
direct commands authenticate their own inputs, results, attempts and sealed
intents. Neither needs another transcript splitter or stateful adapter closure.

Collection updates containing `product_ids` must authenticate a replacement
intent even for an empty desired set. Accepting an empty Product attempt list
without that intent would not prove replacement. Creation and upsert retain
their existing direct membership semantics. Every create/upsert result now binds
its root IDs to mutation and event evidence, including scalar generated results
without `product_ids`; membership-only correlation left those receipts unchecked.
Returned Collection scalar fields must match the stored public row. Native
creation returns loaded Product rows, authenticated against attached after-images;
native update returns requested Product ID stubs, authenticated against the call
input in its original order. Preserve that distinction for mixed upsert results.
Updates also authenticate requested scalar changes, including the pinned shallow
metadata merge and empty-string key removal, against the stored after-image.
Direct Collection deletion binds every deleted root to the requested IDs and
requires the native command's null result; missing requested roots remain a no-op.

## Contract changes and retained gates

Replace the per-operation Category/Collection construction APIs with one Product
call policy, including the already migrated Tag commands. It selects native
semantics from the authenticated command, so mixed callers do not write their
own dispatcher. Migrate all existing logical consumers and forged-receipt tests; remove displaced
exports and transcript mechanics. This is a private API cutover with no durable
schema/data change. The core already binds call validation into request identity.
Direct Collection updates with `product_ids` now require the core replacement
admission; migrate their hosts and remove the direct generic-selector profile.
Scalar updates and create/upsert membership keep their native contracts.

Retain the Product-upsert Category membership and Collection membership workflow
aggregate policies, including their existing composed relationship policy. They
authenticate preceding outer reads; their removal gate is equivalent evidence
and native workflow proof. Do not drop those checks or cache prior calls in a
host closure. The nullable-reference delete semantic helper remains shared with
the existing Type consumer until that consumer migrates.

A Collection replacement or set-null delete remains terminal for table operations
on its working set. Multi-root replacement, post-intent reads, workflow replacement
admission, capacity changes and additional framework capabilities remain deferred.
The existing 64-entry request lifetime budget includes native repository work,
not just outer commands. A longer combined tree/scalar request reaches that
budget and refuses atomically; call validation does not expand workflow capacity.
Use bounded connected proofs rather than increasing the budget locally.

## Completion gates

Exercise repeated/mixed Category and Collection calls, pending reads, sibling
reorder, reparented descendants, create/delete pivots, exact events, one publication,
replay without re-execution and late receipt refusal with full rollback. Preserve
single terminal replacement and set-null boundaries. Run affected PGlite and
ordinary-role PostgreSQL proofs, unchanged native Category suites, typechecks,
source guards, lint and both project reviews before a scoped commit.
