# Transactional Storage Redesign

## Status, Scope, And Decision

Status: replacement implementation authorized. Slice 1 is implemented: shared
Application facts use bounded inserts and native latest receipts use an upsert.
Slice 2 is implemented: a dedicated wake uses commit identity and one claim fence.
Expired-lease floor progress is also implemented: only live pins count toward
the bounded lease directory. Journal roots now retain one final syscall counter,
and write events retain canonical bytes and digest without a JSON mirror.
Terminal sessions now discard their argument, grant, and Application authority
bodies atomically while retaining their request identity and outcome selector.
Slice 4 uses one canonical byte body plus digest for Application row revisions;
the JSONB mirror and its readers/projection checks are removed. Unique claims now
retain stable ownership without document-revision provenance or same-key refresh;
physical constraint coverage replaces schema-set progress. Membership-only ordered
history remains pending, and the coalesced-journal contract
remains a separate selection. Payload and Medusa operation APIs remain unchanged by these replacements;
exported core clock/counter types lose their obsolete wake-sequence fields.

The owner declares early development and no backward-compatibility requirement
for this redesign. Existing internal types, fixtures, migration tests, and
historical implementations do not justify retaining a displaced design. Preserve
the intended transaction semantics, and replace internal contracts when a better
design requires it. Complete a selected replacement with caller switches and
deletion, without an indefinitely retained compatibility path.

Scope: committed Application rows and revisions, native OCC, ordered indexes,
unique ownership, relation sidecars, transaction journals and retention,
shared publication, committed outcomes, wakes, and the core capabilities used
by framework commands. Application installation, schema artifact validation,
framework configuration, public feature expansion, and framework business-model
redesign are excluded. Their existing storage consumers may need mechanical
updates when a selected representation changes; that is a dependency to name,
not permission to redesign those domains.

The accepted [architecture](../../design-notes/flarex-db-accepted-design.md),
[native OCC contract](../flarexdb-foundation/02-occ-and-transactions.md), and
[shared ownership](./README.md) remain authoritative until a selected slice
explicitly reconciles its changed storage or protocol contract. In particular,
the current same-commit index provenance is an intentional contract, not an
already-established defect. The selected row-body replacement reconciles its
changed storage checks in that accepted design.

## Recommended Direction

Optimize work and persisted information at the existing owners:

1. Batch Application change publication and replace latest-receipt delete/insert
   with an upsert. These remove statement amplification without a new execution
   model or adapter API.
2. Replace the generic-looking target outbox with one dedicated commit-wake
   table keyed by the commit token, with one claim/attempt fence.
3. Make ordered-index history describe membership transitions and unique keys
   describe stable ownership. Independently hydrate documents at the snapshot
   and retain returned-row OCC dependencies.
   Change the writers, storage constraints, builders, validation, and compaction
   together; simply omitting current writes is incorrect.
4. Store one complete Application value representation: canonical bytes plus
   digest, with decoded values supplied by the existing row owner. The paired
   experiment below supports this storage choice without a universal latency claim.
5. Bound temporary and terminal execution evidence. Start with receipt writes,
   duplicate scalar/payload fields, and explicit terminal retention. A later
   coalesced-journal contract can remove intermediate value history only after
   its independent authentication and resource-accounting proofs.

Do not introduce a universal transaction API, generic participant registry,
another committer, or a second authoritative row store. R1 physical ownership,
R2 Application materialization, shared publication, and framework request
recovery already exist. Their implementation is the starting point.

The nearest end-to-end proof is a native indexed mutation and a Payload update
through the same Application materializer, alongside an independently admitted
Medusa relational command through the same publisher. The proof must include
conflict, rollback, lost-response recovery, and retention behavior.

## Target Ownership

```text
Native execution                     Payload command          Medusa command
exact snapshot + logical journal     CMS document overlay     relational SQL
OCC validation                       CMS participant          commerce participant
             \                       /                              |
             one Application materializer                          |
             rows + index/unique/relation deltas                    |
                         \                                         /
                    one core publication owner
             commit + facts + retained result + commit wake
                   participant completion + scope clock
                    existing physical transaction owner
```

Only physical settlement establishes success. All publication and business
state remain in the owning transaction. Native untrusted execution remains
outside SQL transactions; bounded framework execution retains its admitted
request/manager lifetime. An independently committed framework operation does
not become part of a native atomic mutation.

The scope lock remains the serialization mechanism for this proposal. Its hold
and wait times must be measured. Removing it requires a different conflict and
publication protocol and is not a side effect of reducing storage.

## Physical Storage Inventory

Names below denote the proposed final roles. Keep current names where their
meaning remains accurate; renaming alone is not an optimization.

| Current storage | Disposition and proposed final contents | Why it remains or what must disappear |
| --- | --- | --- |
| Scope clock | **Extend/change:** retain scope/epoch, generation fence, commit head, retained floor, and revocation authority; delete the independent target outbox head in the wake replacement | One commit order and authority fence. Text/UUID scope normalization crosses additional authority consumers and is not selected by this core slice |
| App row revision | **Replaced representation:** row identity, commit/previous sequence, write epoch, schema provenance, creation time, codec, tombstone, canonical value bytes and digest | One complete persisted value. Row JSONB and its consumer projections are deleted |
| App row current | **Retain:** identity and exact revision pointer, with FK | It stores no second document. It supports current-head access, integrity, and compare-and-set writes |
| Ordered-index revision | **Replace contract:** ordered membership transitions, physical definition identity, row identity, transition sequence, and exact key evidence | Delete body-revision mirroring, predecessor chains and exact row-revision FK; keep snapshot/OCC history and stable row identity |
| Ordered-index current | **Retain/change:** current live membership with pointer to its latest membership revision | Its version becomes membership sequence, not the latest document revision |
| Unique key | **Replace lineage:** one current exclusive owner per admitted unique key, exact key evidence, definition and stable row identity | Delete same-value refresh and exact row-revision provenance with their writer/builder checks. Keep collision evidence and release-before-claim ordering |
| Current relation edges | **Retain:** deterministic endpoint/occurrence projection with ordering and definition identity | A derived index of the owning row or link entity, never a second independently writable relation authority |
| Relation adjacency versions | **Retain:** endpoint dependency version for the admitted incoming/outgoing checks | Current edges alone cannot detect an intervening change; arbitrary historical graph reconstruction is not implied |
| Commit header | **Retain:** scope/epoch/commit token, exact admitted family counts/digests, committed time | Immutable contiguous publication directory; zero-row successes still have a header |
| App-row, adjacency, relational, preference and event fact families | **Retain; batch app-row inserts:** typed provenance appropriate to each family | Do not copy complete row bodies into a generic event table. Preserve exact ordinals and whole-commit reader bounds |
| Committed request outcome | **Retain:** request identity/fingerprint, immutable result token, available/expired result evidence | Request-key non-reuse outlives compactable commit history. Result-payload expiry is a separate lifecycle |
| Target commit outbox | **Replace/delete:** dedicated commit-wake table specified below | Delete duplicate attempt counter, constant event kind, independent wake sequence and their indexes/decoders |
| Domain event delivery | **Retain:** event/subscriber delivery obligations | This has a different multiplicity and lifecycle from one scope wake per commit |
| Legacy documents/indexes/invoke sessions/commit/outbox families | **Retain only until serving switch, then delete** | Current executor still routes legacy. Finish the selected serving proof and switch callers before deleting its engine/storage; do not recreate dual routing for this redesign |

### Application Value Representation

The [row DDL](../../packages/persistence-postgres/src/schema.ts) stores canonical
Value Codec V1 bytes and SHA-256 for each live revision. The
[row reader](../../packages/persistence-postgres/src/appRows.ts) and developer
index builder use the existing protocol owner's document-evidence decoder. It
parses, recanonicalizes, and checks exact bytes, digest, document profile, `_id`
and immutable `_creationTime`, then returns the existing decoded canonical value.
The producer-facing JSON-plus-evidence verifier remains useful when authenticating
new write inputs; it no longer implies a second persisted body.

The independent JSONB mirror and its cross-representation corruption check are
removed. SQL still checks state/nullability, nonempty live bytes, digest length,
codec and structural identity. Document shape is checked at the bounded decoder
instead of a SQL JSON-object check. Tombstones retain neither body nor digest.
Current-row capture checks individual and aggregate canonical-byte sizes before
hydration; there is no remaining JSON projection budget or fallback read path.
The accepted row contract records this integrity tradeoff explicitly.

Payload continues to receive decoded documents through the CMS owner. Ordinary
Medusa relational rows use their existing physical storage and are unaffected.
Index builders and diagnostic fixtures decode through the same protocol owner;
no framework API, schema-validation algorithm, extra codec or blob store is added.

Retained pre-retirement analyzer fixtures still describe their historical JSONB
schema. They are historical evidence under [roadmap 43](../43-first-flarexdb-system-api-vertical.md),
and do not establish acceptance of the current transaction contract. Their scripts
still exist; this scoped acceptance does not claim those old-schema suites pass.
This replacement does not synthesize a
hybrid old-analyzer/new-storage migration profile. Current C07, native mutation,
relational and cooking consumers exercise the selected row contract.

The standalone [representation experiment](../../packages/persistence-postgres/test/rowRepresentationBenchmark.ts)
compares JSONB+bytes+digest, bytes+digest and JSONB+digest with identical cohorts,
three row revisions, tombstones, primary indexes and exact current-pointer FKs.
It measures point, batch, current and append/CAS shapes, including codec and
parameter construction costs, and includes TOAST in row-relation storage.
The selected bytes+digest representation preserves exact canonical evidence and
SQL byte-size accounting. JSONB alone does not preserve that stored-byte contract.

A local ordinary-role PostgreSQL 18 experiment with pglz compression measured
these row-relation totals (MiB, including indexes and TOAST):

| Document cohort | JSONB + bytes + digest | Bytes + digest | JSONB + digest |
| --- | ---: | ---: | ---: |
| Small, about 768 bytes | 6.06 | 4.90 | 4.90 |
| Varied nested, about 4 KiB | 32.22 | 16.50 | 16.50 |
| Varied, about 32 KiB | 50.20 | 25.24 | 25.23 |
| Repeated, about 256 KiB | 0.84 | 0.48 | 0.48 |
| Varied, about 256 KiB | 49.09 | 24.85 | 24.36 |
| Varied, about 900 KiB | 48.74 | 24.68 | 24.20 |

This supports reducing duplicated storage, not a universal latency improvement.
In the final warm sample, the repeated-256-KiB batch median increased from 40.90
to 41.71 ms and the varied-32-KiB batch from 44.49 to 47.59 ms. Some larger point
reads improved. Nine measured samples per variant, simplified storage tables,
and rollback-only append timing do not establish concurrent throughput, durable
commit latency, tail latency or production performance. Rerun the experiment
for the deployment's document distribution and PostgreSQL configuration before
making those claims. Compression and TOAST prevent a fixed percentage guarantee.

### Membership History Instead Of Row-Revision Mirroring

Current [materialization](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts)
explicitly emits a live developer-index action for an unchanged key and advances
the immutable creation-time index for each changed row. The
[append owner](../../packages/persistence-postgres/src/appIndexEntries.ts) checks
scope, existing revision, predecessor, and parent row before writing history and
current state. The same-commit row FK and previous-row/index equality make this
a coupled representation, not a removable redundant INSERT.

Proposed rules:

- Insert a membership: write a live transition and current entry.
- Delete a membership: write a tombstone and remove current entry.
- Move a key: tombstone the old membership and insert the new membership in
  the same commit. Preserve row-ID tie ordering and exact key evidence.
- Change only the document body: write the row revision and row-change fact;
  retain the existing membership without changing its sequence.
- Read a historical membership at snapshot S, then independently load the row
  at S. Verify the row still lowers to that membership. Missing or inconsistent
  evidence is corruption, not ordinary absence.
- Native mutation queries record point dependencies for returned documents and
  range dependencies for consumed membership intervals. A non-key update to a
  returned row must still conflict through the point dependency.

The existing [query reader](../../packages/persistence-postgres/src/applicationQuerySnapshot.ts)
and [mutation journal reader](../../packages/persistence-postgres/src/sessionJournalStore.ts)
already hydrate rows independently at their snapshots. Mutation queries already
record returned-row point dependencies. Those are reuse points, not permission
to omit phantom, empty-range, pagination, or overlay proofs.

Keep the existing physical table pair, with this proposed history key:

```text
PRIMARY KEY (scope_uuid, index_definition_id, encoded_key, row_id, change_commit_seq)
table_id, is_present
existing bounded key codec/spec/digest evidence, pending separate size review
```

Retain both access orders: identity/key/row then descending change sequence for
snapshot membership, and definition/change sequence then key/row for OCC.
Current membership points to the exact latest live membership revision.

Delete the history predecessor column, write-epoch column and exact
row-revision FK. Validate expected membership against the prior document under
the existing transaction owner, rather than matching predecessor sequences.
Use a scope-qualified FK to the stable identity already in `fx_app_row_current`
if retaining its tombstone identity directory, as the current row contract does.
This preserves identity integrity without pinning superseded row bodies or
adding another identity table. Physical definition evidence remains checked at
its existing boundary; no cross-database FK is introduced.

Retain all membership transitions newer than the floor, the newest transition
at/before it when needed to establish retained membership, and any revision
referenced by current. There is no permanent membership-root obligation. A
fully absent membership at/below the floor, with no newer transition or current
pointer, may lose its entire history; later reuse starts a new transition.
Preserve the separate row-identity/root obligations. Change index compaction's
current predecessor-chain checks and row-compaction FK inventories together.
Removing the chain also removes its independent continuity-corruption witness.
Replace it with exact expected-current transition/replay checks at the writer
and bounded exact-selection/delete-result checks at compaction. Do not describe
the new representation as retaining every old corruption detector.

Switch append validation, intrinsic/developer builders and their head checks,
snapshot readers, OCC history scans, rollback/replay proof fixtures, index and
row compactors, and generation-qualified read guards together. Builders
currently compare index and row commit sequences. Old readers cannot run
against the new contract; select one implementation per activated checkpoint.

An older membership remains valid after non-key updates; a builder must not
refresh it just to match the latest row sequence. Concurrent writes must still
maintain partially built definitions correctly. Freeze and prove the existing
readable frontier: a newly populated index cannot serve snapshots for which it
has no complete membership history. Any required frontier-contract change is
an explicit index-owner dependency, not permission to redesign app installation
or schema validation. Once a definition serves reads, a builder cannot backdate
a membership event so that it escapes post-snapshot OCC validation. Prove this
with concurrent non-key updates, key moves and deletion during population.

The current [sync model](../../packages/flarex-backend/src/deploymentSync/QuerySyncModel.ts)
projects app-row facts to row/table invalidation. Keep those facts for every
material row change. Future precise range sync must combine membership and
returned-row dependencies; this design does not approve replacing current
table invalidation with membership-only invalidation.

Convex [index updates](../../../../crates/indexing/src/index_registry.rs) also emit a
live index update when the key stays the same. The proposed Flarex storage is a
deliberate persistence divergence preserving query results and conflict safety,
not removal of a behavior solely invented for compatibility.

A reproduced candidate-only index gap blocks the membership rewrite: after the
candidate build enables, active-schema writes can be absent from that index even
after normal replanning and activation. The separate
[coverage correction preflight](./08-index-coverage-correction.md) proposes the
required index-owner freshness contract. Its new contract is not yet approved;
row-body work remains independent. Do not fix this by enforcing candidate-only
constraints or extra fanout against valid active-schema writes.

### Stable Unique Ownership And Existing Relation Deltas

Keep one unique claim per scope/constraint/locale/canonical key, with its owning
table/row and existing exact key/digest evidence. Replace the same-commit row FK
with stable current-row identity. Delete claim schema-version, write-epoch and
latest-body commit-sequence fields whose role is to mirror the owning revision.
The claim persists while the same row owns the same key; a body-only update does
not update it. No unique-history table is added.

This is coupled to the [claim owner](../../packages/persistence-postgres/src/appUniqueKeys.ts)
and materializer: current same-key `advance` checks the previous row sequence,
and builders validate the same provenance. Replace those checks with exact
key/row ownership. Keep batched releases before claims for swaps, deletion and
reuse, and preserve duplicate/collision errors, atomic rollback, and trusted
definition checks. Simply dropping `advance` would break later writes.

A stable identity FK does not establish liveness: current-row identities also
exist for tombstones. The materializer must still prove that every live current
index membership and retained/claimed unique key belongs to a live final row.
Deleting a document atomically removes its current memberships and releases its
claims. Preserve the existing explicit live-parent checks even when their
revision-sequence comparisons disappear.

Relations already maintain actual occurrence deltas and coalesced endpoint
versions. Keep the current edge and adjacency-version tables. The admitted
reader restarts when adjacency has changed after its snapshot; it does not
reconstruct arbitrary historical edges. Preserve that limitation and the
existing Payload/Medusa relation authorities.

### Dedicated Commit Wake

Implemented table: `fx_system_commit_wake`.

```text
PRIMARY KEY (scope_uuid, commit_seq)
epoch_uuid
delivery_state
created_at, next_attempt_at
claim_fence, claim_owner, claimed_at, claim_expires_at
last_failure_code, last_failure_summary, last_failed_at
delivered_at, dead_lettered_at
```

Retain the restrictive scope FK. Keep one partial due-time index for pending or
claimed rows, ordered by scope, pending retry/claim expiry time, and commit
sequence. Do not add a commit-header FK: delivery state can outlive compacted
history. Epoch remains write provenance; old-epoch wakes remain claimable.

This replaces 18 columns with 15 and four indexes with two. The discarded
`outbox_seq`, `event_kind`, `attempt_count`, and clock `last_outbox_seq` are gone.
The previous CHECK required attempt count and claim fence to be equal. The
previous sequence heads advanced together in the sole target publisher. The chosen final contract is one wake per commit;
future event/subscriber deliveries do not require preserving a generic outbox.

Change claimed/settlement identities to commit sequence; retain exact owner,
fence, lease, retry, and terminal checks. Above or at the inclusive history
floor, require the exact retained header/epoch. Strictly below the floor, a
missing compacted header is permitted under the existing token validation.
Keep bounded failure evidence and independent wake retention. Define the
terminal cleanup policy before enabling deletion; this replacement does not
implement a wake collector.

The discarded clock/publication/protocol projections and their consumers are
removed, including `OutboxSeq`, `ScopePublicationKernel.outboxSeq`, and the
outbox-exhaustion error branch. The private wake settlement DTO uses commit
sequence. Framework command, context, and manager contracts are unchanged. Legacy freshness
`outboxSequence` is a separate serving family and has its own retirement gate.

## Execution State And Retention Inventory

| State | Disposition | Required invariant and deletion condition |
| --- | --- | --- |
| Transaction session | **Implemented:** active attempts keep complete request/authority bodies; committed/aborted/expired markers keep scalar/digest identity and no bodies | Six JSON/byte columns become null in the lifecycle transition. Markers have no deletion TTL; first terminal time, fencing, request-key non-reuse, and independent outcome retention remain |
| Snapshot lease | **Retain** | Exact retained snapshot for the current attempt. Expiry is not interchangeable with process claim expiry |
| Execution claim | **Retain** | Authenticated current process, claim fence and takeover semantics. A matching structural object does not mint authority |
| Journal root | **Duplicate counter removed** | `lastSyscallSequence` is the sole stored final counter. Sealing, independent canonical-journal authentication, recovery and locked publication bind it to the prepared evidence. Keep other counters, state, result/seal evidence and creation-time cursor |
| Latest syscall receipt | **Retain behavior, replace write mechanic** | One exact receipt supports lost-response replay. Upsert replaces delete+insert; merging a large receipt into the hot root is not selected without row-width measurements |
| Point journal | **Retain** | Immutable base dependency plus one final overlay per row. It is temporary working state, not another committed row authority |
| Indexed and relation dependency journals | **Retain** | Complete bounded predicate/adjacency dependencies, including absence and pagination |
| Ordered write-event journal | **JSON mirror removed; retain canonical events** | Canonical-byte/digest verification and strict logical-write decoding retain kind/sequence correlation and independent write-chain reconstruction. Remove the event table only under a separately selected coalesced-evidence contract |
| Sealed bytes plus normalized children | **Candidate phase replacement** | Open state needs mutable normalized access. A sealed representation may supersede children only after every stored-attempt/recovery verifier can authenticate it without them |

Terminalization deletes root/children and lease and scrubs session bodies in the
same transaction. The retained request marker is independent of compactable
commit history and is not deleted. The
[journal domain](../35-commit-compiler-and-session-intent.md) separately records
the hosted bounded-reclamation requirement.

[Floor observation](../../packages/persistence-postgres/src/retainedHistoryFloorObservation.ts)
filters `lease_expires_at > captured_database_time` before its bounded directory
read. Existing expiry indexes support this filtered read, including the
`(scope, expiry, session)` index matching its scoped order.
More than 4,096 live leases still conservatively hold the floor; expired rows no
longer consume that live-pin budget. Invalid live epoch/sequence authority still
holds, while expired authority is no pin. Both observation and publication use
the same calculation under their existing scope-clock locks. Neither deletes
leases or relaxes renewal/terminalization ownership.

This replaces the former limit-before-expiry scan, which could hold the floor
behind an expired backlog. The retained regression covers a backlog above the
bound, the 4,096/4,097 live boundary, invalid live/expired authority, and actual
floor publication without deleting session or lease evidence.

The larger journal alternative should use the existing trusted syscall owner:
base dependencies, final overlays, cumulative resource/attempted-write facts,
exact latest receipt and authenticated seal. Convex's write set coalesces final
document state while separately charging every mutation. Flarex's intermediate
events serve its current verifier contract. Removing them therefore changes the
journal/compiler contract and must preserve attempted-write limits, write
ownership, repeated patches, insert-delete/no-op behavior, randomness replay,
sealed recovery, and any selected facet provenance. Do not create a second
journal format or retain both implementations without a real obligation.

### Terminal Session Bodies

Both native publication and explicit abort/expiry clear the argument, signed
grant, and Application execution-authority JSON/byte pairs in the existing
lifecycle update and transaction. They retain codecs, digests, request identity,
authority-generation scalars, attempt fence, and the first terminal timestamp.
Repeated terminal observations do not rewrite the marker. Migration scrubs old
terminal rows without changing timestamps; active rows retain complete bodies.

Terminal evidence readers validate the retained identity and exact body absence
before returning a non-executable observation. They do not reconstruct removed
Application authority. Active evidence readers retain canonical validation, and
prepared activation still requires non-null bodies. Request-key matching uses
retained scalar/digest identity for terminal sessions; active matching continues
to compare bodies. Application grant refresh and legacy exact-grant matching
keep their existing distinction. Durable results retain their own expiry policy;
result expiry does not allow reuse of a terminal request key. No marker cleanup
service or second transaction lifetime is introduced.

## Work Per Operation

These are source-derived normal-path counts, not benchmark results. SQL
statements, rows written, and latency are different quantities. Counts exclude
BEGIN/COMMIT, trigger/index internals, authority/OCC queries, catalog preparation,
and other phases unless explicitly stated.

Let N be app-row facts, A adjacency facts, R relational facts, P preference
deletion facts, E domain events, and b(x) = ceil(x / 500), with b(0) = 0.
A batch of 500 is the implemented app-fact bound, shared with adjacency facts.
App facts use six bind parameters per row, at most 3,000 per statement.
Each returned batch must contain the exact commit and dense global ordinal set;
the transaction rolls back on missing, duplicate or out-of-batch evidence.
The internal change-written hook runs once per verified batch.

| Operation fragment | Before redesign | Replacement work |
| --- | --- | --- |
| Shared publication plus clock | 4 + N + b(A) + 1[R>0] + 2[E>0] SQL | 4 + b(N) + b(A) + 1[R>0] + 2[E>0] |
| Native publication plus root/lease/session completion | 7 + N + b(A) SQL | 7 + b(N) + b(A) |
| CMS publication, including publication-time read and preference facts P | 5 + N + b(A) + 1[P>0] SQL | 5 + b(N) + b(A) + 1[P>0] |
| Ordinary non-bootstrap commerce publication including publication-time read | 5 + 1[R>0] + 2[E>0] SQL | Same statement count; smaller wake/clock state |
| Non-key row update with I developer indexes plus intrinsic index | 6I + 7 sidecar SQL; 2(I+1) sidecar row writes | No membership append/current writes for unchanged keys; definition/consistency planning remains |
| Same-key unique-owner refresh, per constraint | 5 SELECTs + 1 UPDATE, before shared planning | No scalar claim refresh under stable ownership; shared ownership validation remains |
| Fresh point get journal writes | 4 DML | 3 with receipt upsert |
| Later new-sequence get of same point | 3 DML | 2 with receipt upsert |
| Material point write journal | 5 DML | 4 with receipt upsert; further reduction requires coalesced-evidence redesign |
| Exact latest-syscall replay | 0 journal DML | 0 |

The shared fixed four are commit header, outcome, wake, and clock. Native's
three additional DML delete journal and lease and mark the session committed;
its kernel has separate liveness-time reads outside this count. CMS/commerce
read commands do not finalize. Successful no-row write commands still publish
their result token/header/wake. Replays must not create a new publication.

Slice 1 implements the publication batching and receipt reductions in this
table. Receipt upsert preserves the latest syscall's creation/update time;
the exact-attempt root CAS and all journal child writes remain atomic.

For 1,000 app-row facts with no other fact families, the shared publication
owner plus clock changes from 1,004 to 6 statements. This is a private owner
capacity proof: the native planner currently admits at most 128 material rows,
and CMS has its separate 64-call/256-identity limits. At 128 native rows,
publication plus native completion changes from 135 to 8 statements. These
counts cover that phase only, not whole transactions or latency. For a
non-key update with three developer indexes, the current scalar sidecar path
alone accounts for 25 SQL statements and eight row writes. A membership-only
path removes those appends but must account for any replacement validation work.

For inserts, create one row revision/head and live memberships. For deletes,
write the tombstone/head and membership tombstones/current removals. A key move
requires old and new membership actions. Relations add only actual occurrence
and adjacency changes. Medusa writes its admitted physical rows and relational
facts; it does not pay Application index-revision costs for ordinary commerce
rows. Batch sizes and user-visible resource ceilings are separate contracts.

## Payload And Medusa Impact

The actual Payload package is pinned to 3.88.0 in
[its manifest](../../packages/payload-adapter/package.json); its executing native
transaction utilities respect an already supplied request transaction ID.
The adapter calls real Local API operations through
[operations](../../packages/payload-adapter/src/operations.ts), then
[adapter methods](../../packages/payload-adapter/src/adapter.ts) call
[CMS capabilities](../../packages/persistence-postgres/src/cmsAdapter.ts).

Medusa uses promoted workspace packages from the fork provenance in
[SOURCE.json](../../third_party/medusa/SOURCE.json), not an independently chosen
upstream release. The
[Currency service](../../packages/medusa-adapter/src/currency-service.ts) and
[repository](../../packages/medusa-adapter/src/currency-repository.ts) demonstrate
the actual service -> borrowed command context -> commerce-store path. Product
has explicit model/service exports in
[its manifest](../../packages/medusa-product/package.json).

| Change | Private storage/owner impact | Core API impact | Integration consequence |
| --- | --- | --- | --- |
| App-fact batching | Shared publisher and batch return validation | Participant contributions unchanged; internal proof-hook frequency changes | Payload and native publication benefit. Ordinary Medusa relational facts are already bulk-written |
| Dedicated wake | DDL, claim/settlement repository, publisher, clocks | Remove OutboxSeq and lastOutboxSeq projections; update trusted core construction consumers | CMS/commerce command, store and manager APIs need no new methods. Both retain replay and atomic publication guarantees |
| Membership-only indexes | Append/read/build/compaction contract | Internal index sequence/provenance semantics change; decoded document interface can remain | Payload shares materialization and must prove update/find/relations. Medusa relational stores keep their own physical indexes |
| One persisted row body | Row decoder and projections | Internal stored-row shape changes; CanonicalFlarexValue and CmsDocuments results can remain | Payload receives the same document values; ordinary Medusa rows are unaffected |
| Receipt/journal/terminal changes | Native session authority and recovery | Internal native session/journal/compiler contracts can change | No adoption of native OCC by frameworks. Shared request outcomes and framework uncertainty recovery remain intact |
| Stable unique ownership; retain relation deltas | Existing Application sidecar owners | Internal claim lineage/provenance changes; no new generic relational API | Payload shares these costs; Medusa links remain owned relational entities with their existing fact semantics |
| Legacy serving retirement | Executor routing and old persistence removal | Executor construction and generation contracts change | Separate serving proof; do not silently route framework commands into native mutation execution |

Representative adapter call sites should remain directly expressed:

```ts
// Payload adapter, before and after private row/index changes:
state.context.documents.patch(
  state.context.context, transactionId(state), id, fields, tableName,
)

// Medusa repository, before and after private publication/wake changes:
ctx.store.write(ctx.manager, "update", rows)
```

Those interfaces remain because they express useful document/store operations
and borrowed lifetimes, not because internal API compatibility is mandatory.
If the selected design reveals an insufficient core API, replace it once and
switch the consumers in that slice. Do not insert a compatibility facade or let
the adapter recreate a removed core responsibility.

Retain Payload Local API access/default/hook order, request-ID propagation,
read-your-writes, nested rollback-only behavior, and outer settlement. Retain
Medusa native service/repository result shapes, managed fields, link lifecycle,
soft-delete/restore, bounded nested manager lifetime, and committed event/replay
behavior. Internal DDL changes do not authorize changing those semantics.

## Replacement Slices And Completion Gates

| Slice | Complete outcome and removal | Decisive proof |
| --- | --- | --- |
| 1. Remove unnecessary SQL | Batch app facts; receipt upsert; delete displaced per-row publication and receipt replacement mechanics | Exact batch facts/ordinals, latest-response replay, late rollback, native and Payload consumer regression; app-fact statements grow per batch and receipt writes fall by one |
| 2. Dedicated wake | New final wake schema and core identities; delete old target wake columns/indexes/sequence/projections | Concurrent disjoint claims, exact-commit winner, retry/reclaim fences, send-before-ack, old epochs, floor races, all participant publication and uncertainty recovery |
| 3. Membership and stable unique ownership | Complete index/unique writer, reader, builder and compaction contracts; delete body-revision mirroring and unchanged-key refresh | Non-key returned-row conflict, empty/limited/page ranges, move out/back, delete/reinsert, insert/delete overlays, live unique ownership/collisions/swaps, build/concurrent-write/readable-frontier proof, snapshot floor and membership after row compaction |
| 4. Row representation | Select one persisted body from paired evidence; switch all row readers/builders and delete the mirror | Special values and corrupt evidence, point/batch/current reads, tombstones, Payload Local API values, actual size and read/write measurements |
| 5. Bounded execution evidence | Receipt/root/event scalar cleanup plus explicit terminal payload and expired-lease progress contracts | Lost responses, restart/abort/retry races, no key reuse, bounded floor progress with >4096 expired leases, bounded terminal bytes |
| 6. Coalesced sealed journal, if selected | One trusted folded write set/counters/seal; remove intermediate event and superseded phase storage | Independent authentication, pre-coalescing limits, attempted-table ownership, repeated operations, no-op results, fresh-process recovery and any admitted facet provenance |

Slice 1 is the recommended first implementation. It gives measurable removal of
work while the larger index and row representation contracts receive their
focused proof. A request to implement a selected slice covers its in-scope
consumer fixes, tests, documentation, required reviewers, cleanup and commit;
do not repeatedly seek approval for ordinary completion work.

Each DDL slice targets a clean final schema. Validate fresh construction and
the selected development checkpoint switch/reset. Do not add live backfill,
shadow reads, or dual codecs without an actual obligation. Do not reset another
task's database or rewrite unrelated installation/migration ownership. Remove
obsolete test scaffolding while moving its semantic assertions to the new owner.

## Validation And Measurement

Use fast PGlite and focused ordinary-role PostgreSQL lanes for each selected
transaction/storage change. A source count or a passing unit test does not prove
database behavior. Start from these existing witnesses, preserving their
intended semantics while revising assertions for deliberately replaced storage:

- [Native commit](../../packages/persistence-postgres/test/pointCommitTransaction.postgres.test.ts):
  zero-row success, multi-row rollback, unchanged/moved keys, unique conflicts,
  same-scope serialization, duplicate requests, late failure, uncertain COMMIT.
- [Index snapshots](../../packages/persistence-postgres/src/applicationQuerySnapshot.ts),
  [journal queries](../../packages/persistence-postgres/test/sessionJournalStore.postgres.test.ts),
  and [index compaction](../../packages/persistence-postgres/test/retainedIndexHistoryCompaction.postgres.test.ts):
  returned-row dependencies, phantoms, pagination, overlay and retained anchors.
- [Wake claims](../../packages/persistence-postgres/test/commitWakeOutbox.postgres.test.ts)
  and [recovery](../../packages/persistence-postgres/test/requestRecovery.test.ts):
  exact claims, expiry, old epochs, compaction races, complete causes, no callback replay.
- [CMS](../../packages/persistence-postgres/test/cmsHostScenario.ts),
  [Payload preference publication](../../packages/persistence-postgres/test/payloadPreferencePublicationScenario.ts),
  [commerce publication](../../packages/persistence-postgres/test/commercePublicationScenario.ts),
  and [named composition](./05-named-command-preflight.md): connected late rollback,
  same-request visibility, net-zero writes and shared finalization.
- [Payload Local API tests](../../packages/payload-adapter/test) and
  [Medusa admitted tests](../../packages/medusa-adapter/test): preserve native
  lifecycle/result assertions. Include the affected Product and stored-link
  consumers when changing their shared publication/recovery path.
- [Claim liveness](../../packages/persistence-postgres/test/transactionExecutionClaimLiveness.postgres.test.ts)
  and [retained-floor observation](../../packages/persistence-postgres/test/retainedHistoryFloorObservation.test.ts):
  renewal, takeover, expiry, terminal evidence and progress under backlog.

Batch witnesses include 0/1/499/500/501/1000 app facts, within the caller's admitted
limits, and rollback after first/middle/final batches and outcome/wake/clock.
Add a deterministic reproduction of the expired-lease floor hold before fixing
its owner. A passing rerun does not explain a timing failure.

Measure identical admitted workloads before/after: no-op, insert, non-key update,
key move, delete, repeated updates, small/batched writes, and relational commands;
vary index/unique/relation fanout, document size, retained history, hot rows,
same-scope concurrency, and independent scopes. Record setup separately.

Collect complete SQL counts, affected rows, serialized/hash bytes, WAL bytes,
table/index/TOAST bytes, lock hold/wait, p50/p95/p99 latency, throughput, retries,
pool occupancy, and residual resources. Use query observation at the actual
owner and PostgreSQL
[EXPLAIN with ANALYZE/BUFFERS/WAL](https://www.postgresql.org/docs/current/sql-explain.html)
for the relevant statements in disposable test transactions. Keep instrumentation
out of the framework-facing API. Statement-count improvements must match the
selected deletion; agree latency/storage acceptance margins before measurement.

## Primary Source And Ownership Pointers

- [Convex committer](../../../../crates/database/src/committer.rs): validate reads
  before computing/publishing coalesced writes.
- [Convex index registry](../../../../crates/indexing/src/index_registry.rs):
  current live-key updates and invalidation evidence, including unchanged keys.
- [Convex write set](../../../../crates/database/src/writes.rs): final per-document
  write set with cumulative attempted-write accounting.
- [Shared publisher](../../packages/persistence-postgres/src/commitPublication/publication.ts),
  [Application materializer](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts),
  [CMS participant](../../packages/persistence-postgres/src/cmsTransaction/publication.ts),
  [commerce participant](../../packages/persistence-postgres/src/commerceTransaction/publication.ts).
- [Journal store](../../packages/persistence-postgres/src/sessionJournalStore.ts),
  [session owner](../../packages/persistence-postgres/src/transactionSessionActivation.ts),
  [stored evidence](../../packages/persistence-postgres/src/storedAttemptEvidence.ts),
  [independent verifier](../../packages/executor/src/storedAttemptAuthentication/authenticationVerification.ts).

This proposal closes the design inventory, not optimization or deployment
readiness. Implementation is complete only when the selected obsolete state and
logic are gone, connected contracts pass, and measured results support the claim.
