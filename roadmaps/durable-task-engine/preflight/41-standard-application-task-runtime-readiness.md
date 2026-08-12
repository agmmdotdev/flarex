# Preflight 41: Standard Application Task Runtime Readiness

## Status

**Decision:** implementation is approved and complete only through step 2. The
shared task-catalog snapshot prerequisite and the pure Standard Application
cold-verification/readiness-basis contract were completed on 2026-08-12.
Backend object reading, persistence/schema, readiness issuance, activation,
and production wiring remain unapproved.

SAP-TRP1 through SAP-TRP4 are complete and production-inert. They provide the
canonical task-runtime object formats, an authenticated publication plan, an
immutable task-specific R2 store, and an immutable PostgreSQL publication
receipt under the existing Application revision. The next missing fact is not
another publication or task lifecycle state. It is the existing Application
readiness owner's decision that every object named by that receipt can be read,
decoded, recomputed, and supported by the selected runtime policy.

This preflight proposes SAP-TRP5 only. It does not authorize activation,
SAP-TRP6's located launch reader, Worker Loader composition, a compute provider,
a route, Queue, Cron, Worker, deployment binding, or production host.

## Question

What is the smallest reuse-first change that makes one existing Application
revision ready for its task runtime while:

- preserving the single Application readiness receipt and active head;
- cold-reading the exact immutable SAP-TRP4 object membership;
- reusing the SAP-TRP1 role codecs and root verification instead of
  reimplementing them in persistence or the compute provider;
- keeping R2 access outside PostgreSQL transactions;
- revalidating the immutable database receipt before committing readiness;
- preserving already stored function-only readiness receipts explicitly; and
- remaining production-inert until the later launch and Worker Loader gates?

## Repository-Grounded Current State

The current Application chain is already the correct owner:

```text
application candidate and authenticated publication
  -> application revision
  -> task catalog and definitions
  -> SAP-TRP4 task-runtime publication receipt and object membership
  -> application readiness receipt
  -> application activation history
  -> one application active head
```

`applicationReadiness.ts` already:

- reserves one exact located revision under the scope clock;
- correlates candidate, publication, function catalog, task catalog, schema,
  physical indexes, and unique constraints;
- performs ordinary-function cold materialization outside the final
  transaction;
- rechecks the reserved evidence and current authority in the final
  transaction;
- writes one immutable readiness receipt plus per-function cold evidence; and
- issues an opaque readiness value that activation must revalidate in the same
  transaction that advances the active head.

`applicationActivation.ts` already:

- settles or reloads readiness before activation;
- locks and revalidates the current scope authority;
- binds activation history and the active head to the exact readiness digest;
- exposes one issuer-owned active selection; and
- has no task-specific active head.

SAP-TRP4 already stores the canonical task-runtime receipt and its complete,
ordered object references under the same `(scope_id, revision_id)` task catalog.
The backend task-runtime object store already owns bounded immutable reads,
key/length/digest reconciliation, missing/corrupt/resource/uncertain failures,
and owned returned bytes. SAP-TRP1 already owns the five concrete role codecs
and root algorithms.

That store does not yet prove a hard settlement deadline for the initial
`bucket.get`: its body-stream reader receives an interruption signal, but the
foreign get promise has no cancellation parameter. It also currently buffers
one full object before hashing. SAP-TRP5 must treat those as explicit host/store
admission constraints, not assume that protocol-valid maximum objects are safe
to cold-read in a Cloudflare Worker.

Trigger.dev does not own Flarex Application publication or readiness. There is
therefore no Trigger readiness implementation to copy here. Trigger-derived
run lifecycle, delivery, cancellation, and recovery semantics remain reused by
the Task System checkpoints; SAP-TRP5 deliberately reuses Flarex's existing
Application readiness, activation, artifact-store, and canonical-codec owners.

## Proposed Direction

Extend the existing Application readiness capability. Do not create:

- a task-readiness table that can become authoritative independently;
- a task activation history or task active head;
- a second R2 reader or generic object-store API;
- a compute-provider readiness decision;
- a launch-time fallback that treats publication as readiness; or
- a compatibility path that silently synthesizes missing SAP-TRP4 evidence.

The task-runtime readiness fact is a new concrete generation of the existing
canonical Application readiness envelope. The capability names remain
unversioned. Only the persisted/canonical envelope is versioned because legacy
and task-aware receipts may coexist.

## Owner Split

| Concern | Owner |
| --- | --- |
| Five task-runtime body codecs, canonical re-encoding, roots, and semantic correlation | `@flarex/standard-application-definition` |
| Bounded immutable object reads and R2 settlement classification | existing private backend task-runtime object store |
| Located database receipt/membership snapshot, locks, schema, replay, and readiness commit | existing `@flarex/persistence-postgres` Application readiness owner |
| Supported ABI/profile/compatibility/compute-profile policy | trusted backend runtime policy supplied to readiness |
| Active-selection issuance and active-head CAS | existing Application activation owner |
| Launch-time located read and role validation | later SAP-TRP6 / DTE06-D1 adapter |

Persistence must not learn R2 credentials or duplicate role decoders. The
backend verifier must not receive a raw database, transaction, scope locator,
or authority to write readiness. Standard Application code must remain pure
with respect to PostgreSQL, R2, Worker Loader, and host composition.

## Required Flow

### 1. Reserve an immutable database snapshot

The readiness owner loads under the located scope transaction:

- the current scope clock and exact storage generation/fence/epoch;
- candidate, revision, authenticated Application publication, and task catalog;
- the SAP-TRP4 publication header and canonical receipt bytes;
- every ordered SAP-TRP4 membership row; and
- the existing schema, physical, candidate-validation, and unique-constraint
  prerequisites.

The task-runtime publication is required for every newly issued task-aware
readiness receipt, including an explicit empty catalog. The snapshot is copied,
bounded, decoded, and correlated before the transaction returns. A missing
publication is `not_ready`; malformed or contradictory stored evidence is a
fail-closed stored-state error.

The transaction ends before any R2 operation starts. No database lock is held
while object bodies are downloaded or decoded.

### 2. Cold-read and verify outside the transaction

For an empty catalog, verification proves the exact SAP-TRP4 empty receipt,
performs zero R2 reads, and derives the canonical empty task-runtime basis.

For a populated catalog, the verifier processes every persisted object
reference in canonical order and:

1. calls only the existing task-runtime store's `read` capability;
2. requires the returned reference to equal the requested reference;
3. relies on the store for key, byte-length, digest, body-budget, and owned-byte
   proof;
4. decodes and canonically re-encodes the body through its SAP-TRP1 role codec;
5. rejects a codec/role/ordinal mismatch or noncanonical body;
6. recomputes module, projection, entry, group-manifest, and materialization
   relationships through the Standard Application owner;
7. recomputes every receipt root and compares it to the exact SAP-TRP4 receipt;
8. correlates catalog, candidate, source, semantic, package, artifact, and
   Application revision task-binding evidence; and
9. applies the trusted admitted ABI, runtime-profile, implementation-version,
   compatibility-date/flags, and compute-profile policy.

Missing, corrupt, unsupported, budget-exceeded, or resource-failed object
verification makes the whole revision unready or fails the typed operation. It
never quarantines, repairs, overwrites, deletes, or republishes an object.

The verifier returns owned canonical evidence tied to the exact SAP-TRP4
receipt digest. It does not return a bucket, arbitrary key reader, database
handle, Worker Loader capability, or launch authority.

### 3. Revalidate and commit the one readiness receipt

The final located transaction:

- relocks the scope clock and exact revision parents;
- reloads the SAP-TRP4 header and membership under the same revision;
- proves the receipt digest and normalized membership are unchanged from the
  reserved snapshot;
- validates the verifier result came from the configured readiness composition
  and is bound to that exact receipt;
- revalidates the existing schema, candidate, physical, and unique-constraint
  prerequisites; and
- inserts or exactly replays the single Application readiness row.

No R2 operation runs in this transaction. If authority, task catalog,
publication receipt, membership, schema, or physical readiness changed, the
transaction fails closed and emits no readiness fact.

### 4. Reuse activation unchanged in authority

Activation continues to bind only one revision and one readiness digest into
the existing activation history and active head. Its transactional readiness
validation must additionally reconstruct and compare the task-aware basis
committed by that readiness digest.

The issuer-owned active-selection basis gains only the narrow task fields later
needed by SAP-TRP6, such as:

- task-runtime readiness kind (`empty` or `populated`);
- SAP-TRP4 receipt digest;
- task catalog and binding digests;
- task entry root;
- nullable projection, group-manifest, and materialization-spec digests;
- admitted ABI/runtime-profile/implementation/compatibility policy identity;
  and
- the task-runtime readiness basis digest.

It does not expose R2 credentials, raw database access, mutable receipt rows,
or arbitrary object reads. SAP-TRP6 must still load the exact active revision
through a trusted located adapter and correlate the run-facing definition
commitment before launch.

## Readiness Compatibility Contract

The existing canonical `flarex.application-readiness` version 1 receipt is a
persisted compatibility contract. SAP-TRP5 must not silently add fields while
continuing to label the bytes version 1.

The proposed migration keeps the existing readiness table and active-head
chain, but adds an explicit readiness-envelope generation and nullable
task-runtime correlation columns. The constraints admit exactly two shapes:

1. **legacy version 1:** the historical columns and canonical bytes remain
   byte-for-byte valid; every task-runtime correlation column is null;
2. **task-aware version 2:** the SAP-TRP4 receipt digest, task-runtime basis
   digest, and required task correlation are non-null and the canonical bytes
   use version 2.

Version 2 has two internal shapes:

- `empty`: object count zero and the projection/group/materialization digests
  are null; and
- `populated`: object count is positive and those three digests are present.

The version-2 row has a restrictive foreign key to the exact
`(scope_id, revision_id, receipt_sha256)` SAP-TRP4 publication. The readiness
digest commits the full version-2 frame, including the task-runtime basis. The
existing activation and active-head rows continue to reference the readiness
digest; no task-specific head is needed.

### Legacy policy

- Existing stored version-1 readiness receipts remain readable and exactly
  replayable so current function-only active revisions are not invalidated by
  the migration.
- A stored version-1 readiness may continue through the existing activation
  compatibility path, but its active selection is explicitly
  `taskRuntime: legacy_absent` and can never authorize a task launch.
- A revision with no readiness row cannot mint a new version-1 receipt after
  SAP-TRP5. It must have an explicit SAP-TRP4 receipt, including for an empty
  task catalog, and receives version 2.
- A revision already holding version-1 readiness cannot be upgraded in place;
  publishing task runtime later requires a new immutable Application revision.
- SAP-TRP5 performs no backfill, implicit empty receipt, in-place receipt
  rewrite, dual write, or automatic legacy upgrade.

This preserves old immutable evidence while making the new readiness rule
fail closed and unambiguous.

## Completed Shared-Owner Prerequisite

The SAP-TRP4 connected fixture proved a defect in the existing
`ApplicationTaskCatalogSnapshotPort`: for a populated registered catalog it
passed stored canonical manifest bytes to an API that expects an already
decoded manifest object, producing typed `storedState` at
`definitions[0].manifestBytes`.

Expected behavior is to decode and canonically verify the stored manifest
preimage, or return the already authenticated owned catalog snapshot. The
actual behavior prevented the existing readiness owner from reserving a
populated task catalog. This defect was in the shared Application task-binding
snapshot owner, not in SAP-TRP4 and not in the R2 verifier.

The separately approved prerequisite correction is now complete in that owner.
It also closed the second representation mismatch exposed by the positive
populated regression: stored definition-binding digests are byte arrays, while
the snapshot reconstruction had converted them to hexadecimal text before
calling the byte-array decoder.

The bounded correction provides:

- canonical stored-manifest decode and re-encode verification;
- exact digest and binding correlation;
- owned/frozen returned evidence;
- empty and populated regression coverage; and
- no change to task registration, publication, readiness, or activation
  authority.

The Standard Application owner now supplies the canonical manifest-preimage
decoder. The persistence snapshot owner uses that decoder, reconstructs
definition bindings with their native byte representation, recomputes the
manifest, definition-binding, catalog-binding, and catalog digests, and returns
only owned snapshot bytes. PGlite coverage proves empty and populated reads,
successful populated readiness, noncanonical stored bytes, digest drift,
missing definitions, and returned-byte ownership. No transaction or schema
contract changed, so this prerequisite did not require a new genuine-PostgreSQL
lane.

SAP-TRP5 must continue to use this corrected snapshot port. It must not bypass
the port, trust raw rows, add a second catalog reader, or duplicate the decoder.

## R2 Deadline And Memory Admission Boundary

The task-runtime reference contract allows a publication maximum that is
larger than a safe universal Worker-memory assumption. A protocol-valid object
is not automatically admitted by a particular runtime host.

Before the backend cold verifier can claim bounded hosted operation, its trusted
runtime policy must fix:

- maximum admitted object bytes;
- maximum admitted total publication bytes;
- maximum admitted object count;
- bounded read concurrency and peak owned-byte budget;
- per-read and whole-verification deadlines; and
- the disposition of a foreign R2 operation that has not settled when the
  Effect is interrupted.

The first SAP-TRP5 implementation may choose conservative limits below the
protocol maxima and classify larger but well-formed publications as unsupported
runtime policy. If it instead needs the full protocol maximum, improvement of
the backend immutable-store owner to bounded streaming/incremental validation
and a settled deadline contract is a separate prerequisite change. A
cooperative `Effect.timeout` around an uncancellable `bucket.get` is not proof
that the underlying operation or connection has settled.

Deterministic in-memory or Miniflare timeout tests do not establish hosted R2
settlement. Production-capable claims require a hosted test or an authoritative
Cloudflare contract that proves the chosen deadline/disposition behavior.

## Completed Pure Verification Contract

The Standard Application owner now exports the current unversioned
`verifyTaskRuntimeReadiness` operation plus the concrete version-1 canonical
readiness-basis contract. The operation accepts only exact SAP-TRP4 receipt
bytes/digest, authoritative parent/catalog evidence, one trusted
materialization policy, and already-read object references with owned bodies.

It decodes and canonically verifies every SAP-TRP1 role, proves exact returned
reference and receipt membership, recomputes the module, projection, entry,
group, materialization, and Application revision binding roots, correlates
each task entry with the owned catalog, and applies the exact trusted runtime
policy. The empty path proves the canonical empty entry root and performs no
object-body work. Its returned canonical basis commits the SAP-TRP4 receipt,
authoritative parents and roots, admitted policy, object count, and canonical
object-byte total. Inputs are captured before the first asynchronous hash and
all returned bytes and digests are copy-on-read.

This pure result deliberately does **not** prove that R2 was read. Any caller
can present already-held bytes to it. Step 3 must own a separate backend
capability that obtains bodies only through the existing immutable store,
applies host admission/deadline policy, calls this verifier, and mints any proof
later accepted by persistence. Persistence must never accept the freely
callable pure result as cold-read authority.

## Failure And Retry Policy

| Condition | Result |
| --- | --- |
| Revision, task catalog, or SAP-TRP4 publication absent | deterministic `not_ready` |
| Explicit empty receipt | ready only after zero-read empty-basis verification |
| Stored receipt/membership malformed or contradictory | non-retryable stored-state failure |
| R2 object missing or corrupt | non-retryable task-runtime readiness failure |
| Unsupported ABI/profile/implementation/compatibility/compute profile | deterministic unsupported-runtime `not_ready` |
| R2 or hash resource unavailable | typed retryable resource failure |
| R2 settlement uncertain | typed uncertainty; no readiness commit |
| Scope authority or immutable parent changed | fail closed; restart from a fresh snapshot |
| Identical final readiness already committed | exact replay |
| Different readiness already committed for the revision | conflicting replay |
| Commit response uncertain | no local success claim; exact request may cold-replay after settlement |

Retry never changes the snapshot identity, republishes objects, or treats
object existence as a readiness receipt.

## Boundedness And Settlement

- Receipt bytes, membership count, per-role count, object size, and total
  publication bytes retain the SAP-TRP1/SAP-TRP4 protocol ceilings.
- Every R2 read uses the exact persisted byte length as its read and hash
  ceiling, additionally bounded by the stricter trusted runtime policy.
- Reads use a fixed bounded pool and preserve canonical result order. The first
  implementation may use concurrency one only if its admitted object/count/
  byte limits are proven to complete within the operation deadline; it must
  never use unbounded `Promise.all` over the publication.
- Peak live bytes, decoded metadata, and accumulated verification state are
  measured against the selected host memory budget. Raw bodies are released as
  soon as their canonical role evidence has been derived.
- A failed or interrupted read returns no verifier proof and cannot be committed
  as readiness.
- Database deadlines and connection settlement remain owned by the existing
  located transaction composition. R2 deadline/cancellation/disposition proof
  must be added at the backend store/host owner described above; persistence and
  Standard Application do not own it.
- The final transaction performs no network object read and must preserve the
  existing rollback/decision-uncertainty distinction.

## Required Validation

### Shared task-catalog prerequisite

- stored canonical manifest decode/re-encode and digest proof;
- empty and populated snapshots;
- malformed/noncanonical bytes, digest mismatch, binding mismatch, hostile
  driver row, ownership, and exact failure tests; and
- focused PGlite plus genuine-PostgreSQL behavior if its transaction or schema
  contract changes.

### Standard Application verifier

- **complete for the pure owner:** empty and populated golden evidence and
  every role decode/re-encode path;
- **complete:** missing, reordered, wrong-reference, wrong-ordinal,
  wrong-codec, length, digest, and noncanonical object negatives;
- **complete:** recomputed module/projection/entry/group/materialization and
  Application revision binding roots;
- **complete:** catalog/candidate/source/semantic/package/artifact/revision
  correlation and implementation/date/flag/compute-profile admission cases;
- **complete:** canonical-basis round trip, exact error-channel typing,
  ownership, hostile accessor/detached-byte rejection, and mutation across an
  asynchronous hash boundary;
- protocol maximum shapes remain covered by the SAP-TRP1/SAP-TRP4 codecs; and
- maximum admitted host policy, above-host-policy rejection, I/O interruption,
  and settlement remain step-3 backend responsibilities.

### Backend object-read composition

- in-memory and Miniflare empty/populated cold reads;
- missing/corrupt/resource/settlement-uncertain mapping;
- exact requested-versus-returned reference correlation;
- no arbitrary key, raw bucket, database, launch, or Worker Loader authority;
- deterministic fixed-pool scheduling and canonical-order proof;
- admitted concurrency/peak-memory/whole-operation budget proof;
- a non-settling-get test that cannot be presented as settled merely because an
  outer Effect timed out; and
- hosted Cloudflare R2 proof before any production-capable claim.

### Persistence and activation

- additive migration from the immediately prior journal and an empty database;
- legacy version-1 exact read/replay and explicit task-launch exclusion;
- version-2 empty and populated readiness insert/replay;
- restrictive SAP-TRP4 receipt foreign key and shape checks;
- snapshot/final-transaction drift for authority, catalog, receipt, membership,
  schema, physical readiness, and runtime policy;
- no R2 call while the final transaction is open;
- active-selection projection and exact activation/read-active replay;
- no task head, dual write, implicit empty receipt, or legacy synthesis;
- rollback after the task-aware readiness insert;
- hidden-commit response followed by cold replay; and
- deterministic genuine-PostgreSQL concurrency plus reusable-connection proof.

Every significant implementation checkpoint requires focused package
typechecks/tests, migration checks, Trigger boundary checks, scripts typecheck,
frozen-lockfile/diff checks, and both required project reviewers against the
final staged diff.

The live `check:standard-application-definition-boundaries` command currently
has a pre-existing baseline defect: its checker still requires exactly two
package exports and an older import allowlist, while the committed package has
four exports and the newer Application/task-runtime owners already use the
reported imports. The checker reports those committed files even without this
checkpoint. Its own 42 focused checker tests pass, and this checkpoint adds no
new package export or forbidden dependency. This roadmap records the expected
behavior (the checker must describe the current committed package boundary),
the actual stale baseline, the owning tooling boundary, and the disposition:
do not weaken or opportunistically repair that shared checker here; require a
separate owner-approved correction before presenting the live command as a
green SAP-TRP5 release gate.

## Proposed Implementation Order

After explicit approval of each remaining checkpoint:

1. **Complete:** correct the shared `ApplicationTaskCatalogSnapshotPort` defect
   as its own bounded prerequisite commit;
2. **Complete:** add the pure Standard Application
   cold-verification/readiness-basis contract;
3. add the backend verifier using only the existing task-runtime store `read`;
4. add the persistence snapshot and version-2 readiness schema/migration;
5. integrate version-2 issuance and legacy version-1 read compatibility into
   the existing readiness repository;
6. extend the existing activation-basis projection and transactional
   revalidation without changing active-head authority;
7. prove PGlite, Miniflare, and ordinary-role genuine-PostgreSQL behavior; and
8. stop production-inert after final reviewers and one or more bounded commits.

The implementation may be split at these owner boundaries. Passing an earlier
checkpoint does not authorize the later one automatically.

## Explicit Non-Goals

SAP-TRP5 does not authorize:

- SAP-TRP6's production located runtime reader;
- DTE06-D2/D3/D4, Worker Loader, provider, or private host composition;
- durable heartbeat, completion, result publication, cancellation settlement,
  retry decisions, or supervision;
- a task-specific activation record, active head, readiness table, or routing
  decision;
- raw R2, database, transaction, credential, or locator authority in Standard
  Application or the compute provider;
- task input publication or reading;
- object repair, overwrite, deletion, garbage collection, or eager retention;
- public SDK, HTTP, management, observability, live UI, route, Queue, Cron,
  Worker, binding, deployment, or production activation;
- Trigger Prisma, Redis, Redlock, product-host, or workspace imports; or
- changes to OCC, commit compilation/execution, journals, idempotency, outbox,
  change feeds, or authoritative application rows.

## Stop Boundary

SAP-TRP5 is implemented only through the pure step-2 boundary. The next
decision is whether to approve a bounded backend step-3 preflight that closes
the R2 admission/deadline/settlement gap, reads exact SAP-TRP4 membership only
through the existing immutable store, and wraps the pure basis in a
composition-owned proof. It must remain independent of persistence/schema,
readiness issuance, activation changes, and production wiring.

If implemented, SAP-TRP5 ends when the existing Application readiness and
active-selection chain can prove an explicit empty or fully cold-verified
populated task runtime while remaining unwired. It does not make task execution
production-ready. SAP-TRP6 then owns the real located DTE06-D1 read adapter,
and the separate run-input object-store gate must also close before launch can
be production-complete.
