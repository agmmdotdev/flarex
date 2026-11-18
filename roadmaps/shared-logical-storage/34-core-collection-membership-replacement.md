# Core-owned Collection membership replacement

Status: selected single-Collection replacement implemented under the standing
shared-storage completion approval. The bounded shared-event and delivery
prerequisites and connected core/native replacement are implemented. Multiple
roots and operations beyond the admitted resource budgets remain separate gates.

## Current selected result

The logical Product host binds a private Collection replacement port into the
pinned service. The service supplies the root and desired Product IDs; the
adapter seals one declared nullable-reference intent without enumerating old
members. After publication exclusion, shared core selects the then-current
scoped membership and desired existing Products through authenticated indexes,
lowers detach and associate pages with ordinary row/index/unique/history
maintenance, derives exact Product event IDs, and publishes one outcome and
commit sequence with the Collection root event. A late page failure rolls back
the entire operation on PGlite and ordinary-role PostgreSQL. The selected
129-member path, small replacement after an
unrelated Collection update, two-shop separation and overlapping reference
insertion are connected witnesses on the supported database lanes.
The selected update preserves duplicate `product_ids` as one desired member
and publishes each detach and associate phase in ascending Product ID order,
matching the pinned native selector's set and ordering behavior.

The source-bound reverse selector now uses the shared table-write-frontier
coverage proof: an unrelated Collection commit does not invalidate a Product
index. Before multi-page materialization, shared index and unique owners record
that proved baseline so the transaction's own first page cannot be mistaken
for an uncovered committed Product write on its next page. A real Product
write beyond coverage still refuses. The physical full Product runner remains
the named consumer of the generic selector path for unported methods; it is
removed with that runner, not used as a fallback after a logical refusal.

The selected operation remains bounded by 256 total root/derived messages,
the separate relation transition and materialization budgets, and one root
per command. Those ceilings are safety limits, not a general high-fan-out or
hot-shop performance claim. The measurement and multi-root gates below remain.
Derived Product messages use a core-owned exact ID-only event contract. A host
must explicitly select captured-only global validation for this profile: its
callback validates the root family before exclusion, while core validates the
derived family from committed row IDs and static metadata under the lock.
Arbitrary callback predicates over the combined family are not admitted to
this profile because they would require executing caller code after exclusion.

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
need measurement before scale claims. The shared
[delivery batch correction](./35-core-event-delivery-batches.md) prevents one
complete family reread per claim; it does not prove handler throughput.

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
keyset pages, filters to active Products as the pinned Collection selectors do,
validates the explicitly selected active Product IDs, and applies the
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

The existing atomic root closes and validates its event buffer in
`closeContributions` **before** `finalizeCommerceCommit` acquires publication
exclusion. Its publisher must therefore gain a narrow deferred-event contract:
the framework finishes, seals a replacement intent and emits its Collection
root event, while a trusted declarative policy reserves Product `updated`
events derived from core-owned affected rows. The pinned native mutation
subscriber builds these Product events from entity IDs; the policy must capture
its exact contract, metadata and order without running the live Medusa service,
an adapter callback or arbitrary decoder under the publication lock. The
ordinary event buffer remains single-use and cannot be reopened by the adapter.

After acquiring publication exclusion, core selects the complete old
membership and explicitly selected existing Products through authenticated
indexes, including their then-current `collection_id`. That selection is the
authority for both bounded replacement pages and derived Product event IDs.
Core validates the total event count and bytes, combines the root and derived
messages, computes the digest and writes the publication prefix before lowering
rows. It then verifies that the actual lowered Product identities and update
multiplicity equal the selected event identities; any mismatch or late failure
rolls back the prefix, rows, outcome and events together. A reference committed
before the publication lock belongs to the selection. A competing writer after
it must validate against the new state. No framework callback runs after the
lock and no request-time preview claims to be authoritative.

This requires splitting logical receipt validation: before publication, prove
the native root call, Collection row attempt, sealed intent and root event;
inside trusted settlement, prove the derived Product changes and event family.
Do not fabricate Product attempts in the request working set or weaken the
existing ordinary Collection receipt. Event capacity bounds the selected set
independently of row, byte, statement and time budgets. The selected 129-member
operation needs one Collection event plus its exact native Product events
within the trusted 256-message ceiling and any installed physical profile cap;
a larger operation must refuse atomically unless all coupled budgets are
deliberately extended and measured.
The first admission rejects an overlapping pending Product mutation in the same
working set; otherwise the locked committed selection could omit an in-request
membership change.
Composed replacement after another Product command needs its own pending-state
contract and connected proof before admission.

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
