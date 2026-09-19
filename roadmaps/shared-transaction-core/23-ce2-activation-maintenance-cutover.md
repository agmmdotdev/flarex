# CE2 Activation Maintenance Cutover

Status: ordered-index activation, writer, reader and builder cutover implemented.
The four writer prerequisites in [continuous maintenance](./18-ce2-continuous-index-maintenance.md)
remain mandatory. Unique-workspace optimization, matched before/after request
measurements and wider concurrent-lifecycle acceptance remain subsequent CE2 work.

## Outcome And Boundaries

An ordinary native or shared CMS commit must maintain the exact active ordered
indexes without updating their build progress. The activation transaction owns
the durable proof that makes this safe. Keep Postgres settlement, scope-clock
exclusion, physical lifecycle leases, native OCC and framework transaction
profiles. No new Medusa capability, unique-workspace optimization, advanced
migration policy or developer API belongs to this slice.

This is a reader/writer/activation/build cutover. Do not merge an unused schema
field or remove the writer UPDATE while another reader still relies on that
UPDATE. The nearest connected proof is a real active Application switching from
schema A to B while ordinary native/CMS writes and candidate builders run.

## Current Owners And Implementation Seams

| Owner | Evidence and change |
| --- | --- |
| `applicationReadiness.ts` | Both prepared and stored readiness already hold a verified `PublishedPhysicalRequirementSnapshotV1`. Pass this exact snapshot through the issued activation basis; do not reload or reconstruct a second requirement set. The physical readiness digest includes immutable build identity and first-readable state, but excludes mutable covered-through progress. Keep that separation. |
| `applicationRelationReadinessFold.ts` | Its prepared fold also owns the verified requirement snapshot. Extend its issued activation basis in the same way; preserve write-ownership and relation readiness commitments. |
| `applicationActivation.ts` | Both activation paths hold the scope clock before readiness validation and `persistActivationInTransaction`. Open/carry/close belongs inside that transaction, alongside the activation row and active head. Historical activation replay must not reopen old obligations. |
| `applicationActiveHeadRead.ts` | Already authenticates the canonical head and its selected immutable activation row. Reuse this owner for a transaction-local coverage context. Do not introduce another active-head decoder or a process-global freshness cache. |
| `indexBuildStates.ts` | Owns decoding, fence/frontier checks and the shared coverage predicate. Extend this owner with the maintenance evidence and one coverage verdict used by all consumers. Its explicit fenced-read projection must include the new fields. |
| `applicationDocumentMaterialization/materialization.ts` | Currently locks selected intrinsic/developer build rows exclusively, checks coverage at the preceding commit, applies memberships and advances enabled progress. Replace active progress advancement only after validating the binding and exact issued selection. Keep cursor resets for non-enabled builds where the private primitive profile requires them. |
| `intrinsicCreationTimeIndexBuildV1.ts` | Serves both intrinsic and developer indexes. Its enabled branch currently compares the table frontier with sealed coverage and may replay changes. Check valid continuous authority first so deliberately old sealed coverage cannot trigger duplicate replay. |
| `indexBuildReconciliation.ts` | Already refuses implicit reset of an enabled or previously readable build under stale authority. Preserve that refusal; reconciliation cannot mint or silently clear maintenance authority. |
| `applicationQuerySnapshot.ts`, `sessionJournalStore.ts` | Both call the shared coverage predicate before accepting ordered-index reads. Preserve first-readable, retained-snapshot and returned-row dependency checks. |
| `physicalDefinitionRetirementPins.ts` | Already pins definitions through the active Application schema. Maintain that pin and existing catalog lease ordering; a maintenance certificate is not permission to drain an active definition. |
| `retainedIndexHistoryCompaction.ts` | Compacts membership revisions using the retained-floor/anchor protocol, rather than build-progress state. Keep that protocol and prove that closing maintenance does not lose historical anchors. |

## Durable Representation

Keep the proof on `fx_system_index_build_state`, beside its existing scope,
physical definition and build attempt. Add a nullable maintenance activation
sequence projection plus canonical certificate bytes and SHA-256. A partial
index beginning with scope and activation sequence serves the bounded outgoing
obligation lookup. It is an index on a shared physical family, not a physical
index per shop or logical definition.

The certificate is one versioned stored format, with a named Schema and exact
canonical encoding. It binds:

- scope, storage generation, generation fence and epoch;
- physical definition ID, logical table ID and immutable physical specification
  identity;
- deployment, schema version and canonical schema manifest identity from the
  verified published requirements;
- build attempt fence and immutable first-readable frontier;
- opening commit frontier H;
- activation sequence and canonical active-head hash.

The sequence projection and byte/hash columns are either all absent or all
present. SQL constraints enforce the basic representation and enabled/readable
state; the decoder checks canonical bytes/hash, identity, fences and cross-field
agreement. Opening H must equal the explicitly sealed coverage stored at open
and must not exceed the caller's authenticated scope head. First-readable must
remain at or below H. A copied certificate from another definition, attempt,
scope or activation must fail.

Only the trusted activation owner writes certificates, using the exact issued
requirement snapshot. The certificate records that admission; a caller cannot
submit a list or digest to mint it. Checking a certificate's self-digest alone is
not authorization: coverage additionally requires agreement with the coherent
current activation and authenticated definition/build identity. This retains
the existing integrity boundary against malformed or transplanted stored state;
it does not promise security against an administrator rewriting all canonical
authority records and their hashes.

Do not add an independent obligation registry, another activation ledger or a
lease timer. Mutable certificates do not enter the immutable readiness digest,
and do not change the existing activation/head canonical formats merely to
duplicate facts already bound to their head identity.

## Activation Transaction

Follow existing catalog-lease, scope-clock and active-head ordering. Use one
deterministic build-row order for all incoming and outgoing definitions.

1. Validate incoming readiness, its exact physical requirements and completeness
   through locked head H. Retain physical lifecycle and write-ownership checks.
2. Perform existing request replay and expected-head checks. A historical replay
   returns its durable result without modifying current maintenance state.
3. Load outgoing certificates through the partial index with the existing
   requirement-count bound and an overflow witness. Authenticate them against
   the outgoing coherent head, its independently resolved schema binding and
   build identities. Resolve outgoing physical requirements through the incoming
   issued snapshot's existing control-catalog authority; reuse that snapshot only
   for the same schema identity. When the existing located-target registry proves
   that catalog and target share a database, borrow the held transaction for the
   catalog read instead of queuing a second read behind it. The candidate target
   factory records its database identity in that existing registry. Every outgoing
   certificate must match actual
   catalog membership, table and physical spec. Never use its own fields as its
   expected definition. A malformed or stale certificate is corruption, not an
   index to skip.
4. Seal outgoing continuously maintained definitions through H and clear their
   certificates. An outgoing definition without a certificate has only its
   existing bounded coverage; never extend it merely because it was enabled.
5. For every exact incoming requirement, require its enabled, fenced, readable
   build and proven coverage. Seal coverage at H and install the new certificate
   bound to the next head. Shared definitions keep memberships, attempt identity
   and first-readable history; only their activation binding changes.
6. Publish the existing activation/head and ownership state in the same physical
   transaction. Every failure rolls all steps back. Reuse the existing durable
   outcome/replay logic for lost acknowledgement.

No ordinary write can occur between outgoing sealing and incoming opening
because this slice retains the scope clock. Reopening a previously removed
definition must prove its entire intervening gap with the existing candidate
catch-up protocol. Do not reset readable history to disguise a missing suffix.

## Coverage And Writer Cutover

The shared owner builds one coherent coverage context under the caller's scope
guard, using the existing active-head reader and its schema-binding reader.
It reuses the context across selected definitions in the operation and retains
share protection on the authority records. It does not cache across transactions
or introduce an unused alternate snapshot mode. The current head's deployment,
schema version and manifest must independently match each certificate.

The shared coverage owner admits a snapshot only after first-readable, scope
frontier, build fences and the caller's physical/retained-history checks pass:

- With no certificate, keep bounded coverage and the existing unchanged-table
  suffix proof for candidate/inactive definitions and the no-active primitive
  profile.
- With a certificate, authenticate its current head and definition/build
  binding, then use continuous completeness through the transaction's scope
  head. Malformed or mismatched evidence fails closed; do not hide it by falling
  back to the sealed prefix.

For a material serving write, every selected active ordered definition must have
valid continuous authority. A missing certificate is not permission to keep the
old per-commit progress path. The issued touched-table selection and active
schema check remain mandatory for both native and CMS consumers. Candidate-only
definitions remain outside that selection and cannot impose constraints or key
limits on the active writer.

After these checks, enabled serving writes need read protection on build state
and no covered-through UPDATE. Recheck lock acquisition order against existing
readers/builders before weakening row locks. Non-enabled cursor resets and
bounded primitive writes retain their actual write protection and progress
work; these are different lifecycle states, not a compatibility serving engine.
Keep unique-workspace progress unchanged for its separately recorded follow-on.

The enabled builder uses the same coverage verdict: valid continuous maintenance
is already complete through H and does not need catch-up. Without it, the
existing bounded replay remains authoritative. Neither reconciliation nor a
builder may certify an active head based on an enabled flag.

## Existing Data And Necessary Breaks

Migration adds absent certificates to existing rows. It does not fabricate
continuous authority, rebuild data, delete tables or reset history. Stored
first-readable and sealed coverage retain their meaning.

An existing active head with uncertified requirements cannot perform another
material serving write after this cutover. Restore write admission through a
fresh validated activation, with coverage proved for every incoming requirement;
do not reinterpret an old activation receipt or silently repair it on read.
Where publishing a fresh revision is required by existing activation identity
rules, use that normal path. Current bounded reads remain subject to their real
coverage. This is an intentional development-phase activation/composition break,
not an assumed data-reset obligation or a new public migration API.

Affected internal callers are both activation bases, shared coverage consumers,
native/CMS materialization, builders and direct build-state test fixtures. Migrate
them together. Remove enabled-serving progress writes, obsolete exclusive locks,
and assertions that require build timestamps to advance after ordinary commits.
Replace those assertions with unchanged tuples and maintained memberships; keep
tests for actual candidate progress and historical corruption.

## Implemented Cutover And Remaining Acceptance

Migration 0103 adds the nullable certificate on the existing shared build family.
Activation opens, carries and closes it atomically with the existing head.
Native and CMS materialization require certificates for active ordered builds;
their old enabled progress UPDATE is removed and selected build reads use share
locks. The no-active primitive and non-enabled lifecycle paths retain their
bounded progress work. The native invocation constructor preserves the original
issued ordered-index ports so their provenance reaches this shared owner.

The shared coverage predicate is used by readiness, query snapshots, journal
reads and builders. Invalid evidence fails closed; hashing or database failures
remain resource failures rather than stored corruption. Active builders replay
without advancing progress. Historical activation replay leaves current
obligations unchanged. Both activation entry points recover an exact committed
receipt before current readiness or manifest-kind resolution. The existing
canonical activation decoder, scope authority check, caller predecessor token,
request digest and receipt projection own this recovery. It validates neither
current physical coverage nor the old readiness graph and cannot issue a serving
selection or enter fresh activation. The receipt's expected-head token describes
that historical outcome, not the current head. Malformed receipts, stale scope
authority and different predecessor hashes refuse. This intentionally separates
historical outcome recovery from fresh serving validation; no readiness reader
is weakened. Relation selection validates head identity before coverage so stale
selections retain their concurrent-head refusal.
Existing active data needs a fresh normal activation to
acquire certificates, without resetting row or index history.

Connected witnesses cover native/CMS stable build tuples, ordinary-role
PostgreSQL zero build UPDATE statements and unchanged physical tuples, candidate
catch-up, A/B removal and reactivation across a genuine gap, historical reads,
source/spec/table/hash corruption, crypto failure, replay during an inactive
index gap, exact predecessor refusal, and rollback at close, open
and head publication. Existing compaction/retirement guards remain in place;
expanded simultaneous lifecycle races and matched latency/SQL/read-cost
measurements are still CE2 acceptance work. Coverage now reads the active schema
binding once per operation and hashes selected certificates. Activation can
add a bounded outgoing catalog lookup. Attribute these costs alongside the
eliminated writes before making a performance claim.

## Decisive Validation And Completion

Use the same shared scenarios with PGlite and ordinary-role PostgreSQL. The
PostgreSQL lane must use separate connections for ordering witnesses.

| Scenario | Required observation |
| --- | --- |
| First activation and native/CMS writes | Exact requirements acquire certificates; membership/history/publication advance while enabled build tuples and certificate bytes remain unchanged. Count eliminated progress SQL separately from any added coverage reads. |
| A to B with shared, added and removed definitions | Shared history is preserved, removed coverage seals at H, added definitions require complete readiness, and no candidate-only index constrains A. |
| Historical reads and reactivation | Snapshots at/before close remain correct; later writes create a genuine catch-up gap; reactivation refuses until the gap is bridged without resetting first-readable. |
| Active builder and compaction | Builder does not replay continuously maintained history; retained-floor compaction preserves anchors; bounded candidate catch-up still detects unavailable history. |
| Corruption and missing proof | Missing, transplanted, malformed or stale certificate/fence/head/spec evidence refuses before material changes; an absent physical build remains corruption. |
| Migration of an existing active head | No certificate is fabricated; material writes refuse; normal validated activation restores admission without deleting data. |
| Fault and lost acknowledgement | Faults after sealing, after opening and after head write leave no partial outcome; confirmed commit with lost response replays the same result; historical replay cannot reactivate old obligations. |
| Lifecycle races | Builder, writer, activation and retirement respect existing lease/clock order; PostgreSQL waiting witnesses show no deadlock or partial coverage. |

Run affected typechecks, core/diff/staged lint and both read-only project reviews
against the final cutover. Reconcile design status only when runtime behavior and
tests agree. Commit migration, implementation, migrated consumers, tests and
cleanup as one coherent capability. Fewer metadata writes do not establish
same-scope concurrency, complete CE2, production scale or CE3 completion.
