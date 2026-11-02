# Authenticated native restoration through retained Core history

Status: **Independent current/design/Convex challenge and provenance/history
counterexample reconciliation complete. Authenticated history/restoration,
live-floor checks and their scoped adversarial and connected consumer proof
are verified; required review is complete. Wider retained-data cutover and
full-goal gates remain open.**

Baseline: `d31c5df21ea79ba63e25dc4e1d9814361396611a`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
This is the shared prerequisite of [complete Pricing maintenance](./21-native-pricing-maintenance-workflows.md).

## Native obligation and present refusals

The executing promoted Price update snapshots complete detached Price/Rule graphs,
retains only actually affected old roots and distinguishes genuinely inserted
Prices. Its inverse uses native restore/upsert-with-replace, preserving business
IDs, raw numeric companions, managed fields and historical children. Whole-root
rollback is not equivalent to an explicit retained inverse after commit.

The baseline Core native configuration rejected `allowRecordedRowReplay` and
preserving-deletion upserts. The replacement supplies selected replay through
Core history and transaction owners. The old shared working-set owner proved
recorded content through actual pending/current/attempt bodies or bounded
native-key index history plus canonical revisions. Its contract 69 and preflight
156 remain behavioral requirements, not instructions to retain that engine.

## Value proof and destination identity

The closed native callback owns which business inverse to request. Plain SDK
compensation JSON is not issuance authority. The storage owner independently
proves every supplied field against genuine admitted source/schema data.
No timestamp validation, default filling, shaped DTO or hash alone proves history.

Reuse the existing transaction's immutable first originals, pending final bodies,
same-root deleted bodies and successfully staged before/after native activity.
Do not copy activity arrays into another ledger. Failed mutation evidence unwinds
with existing pending rollback; observations, charges and issued IDs retain their
existing ownership.

Find the current unique business-key destination independently of the proving
revision. A live destination keeps its internal ID and first committed original.
One authenticated same-root pending deletion may reuse its internal identity.
Otherwise restoration inserts through the existing server ID/time owner. A
committed Source tombstone never authorizes internal ID reuse; the same native
business ID and exact managed values can restore under a fresh internal ID.
Retired history remains immutable. Multiple recorded generations may prove values
without becoming destinations; conflicting reusable destinations and a live
proving generation with a changed native key refuse.

This follows pinned `writes.rs:313-337,423-440` and
`committer.rs:1628-1681`. Preserve current-destination OCC and all final uniqueness,
FK, protected-relation and accepted-predecessor validation. Soft-deleted but
physically present native endpoints retain ordinary FK presence; physically
missing endpoints remain invalid. Do not synthesize timestamps or round raw values.

## Bounded indexed history, not a snapshot scan

Current Core contracts expose snapshot scans, timestamp logs and predecessors of
known IDs. They cannot enumerate retired internal generations by native key.
`DISTINCT ON` snapshot scans collapse old entries and discard tombstones.

Add the required bounded history page through existing Core persistence and DB
capture owners. Use the authentic native primary key and existing index-range
compiler. The complete index key includes the internal-ID tie breaker; hashing
the business key alone is wrong. Existing index storage contains a 2,500-byte
prefix, optional suffix, full-key digest and version timestamp. Different internal
generations therefore have distinct complete keys and digests.

Use parameterized coarse prefix/hash bounds and an exclusive physical tuple cursor
including timestamp. Reconstruct and exact-filter complete keys, check digest,
table/document/key agreement and charge every physical row, including tombstones
and coarse-prefix collisions, before filtering. Shared long prefixes must page
without unbounded group buffering. Hydrate live entries at their exact document
revision timestamp; missing/deleted/corrupt anchors refuse.

The current write-batch owner emits every live ordinary key at each committed body
revision, even when the key is unchanged. Reuse that path for canonical preimages;
do not scan a table or timestamp log to rediscover native identities. Pin reads to
the selected published frontier. Validate index and document retention lower
witnesses before and after I/O, including empty pages. A retired floor does not
mean a value was never recorded. Preserve finite entry/revision/identity/key/body
bounds, cancellation and the original deadline. Add no history table or SQL
transaction; final saves retain the existing issued-lease fence.

History composes the captured leader witnesses with the persistence owner's
existing live SQL retention validator. Both index and document checks include
zero and empty responses, run before I/O and after success, and preserve the
original body failure. The fenced bootstrap `readRetentionBounds` reader and its
final share lock remain unchanged; history adds no SQL transaction.

## Historical source and schema authentication

A Core document revision stores no per-row native/schema marker. The same tablet
can acquire a different schema ID. Compatible Application changes or a new native
source can change the containing bundle while preserving a relational native
source exactly; one Payload successor can also change native source identity.
Consequently, current policy alone cannot authenticate every old body.

For a proving revision at timestamp R, read the actual retained system records:

- Historical `_tables` at R: same tablet, number, name and namespace, active native
  policy, exact admitted native identity and source-local meaning.
- Its referenced `_schemas` at R: active schema, canonical source-local binding
  and table declaration, exact currently admitted native metadata.

Use existing known-ID historical point reads. An already-issued identical bundle
can supply its exact metadata. A closed inclusion verifier in the existing
schemaBundle/nativePolicy owner can validate an unrelated compatible bundle's
selected source metadata against the currently issued definition. It does not
mint arbitrary old definitions or grant unrelated source authority.

The current verified registry covers active/pending/validated schemas, not all
overwritten history. Historical schema records may later be tombstoned; read the
retained revision at R and fail closed when proof is absent or retired. Changed
native identity refuses an old preimage even if body bytes match. This does not
admit general populated source evolution. Current source authority and metadata
remain checked independently around suspension and at settlement.

## Native exposure and coordinated ownership

Review identified missing table qualification in pending-deletion destination
selection. The transaction owner must require the requested tablet and a still
deleted pending write before considering its source/business key. The neutral
same-source parent/child same-ID delete-and-replay witness owns this correction.
Its actual failure and paired regression precede acceptance.

The [physical-page correction](./21c-native-history-physical-pages.md) owns bounded
ordering, post-limit time eligibility and the existing-target index upgrade.
Those review gates supersede any claim that returned row limits alone bound the
initial history query's physical work.

Retain the existing optional Commerce `replay` surface for explicitly selected
profiles only, require per-call validation, and bind replay/preserving-deletion
choices into the existing profile identity. Keep underlying source/table/write/
read-only grants unchanged. No callback receives history/persistence, raw internal
IDs, a scope clock or settlement capability.

The restoration owner owns history contracts/transport, retained system proof,
activity lookup, replay/destination staging and exact native flags/store wiring.
Use existing schema, mutation and integrity owners. Sequence shared API/contracts,
database, transaction and persistence changes with the predicate owner. The proof
worker owns neutral scenarios; adapters retain native algorithms and receipts.

## Required failure and acceptance witnesses

The neutral parent-child source installs through Core and seeds genuine managed
and raw values. Its actual selected atomic invocation, with mandatory per-call
validation and replay/preserving-deletion selection, reproduced
`CommerceTransactionError.unsupportedProfile` before production changes at
`nativeConfiguration.ts:132`. The replacement now restores its exact graph through
the selected invocation on both database lanes, including a fresh internal ID
after committed physical deletion and cold reopen. The host is lazy, so its
construction alone is insufficient evidence. Broader restoration and retention
gates remain required; an uncalled old neutral scenario remains source inventory.

Prove complete `40 -> 77 -> 88 -> 77 -> 40` restoration, physical deletion and fresh
internal identity, repeated retired generations, same-root update/delete/replay,
current destination distinct from historical proof, and cold owner reopen. Check
exact managed/raw values, unchanged tombstones and ID refusal at final acceptance.

Refuse forged, partial, extra/duplicate or changed-key rows; wrong source/schema/
scope; missing historical metadata; history/retention/resource exhaustion; unique
and destination races; and physically missing FK endpoints. Cover same-source
unrelated bundle/schema-ID handoff without broadening native source evolution.
Use real accepted-predecessor failure and cancellation/lost-ACK controls. Catch
refusal inside native code and prove no successful publication. Transport barriers
may schedule real owners; harnesses must not reproduce their logic. Require both
PGlite and ordinary-role PostgreSQL, then all connected native inverses and guards.
