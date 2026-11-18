# Core relational fan-out transition

Status: bounded same-sequence page materialization, authenticated indexed
reverse selection, sealed `set null` intent and ordered transaction-local
logical-commerce fact publication are implemented in the shared core. The
selected all-logical ProductType and ProductCollection deletion use that path
without adapter-side Product enumeration. The operation supports up to the
declared affected-row, byte and time budgets; broader relationship transitions,
large-document and hot-shop capacity, and pending reads after a plan remain
separate gates.

The explicit managed-update policy, born/delete target and read-only observed
source extension is implemented for its selected bounded profiles.
It supports the native ShippingProfile physical-detach boundary described below;
that status does not admit a new public API, arbitrary pending source writes or
broader fan-out capacity.

A separate eager nullable-reference operation is implemented for explicitly
selected logical participants. It provides current pending visibility for the
private native Shipping Option physical-delete profile described below. The
terminal `planSetNull` contract and its broader page-materialization budgets
remain unchanged.

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

The `LogicalDocumentChanges` arrays and per-request `rows`/`dependencies`
maps assume every command-observed identity fits in memory. The core stages
ordered derived facts in one transaction; changing only the read limit would
still be insufficient. The point-commit protocol caps one
materialization command at 128 rows, while the developer-index action budget is
256 revisions and `readBoundedCurrentAppRowsInTransactionEffect` caps one read
at 256 identities. `inspectLogicalCommerceActivity`, contribution validation,
`prepareDelta` receives one complete page; publication consumes ordered derived
batches without assembling a complete fact array. A larger future budget must
keep these coupled limits and exact event/attempt evidence aligned; it must not
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
without loading the range in one read. The 32-row page is a ceiling: core
reduces it from the source table's admitted unique-key count and the developer
indexes whose key or predicate can change when the reference and managed
timestamp columns change. The point materializer checks actual index actions
before writing each page. This avoids charging unrelated Product indexes for
revisions they cannot emit while retaining a conservative two-action allowance
for every affected index. The affected-row ceiling is
the lesser of 2,016 and 63 such pages, leaving one of the materializer's 64
pages for the root operation. Adding an index can therefore reduce the safe
synchronous fan-out without making an in-budget page fail halfway through.
With the current Product index set, the effective page is 32 rows and the
row-only ceiling is 2,016 references; bytes, time or another materialization
limit can refuse earlier. The native small-row Type witness has now reached
that ceiling on both local drivers under the 30-second command profile.
The current-index range scan selects its bounded
keyset page before joining revision metadata, so late pages do not join the
whole current range first.
The neutral `set null` operation uses the admitted row normalization policy to
preserve native fields, set the declared nullable FK to null and apply the
selected managed-update mode. Existing Product consumers select advance;
explicit preserve consumers keep managed timestamps. It builds ordinary
logical row intents page by page, requires the
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

The selected Type and Collection delete commands perform no Product read after
requesting detach.
Before exposing this operation to a command that does, core must provide
correct pending-read and pending-index visibility for the planned transition;
silently returning the pre-transition Product is not allowed. Preserve the
existing physical compatibility runner only for its named unported Product
methods until their logical cutover; do not add a physical fallback to the new
logical transition.

## Coherent implementation and acceptance gate

The private contract seals a declared `set null` intent only after an authentic
target deletion attempt. The selected extension admits a committed target or a
target genuinely born and deleted in the same root; a nonexistent target or an
invented delete remains invalid. It forbids later command reads or writes,
rejects matching source mutation attempts and borrowed source overlays, and
authenticates the exact nullable NO ACTION FK and root. Read-only source
observations retain their normal dependency validation and do not themselves
authorize a write. The publisher consumes the intent before making the Type
deletion visible.

### Explicit mode and native physical detachment

The [native ShippingProfile creation/inverse boundary](../flarexdb-framework-integration/preflight/135-native-shipping-profile-create-workflow.md)
exposed three limits of the former owner contract. A native physical Profile
delete can operate on a target created earlier in the same root, its real
business guard reads Option references before deletion, and its DAL detaches
nullable Option FKs without advancing Option timestamps. The former committed-
target requirement and observation exclusion refused those valid shapes; its
fixed advancing normalization did not preserve the native child afterimage.

The correction replaces the private allowSetNull flag with
`setNullPolicy:{managedUpdate:"advance"|"preserve"}`. Trusted preparation binds
that policy to canonical profile/replay identity, and every sealed intent and
activity record carries its required mode. Issuance, closure and publication
must agree with the selected mode; command input cannot choose a different
policy. Product type/collection consumers migrate explicitly to advance, while
the Profile consumer selects preserve. Reference-replacement authority remains
independent; selecting one operation does not grant the other. No parallel
obsolete boolean policy is retained.

Core retains actual deletion-attempt authority for born/delete targets even if
the final row state coalesces away. Read-only committed reference observations
are admitted without treating caller-supplied identities as the affected range.
Matching source mutations, including pending insert/delete attempts or borrowed
overlays, remain refused, and the plan remains terminal for subsequent command
reads/writes. Supporting arbitrary pending reference writes or post-plan reads
requires a separately proven visibility contract.

Preserve mode changes only the declared FK in each selected native row. It keeps
managed timestamps and the other scalar fields, while ordinary core revision,
index/unique, history, fact and recovery effects still occur at one accepting
sequence. Framework event policy remains with the native adapter; core must not
invent child update events. The physical schema FK stays NO ACTION because this
is an explicit operation, not an automatic schema-wide delete action.

Complete historical reverse selection remains with the indexed shared owner
under the scope publication lock. An adapter's smaller native validation cohort
does not cap that range or excuse truncation. Existing reference/materialization,
affected-row, byte, time and fact budgets still govern the complete derived
closure; they have not been widened by this policy correction. Mode binding,
wrong scope/root/FK, immutable observations, same-root target history, rejection
of unsupported source overlays, concurrency and existing advance consumers need
owner and consumer validation for each additional selected profile. The current
ShippingProfile consumer uses preserve mode, while the existing Product Type
and Collection consumers retain advance mode. This does not admit arbitrary
pending reference visibility or widen fan-out capacity.

The publisher writes compact derived row identities after each lowered page
inside the same uncommitted transaction, enforces the materializer's
2,048-row/64-page budget and the atomic host's fact allowance together, then
finalizes one commit prefix, outcome, events and clock advancement. No
adapter-supplied affected-row list is accepted.

1. Complete the inventory of logical row, index, unique, revision, attempt,
   dependency, publication and recovery writers that consume a closed working
   set. The shared materialization batch budget is 2,048 changed identities,
   64 pages and 4 MiB of final document bytes; the relation-transition owner
   still needs its separate read, total work, statement and time budget.
2. Implement and test a neutral declared `set null` transition with indexed
   reverse selection, complete membership, rollback and concurrent insert or
   delete conflict. Keep one outer settlement authority.
3. The native Type delete uses this operation without adapter-side Product
   enumeration. The selected witnesses cover 128 referencing Products, exact
   null detach, row/index/history/fact consistency, event/outcome replay,
   two-shop isolation and rejected receipt rollback on both drivers, plus
   overlapping reference insertion on ordinary-role PostgreSQL.
4. The selected Collection delete also uses the same nullable-reference owner;
   other declared module-local transitions, including Option-owned Value/pivot
   deletion, remain future cutovers.
   Remove displaced lifecycle loops and any obsolete resource assumptions in
   the same connected implementation slices.

This preflight changes private core contribution and adapter DAL contracts as
needed. It does not change public Medusa APIs or authorize a data reset. A
Capacity refusal remains explicit above the declared budget; a performance
claim requires bounded multi-shop and hot-tenant measurements.

## Eager deleted-reference visibility

The [native Shipping Option reference-detachment profile](../flarexdb-framework-integration/preflight/142-native-shipping-option-reference-detachment.md)
uses `detachDeletedReference` when native deletion must become visible before
its outer module call returns. Trusted participant preparation explicitly
selects `detachDeletedReferences:true`, captures it immutably and binds it to
replay identity. Omission preserves existing profile identities and grants no
eager capability. Both endpoint tables must belong to the calling member's
write mechanics; the existing metadata owner authenticates the exact nullable
scalar NO ACTION FK. Installing the source schema alone grants no operation.

Deletion and detachment must occur within the same outer module call. Core
selects complete indexed current source membership, including historical rows
and pending inserts, patches, repoints and deletions, then applies ordinary
FK-only patches with managed updates preserved. Later reads and writes observe
the detached values. A target born and deleted in the root is admissible;
recreating its key later does not reattach previously detached sources. A later
real deletion can detach newly attached sources, while a still-present target
replacement refuses the operation.

Each patch retains causal evidence issued by the existing root/attempt owner.
Contribution validation authenticates its exact source preimage and afterimage,
real target deletion, scope and both attempt ordinals. Call-local activity
rebases the authenticated ordinals together. A plain marker, another call's
deletion or an invented final absence supplies no authority. The source's
other fields, timestamps, deletion state and insertion generation remain
unchanged; ordinary coalesced row revisions, indexes, history and durable facts
settle through the existing publication owner. Framework events remain with
the native adapter.

This operation uses existing selection, working-set, call, byte and publication
limits. Complete-cohort overflow refuses the whole root; it does not borrow the
terminal transition's derived-fact allowance. Existing `planSetNull` modes,
matching-source restrictions and terminal read/write guards remain intact.
Independently durable borrowed journals do not admit eager detachment until
their journal/lifetime proof exists. Public and hosted activation, populated
source upgrades, broader native profiles and general fan-out capacity remain
separate gates.

## Remaining scale gate

The former 512-row/16-page publication ceiling no longer governs Type and
Collection deletion. The shared publisher now inserts a provisional commit
header after untrusted work has closed, appends each lowered page's ordered
revision-bound facts inside the same transaction, and finalizes the header,
event, outcome and clock only after every page succeeds. Its private writer
enforces contiguous ordinals and one finish; the fact table's foreign and
unique constraints bind exact revisions and reject duplicate identities.
Any failure rolls back the provisional header and all pages. Application and
Payload one-shot commits still use this publisher with their known fact count,
without an extra header update. The 128-row point materializer and 256-entry
per-page index-action limits remain unchanged.

The selected native Type path has a 2,016-Product deletion witness beyond the
former 882-row index-cost ceiling and retains
rollback after several staged fact pages, one event and replayed outcome.
It also refuses a native Type deletion when large referencing Product documents
exhaust the transition's byte budget after fact pages have been staged; the
whole attempt rolls back without detaching Products or deleting the Type.
That larger witness selects the existing 30-second logical-command profile;
the default 10-second request deadline can refuse a large delete earlier.
The current **at-most-2,016-reference, 4 MiB read, 30-second scan** limits remain
operational safety budgets, not general parity or production performance
claims. The effective reference ceiling also depends on the admitted source
index and unique-key cost per page. A shop can legitimately exceed it; a
refusal must remain atomic.
Before staging a nullable-reference transition, the shared index owner probes
at most the effective row ceiling plus one entry under the same scope
publication lock. An over-budget range returns `limitExceeded` with a
`LogicalReferenceCapacityError` cause identifying `affectedRows`, the effective
maximum and a lower bound on the observed count. It does not lower any Product
page or publish a partial Type deletion. Byte, materialization and time
budgets still apply while processing an admitted range; the probe is not an
unbounded count or a promise that every under-ceiling operation succeeds.

An opt-in native Type capacity run with 2,016 small Products completed on local
PGlite in 25.8 seconds and ordinary-role PostgreSQL in 12.2 seconds for the
delete command. Each produced 2,017 row revisions, 8,068 index revisions,
2,017 fact rows and about 1.25 MiB of final document bytes at one commit
sequence; replay retained that outcome. These are single local runs, not a
latency guarantee. PGlite is close to the 30-second profile, and the existing
large-document witness refuses atomically below the row ceiling. The opt-in
count is `FLAREX_FANOUT_CAPACITY_COUNT=2016` for the native Type suite, so
ordinary suites keep their shorter boundary cases. Hot-shop contention,
many-scope fairness, WAL/recovery cost and a supported larger-operation
visibility policy remain open acceptance work.
The materializer's 2,048-row/64-page and 4 MiB final-document budgets, and the
atomic host's fact allowance, are separate guards. A root with many own changes
may reach those guards before the reference limit.

Before selecting a larger synchronous budget, measure representative fan-out,
row/index/fact amplification, transaction duration, lock contention and
recovery cost on ordinary-role PostgreSQL, including a hot shop among many
scopes. Extend the shared relation, materialization and publication owners
only when those measurements support the new budget; do not move overflow to
a Medusa-specific loop. The same mechanism serves Collection and neutral
nullable references. If a product requirement exceeds a safe single-transaction
budget, a separately decided durable, resumable operation needs an explicit
visibility rule and native-semantic contract. Independently committed pages
must not masquerade as one atomic Medusa delete.
