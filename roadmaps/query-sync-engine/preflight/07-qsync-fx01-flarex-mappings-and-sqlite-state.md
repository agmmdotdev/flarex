# QSYNC-FX01 Flarex Mappings And Cloudflare SQLite State Preflight

## Status

**Preflight status:** complete and exited privately on 2026-09-01.
`QSYNC-FX01-A` is complete, private, and production-inert. The docs-only
[`QSYNC-FX01-B` checkpoint](./08-qsync-fx01-b-semantic-persistence-verdict.md)
is also complete with a stop-before-schema verdict: Cloudflare SQLite is
feasible and all nine logical access plans are bounded. The subsequent D stage
has now completed the operation-scoped transition-plan seam needed to implement
them without an aggregate load or second reducer. The
[`QSYNC-FX01-C1` checkpoint](./10-qsync-fx01-c1-sqlite-vertical.md), its
empty-scope prerequisite, and its private generation-2 three-operation SQLite
vertical are complete in `12e2f375` and `b94abbb0`. The accepted
[`QSYNC-FX01-C2` checkpoint](./11-qsync-fx01-c2-sqlite-evaluation-vertical.md)
and its generation-3 three-operation evaluation extension were implemented on
2026-08-30, and its pinned local Workerd exit proof completed on 2026-08-31.
C2 is complete, package-private, unrouted, and production-inert. The accepted
[`QSYNC-FX01-C3` checkpoint](./12-qsync-fx01-c3-publication-lifecycle.md)
completed the generation-4 publication lifecycle, complete private
nine-operation adapter, exact-limit matrix, and pinned local Workerd
rollback/disposal-recreate/reopen exit. The result remains package-private,
unrouted, and production-inert. Production
Durable Object host composition, source/evaluator composition, callers,
delivery, public APIs, and production routing remain separately unauthorized.

The subsequent docs-only
[`QSYNC01-D0` preflight](./09-qsync01-d-operation-scoped-transition-plans.md)
accepted the missing portable seam and its D1-D4 implementation order. D0 added
no code; D1-D4 and C1-C3 are now complete. `QSYNC-FX02` is unblocked as the next
preflight, but it is not implemented or authorized by this completed adapter
gate.

`QSYNC01-A` through `QSYNC01-C4` are complete, private, reference-backed, and
production-inert; C4 completed in `87a7566f`. They prove the portable
transition, source-admission, semantic-state, evaluation, and publication
contracts over reference capabilities. They do not prove that the existing
Flarex protocol, Postgres feed, query runtime, or Cloudflare SQLite store
implements those contracts.

This preflight is the first Flarex adoption gate. It is deliberately split so
that deterministic Flarex model encodings and semantic-persistence feasibility
are decided before any durable schema is created. The completed first
implementation slice was `QSYNC-FX01-A`. B accepted no implementation slice;
the later C1 checkpoint completed the first SQLite vertical, and the D1-D4
prerequisite is complete.

The user accepted the package direction, `QSYNC-FX01-A` boundary, and docs-only
B investigation recorded here. Historically, B accepted no DDL, storage
generation, migration, or C1-C3 implementation. C1 and C2 later gained and
completed their own authority; C3 later gained and completed its separately
bounded authority. B-era terms such as
"would own" and "would require" describe the then-unapproved target unless a
later checkpoint explicitly supersedes them.

## Decision Summary

FX01 would adapt Flarex to the existing engine. It would not move Flarex into
the engine or create a second sync engine.

The proposed import direction is:

```text
flarex-backend/deploymentSync
  Flarex model projection + Cloudflare SQLite state adapter
       | imports                         | imports private subpaths
       v                                 v
flarex-protocol                    @flarex/query-sync
versioned Flarex frames            portable transition authority
```

There is no dependency between the two lower-level packages.

FX01 does not modify `@flarex/query-sync`. The package remains Flarex-free;
QSYNC01-D separately owns the accepted portable seam correction. Any further
contract gap requires another bounded core preflight, and an adapter may not
patch around it or duplicate portable logic.

Do not create `query-sync-cloudflare`, `query-sync-flarex`,
`query-sync-postgres`, or another workspace package. There is one current
Flarex/Cloudflare owner, `flarex-backend`, and no second real adapter owner that
justifies a package split.

The broad FX01 outcome remains:

1. exact versioned Flarex namespace, model, query, dependency, authority,
   result, and publication mappings; and
2. one per-scope Cloudflare SQLite implementation of all nine operations in
   `QuerySyncTransitionState`, including evaluation-recovery and semantic
   publication-outbox state.

That outcome is divided into reviewable subgates:

| Subgate | Outcome | Current authorization |
| --- | --- | --- |
| `QSYNC-FX01-A` | Versioned canonical Flarex frames, one model adapter with a pure projector, result/publication mapping, and exhaustive deterministic vectors | Complete; private and production-inert |
| `QSYNC-FX01-B` | Docs-only semantic-persistence feasibility: authenticated binding, every operation's exact read/transition/write plan, current core-seam verdict, and only then proposed DDL/migration | Complete; stop before schema; no code authorized |
| `QSYNC-FX01-C1` | First private semantic vertical: authenticated binding plus initialize, begin, and admitted-batch application with only the rows those operations require | Complete in `b94abbb0` after prerequisite `12e2f375`; private and production-inert |
| `QSYNC-FX01-C2` | Evaluation completion and recovery vertical: complete, claim, and attempt-outcome operations with their dependency/fingerprint/publication-intent rows | Complete on 2026-08-31; private, unrouted, and production-inert |
| `QSYNC-FX01-C3` | Publication claim/outcome/completion, the complete nine-operation adapter, reference conformance, and pinned Workerd rollback/disposal-recreate/reopen proof | Complete on 2026-09-01; private, unrouted, and production-inert |

No subgate is a usable production path. FX01 has exited because A, B, and C1-C3
are complete and the resulting adapter remains package-private and unrouted.
The historical C1/C2 partial adapters never claimed the complete
`QuerySyncTransitionState` interface before C3.

## Authority And Ownership

The existing authority order remains unchanged:

- Postgres owns application rows, scope generation and fence, current epoch,
  scope-lifetime commit sequence, retention floor, commit facts, active
  Application head, snapshots, and recovery history.
- `@flarex/query-sync` owns ordered admission, query/dependency/generation
  semantics, dirty/rerun decisions, recovery-stable evaluation work, and
  semantic publication work.
- `flarex-protocol` owns concrete versioned Flarex canonical and persisted
  encodings. It must not import `@flarex/query-sync`.
- `flarex-backend` owns the concrete Flarex mapping, the per-scope
  `DeploymentSyncDO`, its SQLite adapter, and later host composition. It may
  import the private query-sync subpaths.
- `@flarex/persistence-postgres` later owns the correlated Flarex
  `ReplayableChangeSource` read. It does not own query coordination state.
- the accepted delivery adapter later owns external append/resume mechanics.
  It does not own source sequence, query generation, or publication intent.
- the gateway/client layer later owns authenticated client query IDs,
  subscription fanout, reconnect, and application of delivered results.

One deterministic `DeploymentSyncDO` remains bound to one trusted scope. Its
SQLite database is the sole Flarex coordination-state authority. A module
global, process singleton, Postgres query registry, second Durable Object
registry, or fallback store is forbidden.

## Current Evidence And Exact Gaps

The current code now provides the completed A mappings and the C1-C3 SQLite
verticals. FX01 is complete; the remaining gaps belong to FX02, FX03, CF01,
delivery, public adoption, or later product gates:

| Current artifact | Evidence | Gap |
| --- | --- | --- |
| `flarex-protocol/internal/scope-sync-v1` and `scope-sync-query-model-v1` | strict scope/cursor values plus completed canonical query, dependency, authority, result, and publication mappings | concrete Flarex contracts only; they do not own portable transitions or host state |
| deleted `deploymentSync/Policy.ts` | historical Flarex projection/query-generation evidence was retired in C1 | must remain deleted rather than returning as a second policy owner |
| `deploymentSync/Store.ts` | completed generation-4 authenticated binding and normalized nine-operation adapter, including evaluation and publication lifecycle state, rollback, recovery, corruption, exact limits, and CAS proof | no source/evaluator host composition, publisher or delivery adapter, public export, or production caller |
| `DeploymentSyncDO` | deterministic per-scope SQLite-backed placement | empty shell only; no engine instance, adapter composition, host callback, wake, alarm, or production caller |
| `commitFeed.ts` | repeatable-read dense scope-lifetime commits with row and relation facts | a page can span epochs and omits coherent active-head/generation/fence evidence |
| `scopeSyncActiveHeadObservationV1.ts` | trusted scoped active-head and storage-fence observation | separate from retention and commit-page capture; two separate calls are not a coherent source receipt |
| Flarex Value Codec V1 | canonical result bytes plus SHA-256 evidence | generic value limits can exceed query-sync's one-megabyte inline publication ceiling |
| `ConnectionDO` and Legacy live-query persistence | gateway, client-query, WebSocket, and delivery evidence | query-first registration race, separate registry, and client-specific delivery; not a `ResultPublisher` or target state owner |

The current Postgres feed is scope-lifetime ordered, while a portable source
page is bound to one model and epoch. Mixed-epoch lower-level pages are legal
Flarex history and illegal portable pages. FX02 must derive the effective
current-epoch replay edge and return reset rather than feed an earlier epoch
through admission.

The current feed read and active-head read also cannot be called
"coherent." FX02 must use one persistence-owned scoped read transaction, or an
equally strong fenced protocol, that captures generation, generation fence,
current epoch, latest sequence, current-epoch retention edge, active head, and
the selected current-epoch commits. The completed FX01-A checkpoint froze the
value mapping needed by that later read; it did not implement or modify the
Postgres operation.

The current feed also exposes no exact raw transport-byte receipt. FX02 must
define and bound the actual persistence-owned source representation before it
is decoded or materialized, then report every consumed byte, including input
later discarded by projection. If the driver cannot expose those bytes, FX02
needs a bounded framed SQL receipt or a separately preflighted correction to
the portable source contract. Canonical semantic-frame bytes, an object count,
a constant, or a JavaScript heap-size estimate are not admissible substitutes.

## Proposed Flarex Query Model

### Model identity

The completed FX01-A checkpoint defines one host-owned constant sync model ID:

```text
flarexdb.application-query.v1
```

The value is never caller supplied. It identifies the complete projection and
authority semantics below. Adding a dependency variant, narrowing the current
conservative table fallback, changing authority-witness fields, or changing a
canonical frame requires a new model ID plus an explicit reset/adoption gate;
it is not an in-place behavior change.

### Lossless primitive mappings

| Flarex authority | Portable value | Rule |
| --- | --- | --- |
| trusted `ScopeUuidV1` | `SyncNamespaceId` | exact UUID spelling after trusted scope resolution; no browser/body authority |
| fixed model constant | `SyncModelId` | exact constant above |
| current `ScopeEpochUuidV1` | `SyncEpoch` | exact UUID spelling |
| `CommitSeq` | `SyncSequence` and query snapshot | exact bounded `bigint`; never convert through `number` |
| canonical query frame SHA-256 bytes | `CanonicalQueryKey` | unpadded base64url of the raw 32 digest bytes, never of hexadecimal text |
| canonical query frame bytes | `CanonicalQueryIdentity` | unpadded base64url of the exact canonical bytes |
| canonical dependency frame bytes | `CanonicalDependencyKey` | unpadded base64url of the exact canonical bytes; do not hash away decode/collision evidence |
| canonical authority frame SHA-256 bytes | `QueryAuthorityWitness` | unpadded base64url of the raw 32 digest bytes |
| Flarex Value V1 SHA-256 bytes | `QueryResultDigest` | unpadded base64url of the raw 32 digest bytes |
| Flarex Value V1 canonical bytes | `CanonicalPublicationContent` | unpadded base64url of the exact bytes, subject to the engine's decoded one-megabyte limit |

Lowercase hexadecimal and unpadded base64url are representations of the same
bytes only after strict decoding. Hashing hexadecimal text, UTF-16 strings, an
ordinary object, or implementation-dependent `JSON.stringify` output is
forbidden.

### Versioned canonical frames

FX01-A added a dedicated internal query-model V1 module to `flarex-protocol`
rather than put Flarex types into `@flarex/query-sync`. It owns these three
exact, domain-separated canonical JSON frames, all at numeric version `1`:

1. **query-key frame:** format
   `flarex.scope-sync-canonical-query-key`, version `1`, and exactly one
   `identity` field containing the complete existing
   `ScopeSyncCanonicalQueryIdentityV1`, including null-versus-text component
   path and its existing canonical decimal/hash spellings;
2. **dependency frame:** the complete existing
   `ScopeSyncDependencyKeyV1`, whose format is
   `flarex.scope-sync-dependency-key`, version is `1`, and whose exact variant
   is point row, conservative table, or incoming relation; and
3. **authority frame:** format `flarex.scope-sync-query-authority`, version
   `1`, with exact fields `scopeUuid`, `syncModelId`, `epochUuid`,
   `storageGeneration`, `storageGenerationFence`, `activationSequence`, and
   `activeHeadSha256Hex`. The two sequence fields use canonical positive
   decimal text and the digest uses strict lowercase hexadecimal.

The query frame embeds the encoded representation of the existing identity;
the dependency frame uses the encoded representation of the existing union.
All three pass through the protocol's existing `encodeCanonicalJson` contract
and then UTF-8 encoding. No caller-controlled insertion order, whitespace,
locale, or host serializer participates.

The query-key frame is capped at 131,072 decoded bytes and the dependency
frame at 16,384 decoded bytes, matching the portable admission ceilings. The
authority frame is capped at 4,096 decoded bytes, comfortably above its fixed
bounded fields. None of these limits are inferred from encoded-string length
or a database row limit.

The authority frame deliberately excludes the observed commit/read-through
sequence. `CaughtUpChangeAuthority` already binds the exact read-through
sequence separately. Including it in the witness would make every later but
irrelevant commit change the witness and force resnapshot instead of allowing
dependency refresh. The witness changes only when the semantic storage/head
authority changes.

The query-key and authority frames use one protocol-owned narrow SHA-256
Effect capability. The backend supplies the live Web Crypto implementation.
Tests supply deterministic implementations and may inject equal query-key
digests solely to prove full-identity collision refusal. Digest length is
checked before branding. Foreign crypto failures remain typed at the protocol
boundary, and unexpected defects remain defects.

Canonicalization returns an owned immutable nominal receipt containing the
decoded domain value, canonical text, copied bytes, and copied digest where
applicable. Decode must parse the strict envelope, re-encode it, require
byte-for-byte canonical equality, recompute a supplied digest at the Effect
codec boundary, and reject malformed, oversized, noncanonical, wrong-length,
or digest-inconsistent evidence. Query-identity comparison separately rejects
equal lookup digests with unequal canonical bytes because state retains both.
Authority witnesses and result digests retain only their digest and therefore
rely on SHA-256 collision resistance; FX01 must not claim typed collision
detection for either.

### Query identity and collision behavior

The existing `ScopeSyncCanonicalQueryIdentityV1` remains the concrete Flarex
identity. It includes scope, epoch, Application activation/head, source-package
digest, schema, policy, component/function path, arguments digest, and
effective identity/access-policy fingerprint. It does not contain raw query
arguments.

The 32-byte query key is only a lookup and sharing key. The complete canonical
identity bytes remain stored beside it. Presenting the same key with different
canonical identity bytes is a typed collision and leaves state unchanged. It
never aliases queries, overwrites the first identity, adds a secondary hash,
or falls back to raw object comparison.

### Dependency and committed-fact projection

The admitted Flarex model has exactly three dependency variants:

- exact application row;
- conservative application table for the current index/range read; and
- exact incoming relation occurrence keyed by edge definition and target row.

The existing conservative projection remains the semantic input:

- each application-row change projects the exact row key and its table key;
- each incoming relation-adjacency fact projects its exact incoming relation
  key;
- an outgoing relation fact projects no key because the admitted query model
  has no outgoing dependency variant; it is still examined and counted; and
- every commit produces exactly one source batch, including a commit whose
  projected dependency set is empty.

Supporting outgoing relation queries or precise index ranges requires a new
protocol dependency variant and a sync-model-ID change. FX01-A must not invent
an opaque catch-all key or broaden the portable package.

The projector revalidates namespace, model, epoch, and sequence against the
source envelope. It normalizes keys through the portable admission contract,
counts every inspected semantic unit and canonical byte, stops at
limit-plus-one, and returns the existing typed budget/projection errors. It
does not estimate JavaScript heap size or report a constant placeholder.

The accepted V1 semantic accounting is deterministic and part of the fixed
model ID. A commit batch contributes one semantic work unit and zero semantic
bytes. Each application-row fact contributes one work unit and 20 bytes: a
four-byte table identity plus a sixteen-byte row identity. Each relation fact
contributes one work unit and 21 bytes: a four-byte edge identity, one-byte
direction, and sixteen-byte endpoint identity. Outgoing relation facts consume
those 21 bytes even though this model projects no outgoing dependency key.
Source transport bytes remain the later persistence source's separate receipt;
these semantic widths are never a JavaScript heap estimate or substitute for
that transport measurement.

### Authority projection

Both a later source terminal observation and a later query-execution receipt
must carry the same strict `ScopeSyncQueryAuthorityV1` fields. The Effectful
source/evaluator boundary canonicalizes and hashes those fields into an owned
`ScopeSyncQueryAuthorityEvidenceV1` receipt before calling a portable port.
Actual source-side minting remains FX02. The synchronous
`InvalidationProjector` accepts that already-captured receipt, revalidates its
namespace/model/epoch and bounded semantic accounting, and purely maps its
copied digest into the portable witness. It never runs Effect, Web Crypto, or a
nested runtime. Query evaluation uses the same Effectful canonicalizer before
building its evidence.

An active-head hash by itself is insufficient: storage generation/fence,
epoch, model, and activation sequence are authority. A commit sequence by
itself is progress, not semantic authority. A mismatch causes the existing
portable resnapshot decision; adapters must not weaken it to rerun or ignore.

### Query result and publication content

FX01-A reuses Flarex Value Codec V1. One successfully validated query result is
canonicalized once:

- its copied canonical value bytes become publication content;
- the SHA-256 of those exact bytes becomes the result digest; and
- dependencies, snapshot, and authority frame from the same trusted execution
  receipt become evaluation evidence.

Digest and content must remain coupled by the same canonicalization receipt.
Callers cannot provide them independently. A canonical result whose bytes
exceed `MAX_INLINE_PUBLICATION_CONTENT_BYTES` fails with a Flarex mapping
error; it is never truncated, externally stored, or silently accepted in
FX01-A. External large-result references would be a separate product and
delivery contract.

The content is a delivery-neutral semantic Flarex value. It is not a Durable
Streams record, WebSocket message, client query ID, ConnectionDO payload, or
transport offset. Later publishers receive the already-persisted portable
publication and adapt it to their accepted transport.

## QSYNC-FX01-A: First Medium Implementation Slice

After explicit approval, FX01-A may touch only the mapping and codec boundary:

```text
packages/flarex-protocol/src/scope-sync-query-model-v1.ts          new
packages/flarex-protocol/test/scope-sync-query-model-v1.test.ts    new
packages/flarex-protocol/package.json                              internal export
packages/flarex-backend/src/deploymentSync/QuerySyncModel.ts       new
packages/flarex-backend/src/deploymentSync/index.ts                private export only if required
packages/flarex-backend/test/deploymentSyncQuerySyncModel.test.ts  new
packages/flarex-backend/package.json                               add @flarex/query-sync
pnpm-lock.yaml                                                     dependency receipt
```

A separate backend file may own the live SHA-256 Layer if existing protocol
crypto construction cannot be reused exactly. Do not put a Cloudflare global,
Durable Object, database handle, or runtime runner in `QuerySyncModel.ts`.

The slice adds:

- the fixed model ID and exact primitive capture functions;
- versioned query, dependency, and authority canonical evidence;
- one `InvalidationProjector<CommitFeedCommitV1,
  ScopeSyncQueryAuthorityEvidenceV1>` whose two projection methods remain pure
  `Result` operations;
- query-descriptor and evaluation-evidence mapping;
- canonical Flarex result-to-publication mapping; and
- typed, operation-specific Flarex mapping/codec errors.

It may reuse the existing point/table/incoming projection mechanics, but it
must not retain two independently implemented projection algorithms. If those
mechanics move, current private wrappers may delegate only when an inspected
consumer requires them; unused query-generation/projection evidence is
removed at the later no-dual-engine cutover rather than expanded.

FX01-A must not modify `packages/query-sync`, the Postgres commit feed,
`ScopeExecution`, the current SQLite schema, `DeploymentSyncDO`, ConnectionDO,
the query runner, or any delivery path.

### FX01-A proof matrix

Focused tests must prove:

1. exact scope/model/epoch/sequence mappings, signed-int64 boundaries, and no
   `number` round trip;
2. stable golden canonical text, bytes, query key, dependency keys, authority
   witness, result digest, and publication content;
3. field sensitivity for every query-identity and authority field, including
   null versus text component path;
4. domain separation among query, dependency, authority, and value frames;
5. strict decoding, canonical re-encoding, wrong digest, wrong length,
   noncanonical bytes, and injected query-key collision comparison refusal;
6. all three dependency variants, strict ordering/uniqueness, exact row plus
   table invalidation, incoming relation invalidation, counted outgoing facts,
   and an empty projected commit;
7. committed-batch envelope scope/epoch/sequence mismatch and authority-evidence
   scope/model/epoch mismatch before successful projection; the terminal
   read-through sequence remains separately bound by `CaughtUpChangeAuthority`;
8. limit-plus-one behavior for semantic work, semantic bytes, dependency
   examinations, canonical dependency bytes, identity bytes, dependency bytes,
   and publication content;
9. one canonical result receipt producing coupled content and digest;
10. copied/frozen outputs and no caller-owned byte-array aliasing;
11. deterministic field-sensitivity/golden vectors under the pinned live/test
    SHA implementation: changing the application/scope, epoch, model, identity,
    or access fingerprint changes the expected query key or witness in those
    vectors, without claiming universal digest non-collision; and
12. current protocol/backend tests remaining green without a caller, schema,
    route, or Durable Object behavior change.

This is sufficient as a medium slice: it closes the compatibility vocabulary
that every later state/source/evaluator adapter consumes, while remaining
deterministic and production-inert.

## QSYNC-FX01-B Verdict And Staged SQLite Target

The following constraints remain the broad staged target. C1's exact
generation-2 DDL, C2's generation-3 evaluation extension, and C3's generation-4
publication-lifecycle extension are implemented authority; all three exit
proofs are complete. The
completed docs-only B checkpoint enumerates every operation's bounded read set,
portable transition/decision seam, exact write set, receipt, rollback point,
and required logical access path in
[`08-qsync-fx01-b-semantic-persistence-verdict.md`](./08-qsync-fx01-b-semantic-persistence-verdict.md).

At the B checkpoint, the then-current portable transition functions accepted
the complete aggregate. B proved that every operation was logically bounded
but could not reuse those reducers without loading the maximum aggregate or
reproducing material portable logic in SQL. It therefore stopped before schema
and proposed the separate `QSYNC01-D` preflight. D1-D4 have since completed the
planner seam, and C1-C3 have implemented the three private SQLite verticals.
No schema-only implementation slice was allowed.

### Construction and lifecycle

Current named Durable Object routing exposes `ctx.id.name`. Construction
strictly parses the exact `deployment-sync:${scopeUuid}` spelling and fails
closed when the name is absent, oversized, malformed, or reached through a
path such as `idFromString` that does not retain it. The parsed scope is
placement evidence, not authorization.

The adapter factory therefore accepts the captured route name,
`DurableObjectState`/SQL storage, and one coherent trusted
`ScopeSyncActiveHeadObservationV1` obtained by a later authenticated FX02 host
call. It requires the routed scope to equal the observation scope, then derives
an owned per-turn binding containing the expected scope, fixed model, epoch,
storage generation and fence. The bootstrap cursor must agree exactly with the
observation's scope, epoch, observed commit sequence, and the fixed model; a
fresh row may be created only from this trusted observation. Initialization
classifies stored model or epoch replacement using the portable receipt
contract. Every other operation checks stored authority against the
closed-over binding before reading or mutating semantic rows.

An active-head observation proves binding but does not prove that an empty
database has never held coordination state. Creating an absent row additionally
requires a nominal one-use fresh-initialization authorization supplied by the
host. FX01 conformance may use a test capability, but no production mint is
authorized here. Before callers exist, FX03 must bind that mint to durable
external first-use/reset evidence; eviction or constructor re-entry alone never
authorizes silent reinitialization.

That factory yields one plain namespace-bound adapter for the object/turn. It
is a dynamic multi-instance value, not a Context singleton or module global. A
Layer may construct shared stateless host capabilities, but it must not
collapse per-object binding or storage into one service instance. A missing or
changed generation/fence is reset/incompatibility evidence, never permission to
silently rebind an existing row.

Every semantic operation is an environment-closed Effect. Its SQLite
transaction body is synchronous, contains no `await`, network call, Effect
runtime call, query execution, publication, wake, alarm, or transaction handle
escape. The real Effect runtime bridge remains at a later Durable Object RPC or
event callback in FX02.

Cloudflare documents that `transactionSync` rolls back when its synchronous
callback throws and that SQL cursors do not remain stable across `await`.
Adapter rows are fully consumed, validated, detached, and frozen before the
transaction returns.

`claimPublication` and `recordPublicationAttemptOutcome` read and validate one
millisecond instant synchronously from SQLite inside the same
`transactionSync`, before invoking the pure transition, then pass that one
`PublicationAttemptInstant` through the decision. A deterministic synchronous
reader may be injected for adapter conformance. No callback reads `Date.now`,
invokes Effect, or runs a nested runtime. The exact production SQL spelling is
deferred; inability to satisfy this state-owned transaction/database-clock
contract requires an explicit superseding preflight.

### Storage shape

Do not persist one monolithic serialized `QuerySyncState`. Cloudflare's current
SQLite limits cap a string, BLOB, or row at 2 MB and a statement at 100 bound
parameters, while the portable aggregate intentionally admits larger bounded
state. The adapter uses normalized rows and operation-scoped reads.

The candidate normalized families below are retained only as logical research.
B did not accept them as tables or authorize their DDL:

| Logical table family | Owned state |
| --- | --- |
| scope singleton | local adapter-contract generation, Flarex storage generation/fence, namespace/model/epoch/cursor, evaluation work revision/fairness anchor, exact aggregate counters |
| query rows | complete identity, active/provisional scalar state, current completion scalar fingerprint, preceding completion identity |
| query dependency rows | exact canonical keys separated by active versus completion-fingerprint ownership and generation |
| publication rows | pending or in-flight immutable publication identity, query identity, sequence, digest, and canonical content |
| publication singleton | in-flight attempt metadata/disposition, latest-delivered tombstone, and preceding-attempt outcome/receipt |

All bigint-backed values use canonical decimal text. Publication attempt
instants also use canonical decimal text so the JavaScript SQL driver never
round-trips a safe integer through a potentially imprecise SQLite numeric
conversion. Fixed ordinals and bounded counters may use checked integers.

Canonical query keys, identities, dependency keys, result digests, authority
witnesses, and content use their admitted unpadded base64url spellings. The
full query identity remains beside its key for collision detection. Every row
has an exact parent and generation; orphan, duplicate, wrong-role,
wrong-generation, missing, excess, malformed, noncanonical, or counter-
inconsistent rows are corruption.

The first accepted C vertical, C1, upgraded the existing
`deployment_sync_scope_state` atomically in place only from its exact
cursor-only generation, preserving scope, epoch, fence, and sequence. An
unknown or malformed prior generation fails incompatible or corrupt; it is
never deleted, reset, copied into a second table set, or silently initialized.
No new Durable Object class or binding was required. B itself wrote no DDL and
did not increment a local storage generation.

### No aggregate-load shortcut

Production operations use indexes and read only the bounded rows required by
that operation. The testing-only conformance target may reconstruct a complete
normalized aggregate after an operation for oracle comparison.

The completed B verdict identified the required portable transition-plan seam.
The accepted D0 record froze its contract, and completed D1-D4 now let every
operation reuse accepted portable semantics without loading the entire maximum
aggregate or reimplementing a material decision in host SQL. Do not bypass
that seam with an 8 MB blob, a reduced unrecorded limit, a second reducer, or
test-only logic copied into production.

### Nine atomic operations

The completed C3 adapter implements exactly the current
`QuerySyncTransitionState`. C1/C2 implemented only their package-private
vertical operations and never published a partial object under that complete
interface:

| Operation | Minimum same-transaction authority |
| --- | --- |
| `initializeOrInspectNamespace` | storage generation plus exact bound namespace/model/epoch/cursor; create-if-absent only |
| `beginQueryEvaluation` | scope binding, current cursor, complete query identity/key collision check, active/provisional generation and evaluation disposition |
| `applyAdmittedBatchAndAdvance` | exact cursor decision, reverse dependency lookup, every affected dirty frontier, work revision, counters, and cursor advance |
| `completeQueryEvaluation` | exact issued attempt, provisional/active generation, current cursor, evaluation/refresh evidence, dependency replacement, completion fingerprint, result state, and pending publication intent in one commit |
| `claimEvaluationWork` | revision/fairness anchor, bounded ordered scan, selected query disposition, and exact attempt evidence |
| `recordEvaluationAttemptOutcome` | exact attempt, current provisional generation/disposition, replay evidence, and blocked/reset-required outcome |
| `claimPublication` | in-flight recovery precedence, deterministic pending order, attempt time/ordinal/disposition, publication row, and settlement counters |
| `recordPublicationAttemptOutcome` | exact in-flight identity/digest/ordinal, prior outcome replay, next ordinal/disposition or blocked state |
| `completePublication` | exact nominal acceptance evidence, in-flight row, latest-delivered tombstone, preceding outcome, and counters; pending was already moved/deleted during claim |

No transaction performs query execution, source read, authority observation,
publisher append, client fanout, or another state operation. External work
always happens after a receipt commits and before the next semantic operation.

The old cursor-only `advance` path and unused backend-local query-generation
policy were removed in C1. They must not return as a compatibility bypass,
including when no query row exists. There is no dual write or fallback.

### Effect and integration errors

The adapter preserves the existing closed state error vocabulary:

- only an explicitly recognized transient/busy/locked platform or SQL failure
  known to have rolled back maps to the matching operation's
  unavailable/contention error with `notCommitted` certainty;
- a response whose commit result truly cannot be established remains
  `QuerySyncStateCommitOutcomeUnknownError`; it is never relabeled rollback;
- malformed or mutually inconsistent admitted rows are
  `QuerySyncStoredStateCorruptError`;
- an unsupported storage-contract generation is
  `QuerySyncStoredStateIncompatibleError`;
- a documented adapter quota or lower admitted capacity is
  `QuerySyncStateCapacityError`; and
- unrecognized SQL, constraint, schema-programming, kernel invariant, and
  adapter-programming failures remain defects with their cause, while
  interruption and cancellation preserve their full Effect Cause.

Cloudflare's synchronous local transaction may not naturally produce an
unknown result after returning an error. Do not synthesize that error merely
to exercise the type. Lost host responses are handled by the engine's exact
operation replay contracts; test fault wrappers may still inject the unknown
outcome at the semantic boundary.

Property access, cursor iteration, and row decoding failures are classified
once at the storage boundary. Recognized malformed stored rows become corrupt;
foreign access/driver defects are not laundered into corruption or transient
unavailability. A broad catch must not turn kernel defects, programmer errors,
deterministic SQL mistakes, or cancellation into an ordinary retryable error.

### SQLite and Workerd proof

FX01-C3 ran the shared state conformance histories against the real adapter and
compared every receipt plus the testing-only normalized snapshot with the
reference oracle. Its
[`exit evidence`](./12-qsync-fx01-c3-publication-lifecycle.md#exit-evidence)
records the phase-4 exact maximum/plus-one, query-plan, and pinned local Workerd
evidence without converting that local harness into a deployed-Cloudflare
claim. The retained matrix additionally proves:

- fresh construction, exact cursor-only upgrade, constructor re-entry, object
  disposal/recreation, and persisted reopen; deployed Cloudflare eviction and
  hibernation proof is deferred to FX02 host composition;
- every operation's commit and rollback path;
- exact replay after simulated response loss for initialize, begin, complete,
  outcome recording, and publication completion;
- reverse lookup and dirty-frontier updates for point, table, and relation
  keys, including empty batches;
- active/provisional coexistence and no newer work overtaking unresolved
  evaluation or publication work;
- atomic active/dependency/fingerprint/publication replacement;
- pending/in-flight/delivered publication recovery and content preservation;
- signed-int64 and safe-integer boundary round trips without numeric loss;
- identity collision, dependency/content maximums, capacity refusal, and exact
  counters;
- malformed, noncanonical, duplicate, missing, excess, orphan, wrong-parent,
  wrong-generation, and unsupported-generation refusal;
- transaction failure preserving the complete previous readable state;
- two object namespaces never sharing SQLite or in-memory state;
- exact named-route parsing plus fail-closed missing, malformed, and
  authenticated-binding-mismatch cases;
- no module-global state and no cursor/transaction surviving an `await`; and
- the old direct cursor path unable to advance around invalidation routing.

PGlite and Postgres are not SQLite-adapter proof. In-memory fakes are not
Workerd transaction, constructor, disposal/recreation, or persisted-reopen
proof. Conversely, pinned local Workerd disposal/recreation does not prove
deployed Cloudflare eviction or hibernation, the later Postgres source, or a
real Cloudflare delivery adapter.

## Proposed Current-To-Target Disposition

| Artifact | FX01 disposition |
| --- | --- |
| `@flarex/query-sync` | provides the completed private operation-scoped transition-plan seam; remains Flarex-, SQL-, driver-, and Cloudflare-free with no package-root export |
| `scope-sync-v1.ts` and `scope-sync-query-model-v1.ts` | retain the completed strict domain types and canonical query-model frames from A; do not move portable semantics into them |
| deleted `deploymentSync/Policy.ts` | C1 removed the displaced backend-local policy; do not recreate a second reducer or compatibility policy |
| `deploymentSync/Model.ts` | retain only Flarex adapter/domain errors still owned by backend; do not mirror portable state unions |
| `deploymentSync/Store.ts` | now composes the completed generation-4 nine-operation adapter over the same SQLite authority, with no second cursor or query table set |
| `DeploymentSyncDO` | remains an empty production-inert shell; a later FX02 host call supplies authenticated binding evidence to the adapter factory, and no callable surface is authorized in FX01 |
| Postgres commit feed and scope observation | unchanged in FX01; exact correlated source read is FX02 |
| Legacy subscription/delivery registry | no new caller, dual write, comparison, fallback, or migration in FX01 |
| ConnectionDO/client protocol | unchanged; later gateway/client adoption is FX03 |

## Platform Evidence And Limits

Cloudflare platform evidence was rechecked on 2026-08-29 against the official
[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Durable Object ID](https://developers.cloudflare.com/durable-objects/api/id/),
and
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

The adapter design relies only on documented facts:

- SQLite-backed objects expose synchronous SQL and `transactionSync`; a thrown
  callback rolls back;
- SQL cursors must be consumed synchronously rather than retained across an
  `await`;
- `ctx.id.name` retains a name supplied through `getByName`/`idFromName`, while
  `idFromString`, unique IDs, and over-1,024-byte names can leave it undefined;
- the current maximum string, BLOB, or table-row size is 2 MB, statement
  bindings are capped at 100, and each SQLite-backed object is capped at 10 GB;
- in-memory state is discarded on eviction/hibernation and constructors run
  again; and
- important state therefore remains in SQLite, while cached decoded values are
  disposable.

Current limits are adapter configuration evidence, not portable engine
constants. A future platform change does not silently widen Flarex policy; it
requires revalidation and an explicit limit decision.

## Explicitly Not Authorized

This umbrella and the completed FX01-A/B/C1/C2/C3 checkpoints do not authorize:

- a Postgres `ReplayableChangeSource`, correlated source read implementation,
  catch-up loop, wake, checkpoint mirror, or retention change;
- query execution, ApplicationQuerySystem changes, evaluator composition, or
  modification of application-runtime receipts;
- a real `ResultPublisher`, Durable Streams/Electric acceptance, DeliveryDO,
  WebSocket append, HTTP/fetch, stream, queue, or client fanout;
- `DeploymentSyncDO` RPC/fetch/alarm/scheduled methods or a production caller;
- ConnectionDO, Legacy subscription, delivery-outbox, or client protocol
  migration;
- a second registry, table set, engine, cursor, dual write, shadow run,
  comparison, fallback, silent reset, or compatibility route;
- changes to OCC, commit compilation/execution, journals, idempotency
  outcomes, authoritative rows, commit publication, retention, or application
  outbox;
- a public package/API/SDK, Payload adapter, public relation syntax, `R03-B`,
  `SV-R Live`, or a production/reactive product claim;
- reset/eviction/release transitions not present in the current nine-operation
  state port; or
- a runtime-portability claim before the same conformance contract passes on a
  second real durable host.

`QSYNC-CF01` remains the independent delivery feasibility/selection gate.
`QSYNC-FX02` is now unblocked as the next preflight for the Postgres source,
authenticated query evaluation, host orchestration, and deployed
eviction/hibernation evidence; it is not implemented. `QSYNC-FX03` remains
delivery, gateway/client,
reconnect/reset, target-only cutover, Legacy retirement, and `R03-B` adoption.

## Validation And Review Gates

Each implementation subgate must run its affected package typechecks and tests,
focused boundary/adversarial suites, `pnpm lint:core`, `pnpm lint:diff`, the
Effect runtime-boundary audit, forbidden dependency/import/export audits, and
`git diff --check`.

Significant TypeScript checkpoints require both standing final-diff reviewers
after the main thread's lint gates. The final index must pass
`pnpm lint:diff -- --staged`. Protocol crypto and mapping work must apply the
repository's Effect and typed-error guidance. SQLite work additionally requires
real Workerd evidence; reference and mock receipts must be labeled accurately.

## Discussion Checkpoint And Next Action

`QSYNC-FX01-A`, the docs-only `QSYNC-FX01-B` checkpoint, D1-D4, and C1-C3 are
complete. The accepted
[`QSYNC-FX01-C3` record](./12-qsync-fx01-c3-publication-lifecycle.md) closes the
generation-4 publication lifecycle and complete private nine-operation adapter
with Node SQLite and pinned local Workerd rollback/disposal-recreate/reopen
proof. `QSYNC-FX01` is complete, package-private, unrouted, and
production-inert.

The next correctness work is a separate `QSYNC-FX02` preflight. FX01 completion
unblocks that preflight; it does not implement the Postgres source, evaluator or
host composition, prove deployed Cloudflare eviction/hibernation, choose or
implement delivery, expose a public API, or unblock FX03, CF01, or `R03-B`.
