# Core relational fan-out transition

Status: bounded same-sequence page materialization, authenticated indexed
reverse selection, sealed `set null` intent and production logical-commerce
publication are implemented in the shared core. The selected all-logical
ProductType deletion uses that path without adapter-side Product enumeration. It
supports up to the declared affected-row, byte and time budgets; broader
relationship transitions and pending reads after a plan remain separate gates.

## Trigger and ownership

Native ProductType deletion detaches each Product with the deleted `type_id`
before removing the Type. The former adapter path read a capped referencing
page and reached the 128 observed-identity limit at high fan-out. The selected
logical path now seals the root deletion and lets core select and detach
referencing Products during one settlement. The same structural limit can
affect Collection detachment, Option deletion with many Values and Variant–Value
pivots, Product graph cascades and future cross-framework
relationships; fixing only the Type adapter would retain the wrong owner.

The accepted [fan-out contract](../../design-notes/flarexdb-shared-logical-storage.md#bounded-high-fan-out-relationship-transitions)
places complete reverse selection and atomic maintenance in shared relation and
transaction ownership. The Medusa service still decides to delete a Type and
which native events to emit. Core decides how a declared nullable reference is
changed and settles all derived storage and recovery evidence.

## Challenged alternatives and recommended direction

- Raising `identities` from 128 to a larger constant postpones the same failure
  and scales heap, facts and lock time with fan-out. It is useful only as a
  measured resource setting, not the relationship design.
- Paging in `product-lifecycle.ts` under the current working set still hits its
  total identity bound. Committing pages separately exposes partial detach and
  changes the native transaction contract.
- A generic SQL `UPDATE` on opaque stored documents skips revision history,
  index/unique maintenance, facts and settlement recovery.

Design a core-owned relational transition operation compiled from authenticated
logical FK metadata. It selects a complete, scope-confined reverse key range
with stable keyset progress; applies bounded batches within one trusted
transaction; records the same row/index/unique/history/fact effects as ordinary
logical writes; and validates membership against concurrent reference changes
before one commit/publication. Keep a separate total affected-row/time/byte
budget. If that budget is exceeded, roll back the entire operation with a
capacity error. Do not promise an unbounded single transaction.

The current `LogicalDocumentChanges` arrays and per-request `rows`/`dependencies`
maps assume every changed identity fits in memory. The implementation preflight
must choose a bounded transaction-local accumulation or staging representation
that preserves their validation, retry and recovery semantics; changing only
the read limit is insufficient. The current point-commit protocol caps one
materialization command at 128 rows, while the developer-index action budget is
256 revisions and `readBoundedCurrentAppRowsInTransactionEffect` caps one read
at 256 identities. `inspectLogicalCommerceActivity`, contribution validation,
`prepareDelta` and publication all currently receive complete arrays. A
replacement must reconcile these coupled limits and consume bounded batches
under one publication, including exact event/attempt evidence; it must not
merely widen the working-set map. The trusted owner must not hold a transaction
while calling untrusted code, pausing a workflow or performing remote effects.
Cross-owner changes require an explicit source-owner policy, so the first
implementation witness is a module-local nullable reference.

## Selected execution boundary

The first transition is an explicit, authenticated module-local `set null`
intent for a declared nullable source FK. The native service may request that
transition and delete its root, but it cannot supply a page of affected rows or
storage handles. Core checks the admitted source and target table identities,
the exact FK columns, nullability, and same-source ownership. The current
`noAction` FK is not silently reinterpreted as a schema-wide automatic action:
Medusa's Type service explicitly detaches Products, while other consumers may
legitimately require restriction. This is a private core/adapter contract break,
not a change to native Medusa's public delete API.

The intent alone must not authorize the Type delete at working-set close or
publish a native event. After the untrusted command and event capture have
finished, the trusted settlement owner takes the scope publication lock,
validates ordinary observed dependencies, and selects the *then-current*
reverse index range with scoped keyset pages. A reference committed before
that lock belongs to the transition; a conflicting writer settling after it
must validate against the removed target. Core applies each page with shared
row/index/unique/history materialization under one transaction and one commit
sequence, then verifies that no matching reference remains before lowering the
root deletion and publishing one outcome. A late page, validation, or
publication failure rolls back all pages. This ordering keeps a complete
membership decision at the actual settlement point rather than treating an
earlier capped request page as authoritative.

The shared reverse selector checks a declared nullable same-source FK, an
enabled current-coverage index and each bounded current row under the scope
publication lock. Its multi-page Product Type witness reaches 144 references
without loading the range in one read. The 32-row page and 480-reference
total leave one of the materializer's 16 pages for the root operation.
The neutral `set null` operation uses the admitted row normalization policy to
preserve native fields, set the declared nullable FK to null and update managed
timestamps. It builds ordinary logical row intents page by page, requires the
trusted caller to lower each page, then rejects any matching reference left in
the current index. A multi-page fixture proves 144 derived Product changes at
one sequence and rollback after a late injected failure. Native Type deletion
now seals this transition for the existing commerce publisher to settle with
the root and native event in one transaction.

Use a bounded total affected-row, byte, statement and time budget independent
of the page size. Keep at most one decoded page and its materialization state
live at once; retain only resource-accounted compact row identities and event
proof needed by the single publication. The shared materializer now admits
explicitly selected bounded pages at one commit sequence and defers index and
unique coverage watermarks until the batch is complete. Repeating the old
one-shot lower without that deferral fails the next page's coverage validation.
The closed logical change set carries sealed transition intents. Settlement
lowers derived pages and the root under one commit sequence, retains compact
row identities for the publication prefix, and rejects unadmitted intents.
The Type event validator authenticates the root event and sealed intent; core
derives the Product changes from committed rows and the declared nullable FK.

The selected Type command performs no Product read after requesting detach.
Before exposing this operation to a command that does, core must provide
correct pending-read and pending-index visibility for the planned transition;
silently returning the pre-transition Product is not allowed. Preserve the
existing physical compatibility runner only for its named unported Product
methods until their logical cutover; do not add a physical fallback to the new
logical transition.

## Coherent implementation and acceptance gate

The private contract seals a declared `set null` intent only after its committed
target row has been selected for deletion. It forbids later command reads or
writes, rejects pending source-row overlays, and authenticates the exact FK and
root. The publisher consumes the intent before making the Type deletion visible.

The publisher gathers compact derived row identities after lowering all
bounded pages, enforces the materializer's 512-row/16-page budget and the
atomic host's fact allowance together, then writes one commit prefix, outcome,
events and clock advancement. No adapter-supplied affected-row list is accepted.

1. Complete the inventory of logical row, index, unique, revision, attempt,
   dependency, publication and recovery writers that consume a closed working
   set. The shared materialization page budget is 512 changed identities,
   16 pages and 4 MiB of final document bytes; the relation-transition owner
   still needs its separate read, total work, statement and time budget.
2. Implement and test a neutral declared `set null` transition with indexed
   reverse selection, complete membership, rollback and concurrent insert or
   delete conflict. Keep one outer settlement authority.
3. The native Type delete uses this operation without adapter-side Product
   enumeration. The selected witnesses cover 128 referencing Products, exact
   null detach, row/index/history/fact consistency, event/outcome replay,
   two-shop isolation and rejected receipt rollback on both drivers, plus
   overlapping reference insertion on ordinary-role PostgreSQL.
4. Apply the same owner to other declared module-local transitions when their
   existing consumers move, including Option-owned Value/pivot deletion.
   Remove displaced lifecycle loops and any obsolete resource assumptions in
   the same connected implementation slices.

This preflight changes private core contribution and adapter DAL contracts as
needed. It does not change public Medusa APIs or authorize a data reset. A
Capacity refusal remains explicit above the declared budget; a performance
claim requires bounded multi-shop and hot-tenant measurements.
