# Core-owned Collection membership replacement

Status: focused preflight under the standing shared-storage completion approval.
The bounded shared-event prerequisite is implemented; the 129-member native
Collection update remains an atomic capacity refusal until the connected
core/native replacement and both-driver proof pass.

## Trigger and ownership

The logical native `updateProductCollections(id, { product_ids: [] })` witness
refuses with `limitExceeded` when the Collection has 129 Products. The request
rolls back, but the ordinary replacement path cannot scale past the 128
command-observed-identity budget. This is distinct from deleting the Collection:
its `set null` transition already pages references in the shared core.

The pinned `ProductModuleService.updateCollections_` updates Collection roots,
then asks `productService_.update` to detach Products selected by
`collection_id = root AND id NOT IN desired` and associate Products selected by
`id IN desired`. The pinned generic `MedusaInternalService.update` resolves
each selector with `list`, accumulates every entity/update pair, and only then
calls the repository. Consequently, making the adapter's indexed read page
larger or paging core materialization alone cannot fix the native heap and
working-set boundary. The service owns the meaning and ordering of replacement;
Flarex owns complete scoped selection, row/index/history/fact maintenance,
resource budgets, concurrency exclusion, and one settlement.

The selected 20-member witness publishes one Product `updated` event per
affected Product. The ordinary root event budget is 64 messages. The bounded
shared-event prerequisite permits an explicit trusted root selection of up to
256 messages, capped by any installed physical participant profile, and pages
publication within one transaction. The 129-member replacement must select
that budget at its trusted host and prove its native event count. Do not
coalesce native per-Product events merely to fit a ceiling; event count, bytes,
digest, delivery rows and the outer fact budget are independent resource
dimensions. Delivery claim cost and hot-shop lock time at higher fan-out still
need measurement before scale claims.

## Recommended contract and breaks

Introduce a narrow storage-neutral native Collection membership-replacement
port. For an admitted Collection update it records the root identity and the
ordered desired Product IDs without enumerating matching Products in the
framework service. The logical implementation seals a relation intent in the
request working set; only the trusted settlement owner executes it after
untrusted code and event capture finish. The full physical Product runner is a
named unported consumer and keeps its current generic selector path only until
its remaining Product methods move to logical storage. Bind the new port at
construction for the logical profile; never choose the physical path after a
logical refusal. Remove the old selector path and its service branch when that
runner retires, as tracked by the Product completion inventory.

Extend the shared indexed reference transition owner to perform replacement.
Under publication exclusion it verifies the declared nullable Product FK and
ready current-coverage index, selects the complete old membership by scoped
keyset pages, validates the explicitly selected Product IDs, and applies the
native detach-then-associate behavior through bounded ordinary logical row
materialization pages. An already selected Product is still an update if the
native selector update would update it; missing selected IDs retain the pinned
selector's no-match behavior. The plan must not expose a pre-transition
Product read to later native code: either the sealed operation forbids such
reads, as the delete transition does, or the core provides exact pending
visibility before admitting them. The current Collection method has no Product
read after its replacement call.

All derived Product changes, root changes, index/unique/history effects, exact
native Product and Collection event identities, one durable outcome and replay
evidence must settle at one commit sequence. The native service or declared
adapter policy supplies event meaning; a trusted core publisher derives the
affected Product IDs from the actual lowered rows. Neither the adapter nor
untrusted service may supply a claimed affected-row page. Admission must
authenticate the root, desired IDs, declared FK, events and any updated
Collection result. A later failure rolls back every page and event. Keep a
separate total affected-row, byte, statement and time budget; a page boundary
never defines successful completion.

The selected event boundary is after native execution has sealed and before
the event buffer closes. Under the shared scope lock, core can select the
complete bounded affected identity set, then let the admitted module event
policy capture the original per-Product event shape. Settlement must verify
that the identities it actually lowers match this locked selection. No
untrusted callback runs after the lock. Extend the shared event-message budget
only with an explicit measured total budget and paged/validated persistence as
needed; increasing the Collection adapter's allowance cannot override the
shared 256-message ceiling or physical profile limits.

This breaks private Collection repository/service and logical intent/event
contracts. It does not change native public Collection inputs/results, generic
physical row format or existing durable identities. Migrate affected callers,
remove displaced selection/update code and its bounded-overflow assumption in
the same connected slice. No data reset is authorized.

## Alternatives rejected and acceptance gate

Raising `identities` or the adapter `take` limit only postpones the failure and
retains full native enumeration. Adapter-side pagination either exceeds the
single working set or splits the operation into separate commits. Raw SQL skips
logical history, indexes, facts and recovery. Reusing delete-only `set null`
without a replacement intent loses selected Product updates, event semantics
and pending-read rules.

The first connected proof is the native single-Collection replacement with
more than 128 prior members and a non-empty desired set, including an existing
member, a Product moved from another Collection and a nonexistent selected ID.
Prove exact final membership, per-Product event IDs, one sequence, replay,
rollback after a late page, two-shop isolation and a concurrent reference
insertion on ordinary-role PostgreSQL. Run the same functional/failure path on
PGlite; distinguish its concurrency limits from PostgreSQL's. Preserve the
atomic overflow refusal above the measured total budget. Reconcile the pinned
native source guard, affected typechecks, lint, both read-only reviews and
cleanup before a scoped commit. Performance claims require measured fan-out,
row/index/fact amplification, lock time and hot-shop contention, not a single
passing fixture.

Multiple Collection roots with overlapping desired Product IDs require an
explicit order and duplicate-update contract; do not infer one from this
single-root proof or silently accept a partial batch. Keep that boundary
visible until its connected native witness is selected.
