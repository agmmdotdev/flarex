# Native Price List Price update preflight

## Status and executing source

Status: implemented as a bounded private atomic workflow admission, including
the explicitly approved complete native compensation correction, candidate Rule
ordering and named resource allowance. Separate native witnesses and portable
checks cover complete Price/Rule restoration and committed composition on both
database lanes. The unchanged original compensation defect remains preserved
separately. Product chunked
file import and Product export remain deferred.

Authority remains the accepted Medusa boundary, the source promotion contract
and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
`third_party/medusa/SOURCE.json`. This follows the implemented
[Price List Price creation](./155-native-price-list-price-creation.md) slice.

Pinned paths below are relative to `third_party/medusa/upstream/packages/`:

- `core/core-flows/src/price-list/workflows/update-price-list-prices.ts`
  runs both existing validators in parallel, then the update step.
- The adjacent `steps/update-price-list-prices.ts` maps raw Variant IDs to stored
  PriceSet IDs, reads supplied Price IDs with `price_list`, invokes Pricing
  `updatePriceListPrices`, and retains data for its public update inverse.
- `modules/pricing/src/services/pricing-module.ts` owns candidate selection,
  normalization, hash matching, List validation and native graph upsert. This
  operation can reuse or create Prices; its name does not imply an existing-only
  patch. The approved creation-slice DAL corrections remain distinct from any
  proposed change to this workflow.

The original closure needs Pricing `listPriceLists`, `listPrices` and
`updatePriceListPrices`, plus the same genuine stored Variant-PriceSet Link Query
used by creation. The Query remains Link-only; no Product hydration, Region,
File, provider or hosted bootstrap dependency is needed.

## Native compensation defect

The step's existing-Price loop obtains an array for each List but never appends
the Price. Independently, `Object.entries(priceListPricesMap)` enumerates a Map
as an ordinary object and produces no entries. Nonempty successful updates
therefore retain an actual empty inverse array. Cancellation returns without
calling Pricing.

The unchanged original callback and original DAL witness changes the same Price
from `40` to `88`; cancellation reports `reverted` while storage remains `88`.
The native retained payload is `[]`, and no public inverse update occurs. SDK
state alone is not restored-data evidence. The original result must remain
separate from any corrected candidate.

Fixing both grouping statements alone does not establish complete compensation:

- The original preimage read requests only `price_list`; it omits PriceRules.
  Native serialization exposes a PriceSet reference ID, but does not implicitly
  populate Rules.
- `core/utils/src/pricing/builders.ts` converts Rules to an attribute/value map.
  That representation loses Rule identity, operator multiplicity and priority.
- Public update normalization can replace supplied Rule data and rematch Price
  IDs against current candidates. It cannot be assumed to restore original
  identities after Rule replacement or matching-key changes.
- Supplied IDs alone miss omitted-ID reuse. An old-only inverse cannot remove a
  genuinely newly created Price. Cross-List IDs and duplicate response positions
  also need explicit preimage and actual affected-ID proofs.

The correction belongs to native workflow compensation and native Pricing
ownership. Adapter snapshot reconstruction, direct SQL or a whole-root rollback
substitute would not repair the native retained inverse.

## Approved connected correction

The owner explicitly approved this native business-behavior correction.
Forward validators, input mapping, candidate matching, normalization, graph
upsert and genuine events remain native.

1. Add native Pricing `snapshotPriceListPricesForUpdate(mappedUpdateInput)` for
   the mapped update input. Reuse the existing candidate-selector owner and
   include raw supplied IDs globally, so cross-List updates and omitted-ID reuse have complete old
   coverage. Capture detached Price graphs, complete active and historical
   Rules, original IDs, scalar foreign keys, numeric companions and managed
   fields. Native historical population and serialization must be proved;
   omitted relations cannot mean empty relations.
2. After the actual update succeeds, partition unique actual affected/returned
   Price IDs against that complete before map. Retain old graphs only for
   affected existing roots, and separately retain genuinely inserted IDs.
   Raw selector multiplicity and response positions are not inverse authority.
3. Add native Pricing `restorePriceListPrices({ before, createdPriceIds })`
   under one existing module transaction. Use the existing internal Price
   deletion owner for genuinely inserted IDs, then existing `upsertWithReplace` with
   `price_rules` for complete old graphs. Use the same shared context and native
   event owner. Avoid inverse re-normalization, copied matching algorithms,
   adapter restoration and a generic restore framework.
4. Retain these ordinary business snapshots through the real SDK. The closed
   native callback owns which preimages and inserted IDs its inverse restores.
   Adapter admission binds the named workflow/module resources and validates
   actual calls, snapshots, writes and events. The shared storage owner must
   independently prove complete recorded row values; structurally valid
   caller-supplied managed fields do not authorize historical writes.

Replace the broken Map preimage assembly and lossy builder in the corrected
step, and retain the new snapshot payload in its genuine `StepResponse`.
The two new native methods are private-fork resources for this named workflow;
they do not grant general module access.

Generated public Price update is not an equivalent graph restore: its current
repository path updates existing active rows with object merging. The corrected
native inverse uses internal deletion and graph upsert, replays raw numeric
companions and avoids public update normalization.

## Corrected native evidence and limits

The separately labeled corrected producer executes the approved Pricing
snapshot/restore methods and corrected step, while preserving the original root
and validators. Its native-source substitution is distinct from the approved
creation-slice DAL substitution; neither changes the immutable upstream
comparison files.

The 30-case corrected witness proves complete seven-table restoration for all
23 explicit inverses, including old Price and Rule identities, historical
members, numeric companions and managed fields. It also proves the real child
inverse on late parent failure and committed composition
`40 → 77 → 88 → 77 → 40`, with no second inverse on repeat cancellation.
Native refusals remain observations rather than repaired successes. SDK state
alone is never the restoration proof.

Authoritative external evidence is under
`%TEMP%/flarex-156-native-price-list-prices-update-witness`: corrected report
`approved155-native-price-list-prices-update-corrected-compensation-v1-postgres-runs/2026-10-20T15-22-02.126Z-14928/report.json`
(SHA-256 `0e1ff5e1b737df9f2410b734b1f6519707bd04bcec643488542e621f5710dfb3`)
and `audit.corrected-full30-v4.json`
(`fd4c5e0edd43974fee2bfa1d1be1f87b0b3c921358d0deb0a45a51b1c936f6af`).
The audit binds actual source and emitted artifacts, native call ancestry,
retained SDK payloads, actual affected-ID partition, complete history and
same-List sibling protection. Its optional ORM projection omissions remain
explicit; this is not universal DTO, SQL-order or portable atomicity evidence.

A separate authenticated five-case supplement proves four Lists/eight
Prices/sixteen old Rules, maximum late-parent cancellation, same-attribute
`gt`/`lt` Rules with priorities `5`/`9` and historical membership, and custom raw
precision `30` with nullable quantities. Every branch restores the complete
seven-table preimage through the real inverse, including the child inverse
inside the maximum late parent. Native setup uses genuine generated methods;
stored values, active/history membership and setup continuity are independently
checked before workflow execution is assessed.

Its report is
`approved155-native-price-list-prices-update-corrected-supplement-v2-postgres-runs/2026-10-20T16-05-43.001Z-12744/report.json`
(`d74d95c6b7d7141ccd0363637ccaaf13d87e731b0968bd2e92193517805d21e9`),
with `audit.corrected-supplement5-v4.json`
(`04ad7426a2cbdd55e1356165b1bc55a79fd1e0f495a23f8684aa3528bef6dddf`).
Complete per-step SDK output and compensation captures bind the actual retained
owner even where optional aggregate context detail is bounded. Required
workflow inputs, snapshots and native call proofs remain complete.

The native maximum captures 38 emitted messages in its ordinary forward and
38 in its later inverse; the combined late-parent phase captures 68. These are
actual native vectors, not portable adapter resource demand or a transferred
allowance. Portable transaction-covered compensation and rollback must be
validated through their own owners.

## Approved scoped candidate Rule interpretation

The native candidate query orders Price roots by ID. The Price `hasMany`
PriceRule relation declares no child `orderBy` or fixed-order contract; the
separate complete snapshot Rule read orders by ID and cannot establish the
candidate Collection traversal. Native `hashPrice` joins the actual
`price_rules.map` attribute/value sequence. Reordering that candidate sequence
can change implicit matching even when the stored Rule membership is identical.

A separate two-case witness creates Rules through native `createPriceRules`
in order `prule156-z-first` then `prule156-a-second`, with attributes
`first156`/`second156`, equal operators and priorities `0`/`1`. Both cases have
the same active USD Price with finite quantities `1`/`9`; both omit Price ID
and request amount `77`. They differ only in the input Rule object's property
order. The observer explicitly reads the already-initialized native Collection
through its real `getItems` and `map` immediately before unchanged native
normalization, with the same candidate references and no observer SQL.

Both actual Collections traverse `z-first → a-second`, rather than lexical ID
order. Input `first156 → second156` reuses the old Price; reversed input
`second156 → first156` creates a fresh Price. The native scalar getters and
field presence are captured separately from opaque ORM descriptor evidence.
Both actual inverses restore all seven tables exactly. This proves these two
executions; it does not establish universal database row order, distinguish
every possible insertion/priority ordering, or approve a portable ordering
change.

Evidence in the same external packet is
`approved155-native-price-list-prices-update-matching-order-v1-postgres-runs/2026-10-20T16-31-58.282Z-16284/report.json`
(`a1e4670fee74639bfcf8da923263acb81f897095ba444da4b5654d9e0d599924`)
and `audit.matching-order2-v3.json`
(`fc21fda9c953933bc294fe8407e773e638624004dc2beaa8e1ba1b7aa3602eef`).
The audit binds the actual setup, raw input property order, initialized getter
and member references, native returned IDs, compensation and protected state.

The owner explicitly approved the scoped portable contract: present this named
156 admission's candidate Rules in authenticated storage-insertion order through
the existing logical ordering owner. Keep candidate Price root ID order, raw input Rule
property order, native normalization/hash, snapshot history and its independent
ID ordering, output reconstruction and inverse semantics with their owners.
Do not sort the input, substitute supplied IDs for native matching, or copy a
hash algorithm. Other admissions receive no ordering change.

This approval selects a finite deterministic portable interpretation compatible
with the observed traversal; it does not claim an upstream universal
insertion-order promise. The source-isolated original and observed native
witnesses remain immutable. The scoped implementation requires separate
validation of both omitted-ID input orders through the genuine workflow on both
database lanes, including actual reused/fresh outputs and exact compensation.
An explicit-ID-only fixture change would not establish this workflow branch.

## Shared recorded-value proof and identity

The native business correction does not authorize reuse of retired Application
identities. The scoped shared operation is owned by
[recorded framework row replay](../../shared-logical-storage/69-recorded-row-replay.md),
which implements the bounded recorded-value operation. A trusted, explicitly
selected participant may replay a complete row only when the storage owner
proves every business and managed field against actual admitted current,
pending or retained history. Plain SDK JSON is not a signed issuance capability;
the native callback authorizes its business inverse, while core proves recorded
content and preserves schema, constraints, dependencies and resource limits.

Live rows retain their internal identity. An authenticated pending deletion in
the same root may reuse that internal identity. A committed physical tombstone
retires its Application ID: restoring the same native Price or Rule ID and
managed values requires a fresh internal insertion, leaving the original
tombstone/history intact and issuing a new protected insertion generation.
Application `_id` and `_creationTime` remain server-owned. Native managed
timestamp restoration does not override this identity rule.

Admission is through the Flarex atomic profile. The native comparison executes
sequentially; it does not admit standalone concurrent native execution. Its
snapshot and forward calls do not share a protected snapshot-to-write boundary,
so an independent native writer could change candidate membership and invalidate
the affected-minus-before creation partition. Standalone concurrent support
requires native Pricing ownership of that boundary and remains outside this
admission. The portable host retains its existing read dependencies, conflict
checks, rollback and singular settlement.

Both database lanes must prove the core recorded-value and tombstone rules,
then the graph consumer and complete native workflow. Failed or caught replay
attempts must publish nothing. Bounded history exhaustion refuses the inverse;
indefinite history retention and arbitrary concurrent-write rewind are outside
this slice.

## Admission and validation gates

Preserve original source, original outcomes and separate corrected and
approved-DAL results. The portable implementation must prove actual old Price
and Rule IDs/content, all seven stored tables, same-List unselected siblings,
event vectors, and complete retained callback execution.
Required branches include missing/omitted IDs, fresh/reused mixtures, cross-List
IDs, duplicate IDs and List entries, Rule replacement/omission/empty records,
historical rows, numeric presence/nullability and changed matching keys.

Committed composition must prove `40 → 77 → 88`, cancellation of the second
root back to `77`, repeat cancellation without a second inverse, then
cancellation of the first root back to `40`. A late parent failure must execute
the real child inverse. This does not establish arbitrary concurrent-write
rewind or external event delivery.

Reuse the creation slice's native planner, queued root and borrowed operations,
shared graph/query owners and complete receipts where their contracts apply.
New read, snapshot and compensation boundaries require their own exact native
contracts; the creation normalized-input schema is not a full preimage decoder.

The admitted forward grammar is zero to four List entries, two Prices per entry
and two raw Rule attributes per Price, with text bounded to 256 characters and
up to eight raw Variant selectors over four stored Link endpoints. Complete
candidate and historical cohorts must fit the existing read and materialization
bounds. Empty Rule records retain the private invalid-input refusal. Maximum
graphs and retained inverses have separate portable coverage; the creation
slice's inverse ordering does not transfer to this profile.

The owner separately approved the named `priceListPriceUpdateResources`
allowance for this 156 forward root and its retained inverse: `calls: 128`, with
`eventMessages: 64` and every other limit unchanged. The original 64-call
maximum failures on both database lanes remain preserved. This allowance uses
the existing identity-bound host/resource owner; both Pricing and Link bind the
same named resources, and the root call limit matches. Caller-selected resource
overrides and transfer to other admissions remain refused. Complete receipts,
resource ceilings, events and rollback remain enforced on both adapter lanes.

General removal and batch roots remain separate admissions. Standalone native
concurrency, arbitrary history retention, hosted activation and external event
delivery remain gated. Successful bounded executions do not establish load or
timeout reliability under the ordinary PostgreSQL statement limits.
