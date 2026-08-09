# FlarexDB Commit Compiler Plan

Status: active; S06 row storage, S07 physical session/snapshot-lease DDL, and
O04/O05 point dependency and validation contracts exist. Standalone C01 was
retired before implementation. C02's host-neutral logical journal, successful-
result, and finish-envelope protocol, C03's first trusted Postgres point-
journal consumer, C04A's private stored-attempt authentication, and C04B1's
private commit-authority authentication are complete. C04B2's private-C07
final-document/result proof is also complete. Corrected C04C1 private logical
point planning, S08 commit/feed DDL, and S09-A private committed-success DDL are
complete. S09-B's fixed-kind private commit-wake DDL and fenced repository are
also complete. O06's reusable private point-commit transaction kernel and
forced-rollback proof, O07-A private read-only committed-outcome resolver, and
  O07-B private durable point publication are complete. C05-A's private scalar-
  fenced finishing transition and same-factory continuation are complete. C05-B
  fresh-process reconstruction and private compiler/publisher composition are
  also complete. O08-A atomic exact-attempt replacement, O08-B1 bounded
  same-factory fresh-attempt handoff, and O08-B2a same-process runtime-neutral
  rerun composition, O08-B2b0's Postgres claim-authority decision, integrated
  O08-B2b1/C06-A durable claim admission, O08-CD0 transaction-decision
  provenance, O08-C known-settled SQL retry, and O08-D bounded uncertainty
  recovery are complete. O08-B2b2a private exact-selector safe-state redispatch,
  O08-B2b2b1 bounded inert discovery, and O08-B2b2b2a durable dirty/failed-
  attempt disposition are complete. O08-B2b2b2b0a's value-based grant/
  retention policy coherence and O08-B2b2b2b0b's atomic seal-time lease
  promotion, O08-B2b2b2b1a phase-aware renewal, and O08-B2b2b2b1b1
  host-neutral structured liveness, O08-B2b2b2b1b2a bounded single-page
  redelivery, O08-B2b2b2b1b2b1 inert scope enumeration, and O08-
  B2b2b2b1b2b2a private count-bounded multi-scope composition are complete,
  as are O08-B2b2b2b1b2b2b0's inert singleton scheduler-checkpoint persistence
  and O08-B2b2b2b1b2b2b1's private bounded scheduler-run composition. The
  production trigger/redelivery host and C06-B endpoint/response policy remain
  pending under
  [`37-production-redelivery-and-c06b.md`](../37-production-redelivery-and-c06b.md),
  while C04C2 remains conditional and
  unapproved.

This plan owns the bounded Flarex app-data path from logical session operations
through a private logical point plan to an atomic commit. It does not make a
SessionDO journal authoritative, does not compile arbitrary Payload or Medusa
transactions, and does not promise unsupported query overlays.

The first executable outcome is one point app mutation through the new schema
and OCC lane. Immediately after its real-Postgres correctness gate, measure the
hosted journal round trips. If they cross a predeclared material-improvement
threshold, moving the proven journal into a per-session supervisor/per-attempt
facet is the next checkpoint before derived sidecars; it is not the starting
point and is not unconditional.

The hosted production composition is a dedicated private Cloudflare executor
Worker backed by cache-disabled Hyperdrive. The compiler and executor ports
remain host-neutral. Generated Dynamic Workers continue to use the stable
private `/invoke/*` Fetch protocol for the first host; Nitro/Vercel is an
optional compatibility lane, not the forward production owner.

## Prerequisite Handoff

Do not execute the compiler against production/canary scopes until the schema
and OCC plans provide:

- branded `ScopeId`, `ScopeEpoch`, `CommitSeq`, `SnapshotToken`, and
  `StorageGeneration`;
- trusted scope/generation resolution and a pinned active catalog;
- tagged value and ordered-key codecs;
- app row revision/current storage;
- scope clock and short commit-lane primitive;
- fenced session anchor and snapshot lease;
- result-bearing idempotency, commit/change, and outbox storage;
- exact point-row read dependencies and point OCC validation.

Protocol/types and pure planner work may begin earlier according to the
interleaved master order in [README.md](./README.md).

## Authoritative Inputs

- [Accepted commit compiler trust boundary](../../design-notes/flarex-db-accepted-design.md)
- [Focused compiler/session roadmap](../35-commit-compiler-and-session-intent.md)
- [V1 schema and implementation order](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
- [Long-form mutation flow](../../design-notes/flarex-internal-db-schema.md)
- [Postgres executor roadmap](../20-postgres-executor.md)

Current implementation evidence:

- [`packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  delegates mutation finish directly to persistence.
- [`packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  currently mixes logical planning, read validation, timestamp allocation,
  physical writes, index maintenance, commit/outbox publication, and session
  completion.
- [`packages/executor/src/retry.ts`](../../packages/executor/src/retry.ts)
  currently combines retry classes.
- [`packages/executor/src/types.ts`](../../packages/executor/src/types.ts)
  currently spans metadata, sessions, app storage, commits, outbox, and live
  query delivery in one persistence interface.

Convex-first implementation references:

- [`crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  for transaction-local read/write state and read-your-writes;
- [`crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  for bounded typed dependencies;
- [`crates/common/src/knobs.rs`](../../../../crates/common/src/knobs.rs) and
  [`crates/database/src/execution_size.rs`](../../../../crates/database/src/execution_size.rs)
  for the exact execution-limit constants and dimensions;
- [`crates/database/src/writes.rs`](../../../../crates/database/src/writes.rs)
  for pre-coalescing write-operation and resulting-document byte accounting;
- [`crates/isolate/src/helpers.rs`](../../../../crates/isolate/src/helpers.rs)
  for successful-result semantic-size enforcement;
- [`crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  for validation, deterministic write derivation, and ordered publication;
- [`crates/model/src/session_requests/types.rs`](../../../../crates/model/src/session_requests/types.rs)
  and
  [`crates/application/src/application_function_runner/mod.rs`](../../../../crates/application/src/application_function_runner/mod.rs)
  for prior-outcome lookup and atomic successful-result storage.

## Compiler Boundary

```text
SessionJournalV1
  logical point-read dependencies and raw logical app-write events

SuccessfulResultEvidenceV1
  separate canonical Value Codec bytes, semantic size, and digest
             |
CommitEnvelopeV1
  session id, attempt fence, protocol versions, final syscall sequence,
  stored-for-attempt or dormant inline-untrusted journal carriage and digest,
  sibling successful-result evidence
             |
AuthenticatedStoredAttemptV1 (introduced by C04A)
  runtime-unforgeable process-local proof of the exact stored seal
             |
AuthenticatedCommitAuthorityV1 (introduced by C04B1)
  same-factory proof of current arguments, grant, revocation, schema, and
  immutable proof-only function metadata
             |
VerifiedCommitInput (introduced by C04B2)
  same-factory logical proof using already-authenticated pinned proof validators
             |
PointCommitPlannerV1 (introduced by C04C1)
  same-factory database-free logical point/dependency lowering
             |
PreparedPointCommitV1 (introduced by C04C1)
  internal immutable dependencies, successful result, and O09-A-bounded
  canonically ordered final logical row intents; no SQL or publication authority
             |
O06 point-commit transaction kernel
  same-factory unwrapping, closed persistence command, current authority locks,
  scalar revalidation, O05, tentative physical row lowering, forced rollback
             |
O07-A committed-outcome resolver
  one bounded outcome/clock/floor/header statement plus post-SQL canonical
  evidence verification; its closed structural input is not commit authority
             |
O07-B CommitExecutor
  reuse of the O06 kernel plus sequence/time allocation and atomic durable
  data/outcome/feed/outbox/session publication
```

The process-local capability runtime is an explicitly constructed per-instance
value, not a singleton `Context` service. One private factory-local vault owns
the complete same-factory capability chain. Callers select a named constructor
for the exact lifecycle facet they require (authentication, planning, rollback
proof, publication, finishing, execution, attempt replacement, OCC rerun, or
crash redispatch); the former configuration-shape-dependent public overload is
not retained. These constructors remain internal source seams and are not
package-root exports. The behavior-preserving decomposition of this runtime is
owned by
[`../36-stored-attempt-capability-runtime-modularization.md`](../36-stored-attempt-capability-runtime-modularization.md);
that focused plan cannot change the lifecycle, authority, transaction, retry,
or recovery contracts owned here.

The journal/envelope cannot author:

- scope, storage generation, schema/policy/package authority;
- physical table or index names;
- SQL, lock rows, or ordering decisions;
- unique-key, edge, index, freshness, change, or system outbox rows;
- actor identity or authorization grants.

Those are resolved or derived by trusted code from the session anchor, pinned
catalog/policy, logical operations, and final row bodies.

`PreparedPointCommitV1` is the private C04C1 non-serializable capability. It
never arrives over `/invoke/*` and contains only the authenticated authority and
seal link, successful result, every logical point dependency, and at most one
net material logical row intent before O09-A, and now carries O09-A's bounded
canonically ordered material intent collection. It contains no physical table or column name,
allocated commit/outbox sequence, generated outbox ID, database timestamp,
transaction handle, SQL lock fact, change atom, or outbox template. O06 adapts
the authenticated logical evidence into a detached closed command and derives
tentative row operations inside the authoritative SQL boundary; O07-B extends
that same kernel with durable publication atoms.

## V1 Read-Your-Writes Matrix

| Read after a relevant staged write | V1 compiler policy |
| --- | --- |
| app `get(id)` | exact local overlay |
| supported point insert/patch/replace/delete | exact coalesced overlay |
| one specifically proven indexed query | enabled only after `O10` |
| other index/range/relation/scan/pagination shapes | typed rejection |
| Payload operation | Payload adapter lane or rejection |
| Medusa operation | Medusa transaction lane; never generic fallback |

Falling back to Postgres after a relevant staged write is not read-your-writes:
Postgres cannot see the private journal.

## Turn Checklist

### C01 — Retired Before Implementation

The standalone structural gate was premature. It proposed journal, catalog,
verified-input, executor, and wake ports before the gates that define their
exact data contracts and first consumers. Implementing it would either create
speculative weak interfaces or encode the legacy invoke-session shapes into the
replacement. Wrapping the current finish path would also create a temporary
compatibility layer without a shipped-data or public-contract obligation.

Introduce each boundary only at its real owner:

- C02 defines immutable logical protocol data and canonical encoding; it adds no
  database or service ports.
- C03 introduces only the `SessionJournalStore` needed by its first real
  Postgres-backed journal and point-overlay consumer.
- C04A owns exact stored-evidence authentication and only its private runtime-
  unforgeable capability. C04B1 owns the same-factory current argument/grant/
  revocation/schema authority capture and its private capability. C04B2 alone
  owns final value/return validation and `VerifiedCommitInput`; C04C1 owns the
  concrete process-local logical `PreparedPointCommitV1` capability. C04C2 is
  conditional on S08/S09-A/S09-B/O06/O07-B proving a separate physical/change/
  outbox lowering capability useful.
- O06 owns the reusable rollback-proven transaction kernel; O07-B owns the first
  exact durable atomic persistence capability. C05-A owns the intervening
  scalar-fenced finishing barrier; C05-B is their first complete private
  planner/O07-B publisher composition consumer.
- O08-B2b1/C06-A owns the exact-attempt durable execution claim and host-neutral
  outcome-first acquisition/admission seam. C05-A consumes that claim before
  finishing. C06-B later owns `PostCommitWake` endpoint dispatch, after durable
  commit and outbox evidence make its ordering meaningful.

The proposed compatibility-wrapping work is dropped rather than redistributed.
Legacy `/invoke/*` behavior remains regression evidence until target callers
switch; it is not a source contract for the replacement.

### [x] C02 — Define The Versioned Logical Protocol

Status: complete as an inert `flarex-protocol/commit-protocol` leaf. It adds no
database/service port, routing, persistence, lifecycle operation, or runtime
activation, and it is intentionally not re-exported from the package root.

Outcome:

- Define discriminated `LogicalReadDependency`, `LogicalAppWrite`,
  `SessionJournalV1`, separate `SuccessfulResultEvidenceV1`, and
  `CommitEnvelopeV1` contracts. Private logical `PreparedPointCommitV1` is
  deferred to C04C1. Physical revision/current rows, locks, change atoms, and
  outbox records remain with their S08/S09-A/S09-B/O06/O07-B consumers.
- Define attempt fence, canonical final syscall sequence, protocol versions,
  canonical journal/result evidence, and SHA-256 integrity digests. C03 owns
  operational monotonic sequencing and append rejection.
- Define journal carriage as `storedForSessionAttempt` or
  `inlineUntrusted`. Only the stored variant may be operationally consumed
  through C07. Inline bytes remain dormant until C07A proves non-forgeable
  supervisor/facet provenance; a matching digest is not authentication.
- Port the applicable Convex execution ceilings exactly: 32,000 documents read,
  16 MiB read semantic bytes, 4,096 point-read dependencies, 16,000 raw user
  writes before coalescing, 16 MiB resulting-document write bytes, and 16 MiB
  successful-result semantic bytes. Recompute structurally derivable totals;
  C03 must own or verify non-derivable read rows/bytes.
- Keep the separate 64 MiB canonical-evidence ceiling explicitly named as a
  Flarex resource/transport divergence based on Convex's bounded function-runner
  response, not as a transaction limit, syscall limit, lease, or scan counter.
- Define a distinct 64 MiB `materialWriteEventEvidenceBytes` operational
  ceiling for C03's cumulative temporary canonical event rows. It is a Flarex
  storage-amplification guard, not a Convex transaction limit, final-journal
  substitute, lease, or transport guarantee.
- Reject unknown versions and forged physical/authority fields.

Exit gate:

- deterministic golden encoding and digest tests pass;
- semantically identical journals encode identically;
- protocol-version, malformed union, forged-field, exact-boundary, noncanonical,
  digest, sequence-consistency, and dormant-inline tests fail with typed errors;
- successful result evidence remains outside `SessionJournalV1`, and returned
  byte arrays are defensive copies.

### [x] C03 — Implement Point Journal And Fail-Closed Overlay

Outcome:

- Introduce the narrow `SessionJournalStore` required by this first typed
  consumer, expressed only in C02 protocol types and backed initially by
  Postgres. It is the trusted owner of the exact per-attempt journal, final
  sequence, separate successful-result evidence, and non-derivable read rows/
  bytes. It owns temporary logical attempt evidence, not scope resolution,
  catalog authority, physical planning, or committed writes. C07A alone may
  later move this temporary store after measurement.
- Add the C03A opaque pinned-table capability at this first consumer. Immutable
  pinned-manifest membership and its declared table ID are authoritative; the
  stable deployment binding corroborates them. The resolver never reads the
  mutable active-schema pointer and does not absorb C04B1 authority capture or
  C04B2 value/return validation.
- Create one exact-attempt journal root eagerly with initial activation. Seed
  and advance insert `_creationTime` from trusted database time using exact
  binary64 `nextUp`; O08-A creates a fresh zero-accounting root and seed in the
  same transaction as its new fence and lease.
- Persist exactly four bounded attempt tables: the root, one replace-in-place
  latest receipt, unique point dependency/overlay rows, and ordered material-
  write events. Child evidence cascades only through explicit root deletion;
  the root restrictively references the exact session fence.
- Journal point `get`, insert, patch, replace, and delete operations.
- Retain raw successful write events for exact pre-coalescing accounting while
  coalescing the internal same-row overlay deterministically and exposing exact
  point read-your-writes from the staged final row state.
- Strictly normalize and canonicalize each material event once, charge those
  exact detached bytes before any point/event/receipt/root mutation, and insert
  the same evidence. Cap the cumulative event bytes at 64 MiB; `limit + 1`
  stores a replayable sticky failure and advances sequence without adding an
  event, changing the overlay, or advancing the prior in-range byte counter.
- Freshly reload/authenticate the exact current attempt before each operation,
  enforce monotonically increasing sequences and incremental execution limits,
  and seal only canonical C02 evidence.
- Execute only `last + 1`; replay `last` only for byte-identical canonical
  requests; reject changed bytes, stale lower sequences, and gaps. Catchable
  missing/no-op results replace the single latest receipt without growing
  cardinality. Sticky incremental-limit failure retains that exact last receipt
  until lifecycle cleanup.
- Generate one server-only UUIDv4 after replay classification for each insert.
  Return the inserted document immediately, fail closed on live or historical-
  tombstone collision, and replay every accepted or rejected outcome without
  another random draw.
- Seal in two phases: collect at most each child limit plus one and detach raw
  evidence under read-only repeatable read; close the transaction before child
  decoding, canonicalization, or hashing; reject excess cardinality first;
  recompute event bytes against the root; then take the normal short exact-
  attempt lock path to revalidate and store the seal. Keep the private candidate
  and successful-result evidence detached from caller-visible objects, reject
  stale candidates, and never activate C02's dormant inline carriage.
- Reject syscalls unless the exact current attempt remains `running`; in
  particular, reject every late syscall after C05-A's finish transition enters
  `finishing`.
- Reject mutation table scans, unproven index/range/relation reads, Payload
  operations, and Medusa operations on the new generation.

Exit gate:

- every point-write combination has exact overlay and pre-coalescing-accounting
  tests;
- present and qualified-missing reads, delete/reinsert, repeated reads, no-op
  writes, sticky `limit + 1`, and creation-time/UUID replay are proven;
- same/adjacent sequence races, lost-response replay, stale replay rejection,
  and repeated missing/error calls prove constant receipt cardinality;
- abort/expiry cleanup, stale seal candidates, large-evidence lock scope,
  exact/+1 material-event evidence, max+1 child collection, strict result
  detachment, query plans, migration fresh/upgrade/rollback, and PGlite plus
  real-Postgres concurrency pass;
- unsupported shapes fail closed with zero fallback; C03 itself introduces no
  inline activation, committed app-row publication, C04B1/C04B2/C04C
  verification/planning, or legacy-engine extension.

### [x] C04A — Authenticate The Exact Stored Attempt

Outcome:

- Consume only a fresh opaque server-authority capability; the envelope is
  carriage and cannot supply scope, placement, session, snapshot, package,
  function, schema, policy, request, generation, or lease authority.
- Reject `inlineUntrusted` before placement resolution or database I/O. For
  `storedForSessionAttempt`, use one bounded read-only repeatable-read load of
  the exact session, live lease, sealed root, and at most 4,096 point rows plus
  one overflow sentinel, then close SQL before strict decoding, canonical
  comparison, hashing, Schema validation, or point correlation.
- Accept only live `running + sealed` for initial planning or
  `finishing + sealed` for reconstruction. Return committed as typed already-
  committed/non-plannable; O07-A owns the read-only outcome lookup while
  O08-D/C06 later own recovery orchestration.
- Bind the full detached scalar seal identity, canonical journal/result bytes,
  digests, final sequence, accounting counters, and strictly correlated point
  overlay evidence. The existing `sealed_at` and root `updated_at` identify the
  seal; this gate adds no synthetic root version or DDL.
- Return only a private runtime-unforgeable process-local
  `AuthenticatedStoredAttemptV1`. Do not expose its constructor or raw evidence
  and do not add a package-root or public subpath export.
- Own no catalog/policy/return validation, prepared plan, physical writes,
  commit transaction, replay outcome, route, or runtime activation.

Exit gate:

- inline carriage fails before I/O; authority/lifecycle/lease/seal/envelope and
  point-correlation mismatches fail typed before capability construction;
- max+1 evidence fails before child decoding, and no SQL transaction remains
  open during CPU verification;
- caller mutation and structural/cross-instance forgery cannot alter or mint a
  capability, no public export exists, and focused PGlite plus real-Postgres
  isolation/race/query-plan tests prove the read-only boundary.

### C04B — Verify Commit Authority And Values

The former broad gate is split because current immutable authority records are
sufficient for a useful first checkpoint, while no accepted production
function-validator catalog exists yet. C04B is not complete until both
sub-gates complete.

#### [x] C04B1 — Authenticate Current Commit Authority

Outcome:

- Extend only the C04A factory-local vault. A genuine same-factory
  `AuthenticatedStoredAttemptV1` can mint a private, runtime-unforgeable
  `AuthenticatedCommitAuthorityV1`; structural and cross-factory values fail
  before persistence, and neither capability is package-root exported.
- Use one fresh bounded read-only repeatable-read capture of the exact stored
  argument/grant evidence, current scope revocation authority, one database
  timestamp, the immutable pinned schema artifact, and its stable table
  bindings. Project and sum stored representation lengths before selecting
  payloads, select JSON as text, and close SQL before JSON/Schema decoding,
  canonicalization, SHA-256, Ed25519, or function-metadata work.
- Share the exact transaction-grant verification kernel with the existing
  prepared-start verifier, supplying explicit trusted database time and exact
  logical pins. C04B1 cannot manufacture or register a prepared-start handle.
- Apply Convex's argument limit in both trusted preparation paths and again to
  stored arguments: the implicit outer array costs exactly
  `2 + argumentSemanticBytes`, which must be at most 16 MiB.
- Bound materialization separately at 64 MiB over the stored argument JSON,
  argument canonical bytes, grant JSON, grant canonical bytes, pinned-schema
  JSON, and pinned-schema canonical bytes. This is a Flarex operational
  corruption/resource ceiling, not a Convex transaction semantic.
- Retain the immutable setup-seeded function-metadata source only as a
  temporary proof adapter. Its sole consumer is the private C07 proof, its
  reason is that the production activation snapshot is deferred, and its
  deletion/replacement gate is roadmap 17 plus S03-D4/S04 publishing one
  coherent production package/artifact/source/function-validator/schema
  snapshot. It is unreachable from production target selection and never
  reads `activePackageId`, `analysisJson`, or the mutable active-schema pointer.
- Own no final document/result validation, return-validator execution,
  `VerifiedCommitInput`, planner, physical operation, commit transaction,
  publication, DDL, route, or hosted activation.

Exit gate:

- exact and limit-plus-one argument and materialization boundaries fail at the
  correct layer; oversize evidence is rejected before payload selection;
- current revocation, key, policy, request, idempotency, execution, schema, and
  grant pins fail closed, while one repeatable-read snapshot stays coherent
  across a concurrent authority change;
- tampered JSON/bytes/digests, corrupt schema/bindings, absent or malformed
  metadata, expiry, and same/cross-factory forgery are typed failures;
- caller mutation cannot change private state, CPU/crypto occurs after SQL
  closes, and focused unit, PGlite, and real-Postgres isolation/query-plan
  proofs pass.

#### [x] C04B2 — Validate Final Values And Successful Return

Status: complete only as the private C07 proof gate. Production validator
authority and syscall-time validation parity remain deferred Wave 4 decisions;
C04C1 later received its own separate approval. This status does not authorize
C04C2 or any transaction/publication gate.

Outcome:

- Consume only a genuine same-factory `AuthenticatedCommitAuthorityV1`; perform
  zero database/catalog/clock/active-pointer/metadata I/O and reuse only the
  already-authenticated immutable setup-seeded proof metadata. This does not
  create or imply production function-validator authority.
- Validate every live final logical document against its pinned strict app-table
  validator after enforcing exact `_id`/`_creationTime` and rejecting every
  other top-level underscore field. Deletes and unchanged reads have no final
  document. ID validators resolve only exact app tables in the pinned manifest;
  unknown and system targets fail closed.
- Recanonicalize the authenticated successful result, compare codec, bytes,
  digest, byte length, and semantic size with the C04A seal, then apply the
  pinned return validator. A null validator is unvalidated, explicit `any`
  accepts, and explicit `null` accepts only null.
- Return a frozen same-factory runtime-unforgeable `VerifiedCommitInputV1`
  containing only authenticated logical evidence, complete final logical
  states, validated canonical result evidence, and pinned identities. Invalid
  authority, value, or result evidence never reaches planning.
- Record the deliberate private-proof timing gap: validation currently occurs
  after execution/final overlay rather than at Convex syscall time. The later
  production preflight must decide whether a narrow validator capability moves
  into C03 to restore syscall-time/catchable-failure parity. Roadmap 17 plus
  S03-D4/S04 still own the coherent activation-fenced package/artifact/source/
  function-validator/schema snapshot and replacement of the proof adapter.

### [x] C04C1 — Build The Pure Logical Point Planner

Status: complete. The old broad C04C physical planner is
superseded.

Outcome:

- Consume only a genuine same-factory `VerifiedCommitInputV1` and perform zero
  database, catalog, clock, transaction, or metadata I/O.
- Preserve every protocol-owned `LogicalReadDependencyV1`, order logical
  evidence by numeric table ID then row bytes, and retain the O09-A-bounded net
  material logical row intents in that same canonical order. Live intent carries the already-verified
  complete final document. Delete of a snapshot-present row carries logical
  delete identity/dependency, while insert followed by delete retains its
  qualified-missing dependency and collapses to no row intent. A deleted point
  with a tombstone dependency is impossible behind authenticated C04A/B input
  and remains a defect rather than a physical delete or ordinary no-op.
- Return private process-local `PreparedPointCommitV1`. Identical authenticated
  inputs reconstruct equivalent logical state and contained bytes. O09-A admits
  multiple material point rows within the dedicated 128-row operational
  ceiling (separate from the 4,096 point-dependency bound); future/
  non-point shapes still fail typed before any later SQL transaction opens.
  Material writes requiring a declared developer index remain fail closed
  unless the owning composition explicitly supplies the private C08-A
  maintenance capability; that capability changes no logical plan shape.
- Include no physical names, O05 persistence dependency, current head,
  predecessor sequence, SQL lock fact, commit sequence/time, physical revision/
  current operation, change atom, outbox template, or publication identity.

### [ ] C04C2 — Conditional Consumer-Driven Physical Lowering

Do not introduce this gate unless the frozen S08/S09-A/S09-B/O06/O07-B first-
consumer contracts prove that a distinct physical/change/outbox lowering
capability is useful. O06 already owns the reusable authority locks,
revalidation, O05 adaptation, and tentative revision/current lowering. O07-B owns
  sequence/time allocation and durable publication; O09-A now owns multi-row
  point ordering, C08-A owns bounded deterministic developer-index actions,
  and O09-B retains unique ordering plus complete sidecar contention proof.

### [x] C05-A — Enter Finishing And Mint The Private Continuation

Outcome:

- Accept only a genuine same-factory `PreparedPointCommitV1` whose authenticated
  session and seal are still `running`. Detach only scalar authority, session,
  and sealed-root identity; do not cross the persistence boundary with journal,
  result, dependency, row, or caller-owned byte evidence.
- In one READ COMMITTED transaction, lock scope clock, exact session/fence,
  exact lease, then sealed journal root. Revalidate every immutable scalar and
  database-time expiry fact before changing only lifecycle and database-owned
  `updated_at` from `running` to `finishing`.
- A lost successful response may return `observed` only from the same genuine
  running plan after the finishing attempt, lease, and complete sealed-root
  identity still match. This is transition replay, not endpoint or uncertain-
  publication recovery.
- Mint a fresh frozen same-factory `FinishingPreparedPointCommitV1` without
  mutating the running plan. The C05 surface permits O07-B publication only from
  that finishing capability.

Exit gate:

- same/cross-factory and wrong-phase handles fail before persistence or
  publication, while every transition-result scalar is correlated before a
  continuation is minted;
- PGlite proves the exact scalar-only mutation, database-time expiry, complete
  mismatch rejection, observed transition, and post-update rollback; and
- isolated real Postgres proves canonical lock order, distinct same-scope
  serialization, independent-scope progress, transition-versus-abort/expiry,
  interruption held through settlement, bounded projections, and index plans.

### [x] C05-B — Reconstruct Finishing Authority And Compose O07-B

Outcome:

- A separate strict four-scalar selector entry now authenticates exactly live
  `finishing + sealed` without widening C03/O03-B2a running-only syscall
  authority. The selector is a locator only. Recovery reuses C04A's bounded
  repeatable-read capture/materializer and evidence-first canonical verifier,
  with no caller envelope or fabricated self-comparison, before traversing the
  existing C04B/C1 chain and minting the same private finishing capability.
- The normal operation composes C05-A transition with O07-B, and the fresh-
  process operation reconstructs then invokes that same O07-B-owned private
  `CommitExecutor`. O07-B continues to own dependency adaptation, authoritative
  head loading, O05, sequence/time allocation, rows, result/outcome, feed,
  outbox, exact lease/journal cleanup, committed session state, and clock
  advance. Do not wrap or promote legacy `commitInvokeSessionWrites`.

Exit gate:

- a genuine running plan reaches O07-B without raw lifecycle SQL, and a crash
  after C05-A can reconstruct and publish the byte-equivalent finishing plan;
- point CRUD and zero-row success, duplicate/concurrent publication, conflicts,
  rollback, and unsupported index/unique/relation rejection pass on PGlite and
  isolated real Postgres; and
- publication failure leaves durable `finishing + sealed` authority for O08-D's
  bounded same-request recovery and the later B2b/C06 orchestration without
  rerunning user code.

### [x] C06-A — Add Host-Neutral Durable Claim Admission

Migration 0032 and the package-private acquisition/admission composition close
the B2b0 ordering contradiction without adding an endpoint or runtime adapter.
O03 activation and O08-A replacement create one exact-attempt Postgres claim
atomically before `running`. Outcome-first selector acquisition returns replay/
expiry without claiming, reports a live owner as busy, and permits only locked
database-time expired-claim takeover with a checked fence. Directly settled
creation/acquisition alone mints the frozen same-factory handle.

Execution entry and every journal/syscall, point-table, seal, C05-A, and
execution-owned abort admission revalidate the exact attempt, owner, and claim
fence. C05-A atomically removes the claim while entering `finishing`; observed
finishing state must have none. Snapshot-lease expiry, claim expiry, lifecycle
terminalization, O08-C/D publication handling, and S09-B delivery claims remain
separate authorities.

### [x] O08-B2b2b1 — Discover Bounded Inert Attempt Candidates

Migration 0033 and one package-private, read-only located-target operation now
provide scope-local candidate discovery. A page contains at most 100 frozen
selector/source/time hints under one database-owned horizon; its continuation
is pagination data, not authority. Discovery does not inspect outcomes, acquire
claims, invoke the exact-selector composer, or mint a capability. O08-B2b2b2a
now separately closes expired dirty/failed attempts through the singular claim
and terminalization owners. O08-B2b2b2b0a supplies the shared `G`/`S`/`B`
configuration invariant, and O08-B2b2b2b0b supplies atomic seal-time lease
promotion, and O08-B2b2b2b1b1 closes host-neutral structured execution-claim
liveness, and O08-B2b2b2b1b2a now composes one bounded page through the exact-
selector redispatch owner. O08-B2b2b2b1b2b1 now enumerates one bounded page of
inert control-plane replacement-scope locators. O08-B2b2b2b1b2b2a now composes
one private count-bounded round-robin multi-scope invocation; O08-
B2b2b2b1b2b2b retains durable scheduling, routing, and production-dispatch
liveness.

### [ ] C06-B — Add Idempotent Finish And Lost-Outcome Dispatch

Focused production execution plan:
[`37-production-redelivery-and-c06b.md`](../37-production-redelivery-and-c06b.md).

Prerequisite: `O08-B2a` same-process OCC execution, O08-CD0 transaction-
decision provenance, O08-C bounded known-settled retry, and O08-D bounded
uncertain-outcome recovery and C06-A host-neutral durable claim admission are
complete. O08-B2b2a now supplies the private explicit-selector safe-state
composer; only its acquired `execute` and `finishOnly` branches consume that
singular claim, while its inert `finishing` classification routes only to
C05-B's independent authority. O08-B2b2b1 now supplies bounded inert discovery,
and O08-B2b2b2a supplies durable dirty/failed-attempt disposition without
execution or retry authority. O08-B2b2b2b0a closes policy coherence, and O08-
B2b2b2b0b closes atomic seal-time lease promotion, and O08-B2b2b2b1b1 now
supplies host-neutral structured execution-claim liveness, and O08-B2b2b2b1b2a
supplies one bounded host-neutral redelivery page, and O08-B2b2b2b1b2b1 now
supplies bounded inert scope enumeration, and O08-B2b2b2b1b2b2a supplies
private count-bounded multi-scope/repeated-page composition. O08-
B2b2b2b1b2b2b retains durable scheduling, routing, and production-dispatch
liveness. This endpoint composes those policies; it does not define a competing
retry coordinator or execution owner.

Outcome:

- Compose the distributed lifecycle owners through the stable endpoint; do not
  introduce a second state machine in compiler code. C06 idempotently
  orchestrates C05-A transition, C05-B reconstruction/publication, and existing
  retry/outcome primitives; C03 rejects later syscalls. O07-B owns exact-lease deletion plus
  the atomic `committed` transition. O08-A owns exact-attempt replacement;
  O08-B1 owns only bounded fresh-attempt handoff; O08-B2a owns same-process
  user-code rerun; O08-CD0 preserves transaction-decision provenance without
  acting on it; O08-C consumes only confirmed rollback for SQL transaction
  retry; O08-D owns bounded publication uncertainty recovery; O08-B2b1/C06-A
  owns durable execution claims; O08-B2b2a owns the private safe-state composer;
  O08-B2b2b1 owns bounded inert discovery; O08-B2b2b2a owns durable dirty/
  failed-attempt disposition; O08-B2b2b2b0a owns the completed shared grant/
  retention configuration invariant; O08-B2b2b2b0b owns completed atomic seal-
  time lease promotion; O08-B2b2b2b1a owns completed phase-aware renewal; and
  O08-B2b2b2b1b1 owns completed host-neutral structured liveness. The remaining
  O08-B2b2b2b1b2a gate owns the completed bounded single-page sweep, O08-
  B2b2b2b1b2b1 owns bounded inert scope enumeration, and O08-
  B2b2b2b1b2b2a owns private count-bounded multi-scope composition, while the
  remaining O08-B2b2b2b1b2b2b gate owns durable scheduling/redelivery and
  dispatch:

```text
atomic activation -> running -> finishing -> committed
                        ^          |
                        |          +-- trusted OCC conflict -> retrying --+
                        +-----------------------------------------------<--+

running or finishing -> aborted | expired
```

S07's `committing` literal remains transaction-local/reserved in V1; it does
not introduce a separately durable state or recovery protocol.

- Invoke the C04B2-owned verified-input/return-validation gate before C04C1 planning;
  the endpoint adds no weaker alternate finish path.
- Store successful result, commit token, idempotency outcome, data,
  commit/change atoms, outbox, exact-current-lease deletion, and committed
  session state atomically.
- Make repeated finish replay the authoritative outcome.
- Resolve uncertain responses by lookup before rerunning anything.
- Introduce `PostCommitWake` only at this stable finish boundary. Wake
  post-commit work only after durable commit; wake failure is an observable
  latency/operability failure and never revokes or hides the committed outcome.

Exit gate:

- duplicate finish, concurrent finish, lost response, stale attempt, restart,
  expiry, mismatched idempotency reuse, and committed-result tombstone tests
  pass through artifact runtime, the private Worker Fetch adapter, and stable
  `/invoke/*` endpoints. Optional Nitro/Vercel parity is checked separately.

### [x] C07 — Close The Real-Postgres Correctness Gate

Required cases:

- two writers from the same snapshot;
- duplicate concurrent finish;
- connection loss after commit;
- stale epoch/generation/session fence;
- injected rollback at every publication boundary;
- two independent scopes committing concurrently;
- confirmed pre-decision SQL `40001` and `40P01` retry the same authenticated
  logical/closed command;
- OCC reruns user code at a new snapshot;
- uncertain outcome lookup prevents double application;
- commit/outbox sequences remain unique and contiguous under retries.

Implementation status:

- one private test-only composition root now joins the accepted preparation,
  signed-grant verification/admission, activation, exact-runtime, journal,
  same-document OCC rerun, commit, outcome, feed, and outbox owners without a
  package-root export or production caller;
- `pnpm --filter @flarex/system-test test:c07:pglite` owns the one assembled
  cross-owner PGlite proof, while
  `pnpm --filter @flarex/persistence-postgres test:c07:pglite` retains the 78
  finishing, replacement, rollback, fencing, retry, and recovery cases owned by
  persistence. Both gates pass after the system-test extraction;
- `pnpm --filter @flarex/system-test test:c07:postgres` and
  `pnpm --filter @flarex/persistence-postgres test:c07:postgres` are the
  matching fail-closed real-Postgres gates. The former owns the assembled
  proof; the latter retains genuine `40001`/`40P01`, concurrency,
  lost-response uncertainty, rollback, fencing, and cold recovery. Each keeps
  an explicit authenticated-URL prerequisite;
- the real-Postgres run exposed generated default-schema qualification in seven
  foreign keys across migrations `0036` and `0037`. Removing only that
  qualification preserves the same tables and constraints while allowing the
  persistence owner's isolated `search_path`;
- on 2026-07-30 the exact real-Postgres gate passed against an isolated genuine
  PostgreSQL 18.3 server: four files and 48 tests passed, comprising the
  authenticated environment prerequisite plus all 47 database cases, with zero
  skips.

Exit gate:

- both PGlite and real-Postgres suites pass;
- the new compiler is eligible only for a private test generation. Canary and
  hosted routing remain blocked on target-native readiness, active-schema
  authority, generation routing, target-only caller/sync proof, and hosted
  gates. Legacy import/comparison/rollback is conditional on shipped evidence;
- it is not yet a general Payload, Medusa, range-query, or sync engine.

### [ ] C07A — Measure And Conditionally Move The Journal To A Session Facet

Prerequisite:

- C02's pure package gates and C03-C07's applicable PGlite/real-Postgres gates
  are green through the current Postgres-backed journal path.

Decision gate:

- In the hosted Dynamic Worker/private executor/Hyperdrive composition,
  separately measure service-binding latency, authoritative Postgres data-read
  latency, Postgres journal persistence, and finish latency.
- Declare the material-improvement threshold before comparing the
  Postgres-backed, session-scoped Dynamic Worker binding, and facet-backed
  journal paths.
- If journal persistence meets the threshold, evaluate the facet path as the
  next checkpoint before C08/C09. Select it only when it beats both the
  Postgres-backed path and a custom-binding-only control that retains Postgres
  journaling. Otherwise retain Postgres journaling, record the receipt, and
  continue to C08.

Outcome when the threshold is met:

- Implement `SessionJournalStore` with one deterministic server-issued
  supervisor Durable Object per top-level session and one dynamic facet per
  attempt fence. The facet's isolated SQLite stores temporary syscall sequence,
  logical read dependencies, staged logical writes, and sealed result evidence
  only.
- Keep authoritative source packages in the existing content-addressed artifact
  store. The supervisor loads the exact artifact pinned by the Postgres session
  anchor and does not create a second package/deployment authority.
- Have the generated facet shell seal canonical journal/result bytes, digest,
  final syscall sequence, session identity, and attempt fence. The supervisor
  retrieves the envelope through facet RPC or `fetch`; it cannot read facet
  SQLite directly.
- Keep actual data reads on trusted executor syscalls backed by authoritative
  Postgres. The move removes journal-persistence database round trips; it does
  not remove the syscall/service-binding hop or the authoritative data read.
- Keep the Postgres session/grant anchor, snapshot lease, authority, result,
  idempotency, OCC, commit feed, and outbox unchanged.
- Use protocol version, fence, monotonic syscall sequence, digest, TTL, size
  limits, and restart cleanup.
- Activate C02's `inlineUntrusted` carriage only after proving that the exact
  supervisor/facet call path supplies non-forgeable provenance (or an
  equivalent host capability). Record that trust boundary explicitly; session
  and fence matching plus SHA-256 alone never authenticate inline bytes.
- Use a fresh facet identity for every OCC attempt. Abort/delete on commit,
  abort, expiry, or retry; mid-handler crashes rerun a new fenced attempt rather
  than pretending to resume JavaScript execution.
- Keep a configuration switch back to the proven journal implementation.

Exit gate:

- the hosted latency receipt and predeclared threshold are recorded whether or
  not the move is selected;
- when selected, DO restart/eviction, duplicate syscall, late syscall, digest
  mismatch, sealed-envelope replay, fresh-facet OCC retry, terminal cleanup,
  expiry, mid-handler crash, and lost-response cases pass;
- no test depends on a reentrant facet callback into a supervisor that is
  awaiting the same facet invocation;
- moving the journal reduces round trips but transfers no committed authority;
- `DocCacheDO` and `QueryCacheDO` remain separate and are not part of mutation
  correctness.

### [ ] C08 — Lower Index And Unique Sidecars

`C08-I1` and `C08-A` are complete for the current relation-free Standard
application path. The existing O07-B transaction maintains the required intrinsic
`by_creation_time` sidecar for every material final-row transition (insert,
patch, replace, and delete). The same bounded private capability advances the
existing C4 build row through declared, building, backfilling, validating, and
enabled with row-ID-ordered snapshot backfill, current-row revalidation, exact
current-content validation, and no external lease or new schema. Validation is
page-bounded and every relevant validating-state point commit resets its cursor
in the same transaction, preventing behind-cursor changes from escaping the
complete pass required for enablement. Migration `0042` adds only the
non-unique `(scope_uuid, index_definition_id, row_id)` supporting index needed
by that bounded validation query; it changes no C4 lifecycle row or S10 entry
semantics, and populated-data plus genuine-PostgreSQL planner proof pins the
access path.

`C08-A` directly replaces C04C1's former developer-index rejection only for a
private capability minted by the exact point-commit port that owns maintenance;
an independent host literal cannot enable planning. Before the transaction, a
cap-plus-one control-catalog join follows the pinned schema's immutable foreign-
key-backed bindings directly to definitions owned by touched tables. Inside the existing
scope-clock transaction, O07-B batch-locks those exact C4 build rows, decodes
and verifies prior canonical row evidence, lowers prior and final keys through
the existing Ordered Index V1 physical spec, and appends the existing S10
revision/current chains. Same-key updates advance one live chain; key movement
tombstones the prior key and publishes the new key; deletion tombstones the
prior key. Actions are deterministic and capped at 256 entry revisions per
commit, enabled builds require exact prior sidecar lineage, and validating
builds are invalidated in the same transaction. No schema, migration, active
reader, query authority, alternate OCC/commit owner, or unique claim was added.
PGlite and genuine PostgreSQL prove insert, same-key update, delete, dotted
missing-path lowering, key movement, mixed unchanged/material dependency
ordering, oversized-key refusal, fault after the second sidecar write, exact
rollback/retry, pre-transaction ceiling refusal, and action-derived ceiling
rollback.
This does not complete general C08: unique lowering and O09 contention remain
open.

Outcome:

- From the final row and pinned catalog/codecs, derive declared index inserts,
  deletes, key movements, and unique claims.
- Verify canonical key hashes against stored encoded values.
- Sort unique/sidecar locks and writes deterministically.
- Clean up former index/unique keys atomically on update/delete.

Exit gate:

- insert/update/delete/key-move, sparse/localized uniqueness, collision
  verification, deterministic lowering, and single-transaction publication
  tests pass;
- tables declaring unsupported sidecar features remain inactive until O09
  closes real-Postgres contention, multi-row atomicity, and rollback.

### [ ] C09 — Lower Stable Edge Occurrences

Prerequisite:

- `R01` has frozen relation/cardinality/delete/locale/order/nested-occurrence
  and occurrence-codec semantics and `R02` has bound both the stable logical
  relation, exact semantic definition, and physical edge definition into the
  pinned manifest. The compiler does not infer any identity or binding from a
  field name, Payload collection slug, target row value, or whichever schema is
  active later.

Outcome:

- Derive current edge occurrences from final row values and pinned catalog.
- Include logical relation and immutable physical edge-definition identity,
  source row, stable nested item/block identity, path, locale, codec version,
  canonical occurrence evidence, and occurrence identity; treat list position
  as ordering only.
- Remove stale edges for the same immutable definition atomically with the row
  update. Schema deployment/backfill owns parallel replacement-definition
  population; the mutation compiler must not reinterpret an old definition in
  place.
- Detect and reject a digest/identity collision before edge publication rather
  than overwriting or conflating canonical occurrences.

Exit gate:

- repeated targets, reordering, locale/path changes, nested moves, deletion,
  and stale-edge cleanup pass;
- old and replacement physical edge definitions can coexist without
  cross-deleting one another;
- edge publication and rollback remain atomic with row revision/current,
  commit/change, outbox, and idempotency outcome publication;
- relation reads remain disabled until their separate OCC/overlay proof.

## Payload And Medusa Boundary

FlarexDB exposes trusted foundation capabilities, but the generic compiler is
only for the supported Flarex app-data IR.

Payload later receives a dedicated adapter that matches Payload database and
request-transaction behavior. A Payload collection may bind to an existing app
`table_id` and expose the same authoritative row; it must not maintain a second
Payload document copy. Scalar and structured values remain in that row,
relationships/uploads lower to stable edge occurrences, and joins are reverse
edge reads. Payload lifecycle, versions/drafts, globals, locks/auth, locale
fallback, access, and hook ordering still need their own conformance turns.
Payload operations are not silently encoded as `SessionJournalV1`. The frozen
compatibility boundary is in
[04-payload-relational-contract.md](./04-payload-relational-contract.md).

Medusa retains its relational repositories, transaction manager, DML,
ModuleJoiner/link metadata, migrations, modules, and workflows. Its trusted
transaction later calls a narrow scope-commit participation API to write
Flarex commit/change/outbox records atomically with Medusa state. It does not
use app-row storage or the generic compiler, and there is no general atomic
`ctx.db + ctx.commerce` transaction.

## Verification Template

C02 runs its protocol-only package gates:

```sh
corepack pnpm --filter flarex-protocol exec vitest run test/commit-protocol.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
```

Later compiler turns run:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
```

Endpoint changes also run the executor Fetch adapter, artifact-runtime, and
Worker-host integration tests. Optional Nitro/Vercel tests run while that
compatibility adapter remains supported. C07 and concurrency-sensitive later
turns run both packages' real-Postgres scripts. Phase checkpoints run workspace
`typecheck`, `test`, and `build`.

Significant code turns run both standing diff reviewers before the automatic
checkpoint commit. Update the compiler and executor domain roadmaps only when
the turn changes durable architecture, status, gaps, direction, or correctness
criteria.
