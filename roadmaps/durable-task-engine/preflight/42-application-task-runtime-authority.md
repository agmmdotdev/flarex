# Preflight 42: Application Task Runtime Authority

## Status And Scope

**Status:** `SAP-CAA1-A/B/C/D/E` is committed. `SAP-CAA1-F` and its separately
approved shared commit-graph prerequisite are implemented locally as the next
production-inert checkpoint. The current runtime publication now
has a private
transaction-only readiness snapshot that independently compares Application
parent/catalog evidence with canonical receipt/membership evidence before any
object-store work. No parallel V2 runtime, legacy reader, dual write, fallback,
or production composition was added. External
deployment inventory remains a hard gate before applying this corrected
migration to any persistent owned environment.

This preflight resolves the candidate-authority blocker discovered by
SAP-TRP5. It defines how Standard Application task-runtime publication and
readiness bind to the current Application Analysis candidate, revision,
publication, and task catalog without treating the displaced Declarative V2
candidate table or a task-runtime receipt as its own authority.

This is a prerequisite to persistence step 4 in
[`41-standard-application-task-runtime-readiness.md`](./41-standard-application-task-runtime-readiness.md).
It authorizes task-aware Application-readiness persistence, its final
transactional revalidation, and the bounded `SAP-CAA1-F` projection through the
existing Application activation and active-selection owners. It does not
authorize Task System launch, Worker Loader composition, hosted R2 operation,
or production wiring.

## Why There Is No Second Runtime Version

The Task System foundation was implemented recently, but the task-runtime
publication/readiness path remains private and production-inert. Repository
inspection on 2026-08-13 found:

- the runtime publication, receipt, connected-delivery, and launch factories
  are defined but have no non-test production composition consumer;
- the relevant package entries are private `internal/*` subpaths;
- no readiness repository, activation path, Worker Loader host, route, Queue,
  Cron Trigger, or deployment consumes the task-runtime publication; and
- the owning roadmaps explicitly stop before production activation and wiring.

The current `...V1` suffixes therefore do not prove a compatibility obligation.
They describe an internal implementation chronology that has not reached the
core Application execution path. Creating V2 beside it would preserve the
wrong authority, add migration and fallback surface, and contradict the
workspace naming rule for the accepted current implementation.

The current runtime contracts are corrected in place and use plain semantic
names, including:

- `ApplicationRevisionTaskBinding`;
- `TaskRuntimePublicationReceipt`;
- `TaskRuntimePublicationAuthority`;
- `PreparedTaskRuntimePublication`; and
- `TaskRuntimeReadiness` where the name belongs to this runtime owner.

Use `Legacy...` only if the inventory below proves that a displaced runtime
implementation must remain readable or executable. If there is no retained
consumer or persisted state, delete the old shape rather than manufacturing a
legacy product path.

This naming decision does not rename unrelated concrete compatibility
contracts such as Source Artifact V2, Task IDs, RPC envelopes, or already
shipped Application readiness generations. Those owners retain their version
markers when exact coexistence or decoding requires them.

## The Authority Defect Being Corrected

The displaced `TaskRuntimePublicationReceiptV1` and
`ApplicationRevisionTaskBindingFrameV1` shapes bound a
`DeclarativeV2CandidateFrameV1` digest plus package, artifact, source, and
semantic digests.

The current Application Analysis generation deliberately owns a different
authority chain:

- a backend-issued Application candidate ID bound to one Source Artifact V2
  root and exact scope clock;
- one analyzed Application manifest and receipt;
- one inactive Application revision;
- one whole-Application publication digest; and
- one Application task-catalog binding digest.

It has no foreign key or authenticated relationship to the old inert
Declarative candidate table. Roadmap 49 explicitly forbids adding such a
relationship to the new generation. The Application candidate ID is not the
old candidate digest, and the Application publication digest must not be
renamed or copied into old `candidateSha256`, `packageSha256`,
`artifactSha256`, or `semanticRootSha256` fields.

The failed SAP-TRP5 prototype decoded the current task-runtime receipt and
supplied those four values back to the verifier as expected evidence. That
proved only receipt self-consistency. It did not prove that the Application
revision chose the physical candidate represented by those values.

## Accepted Current Authority

The corrected runtime publication binds directly to the existing authenticated
Application task-catalog chain. The Application task-catalog binding already
commits:

- scope, Application candidate, analysis, and inactive revision identities;
- Source Artifact V2 root;
- whole-Application publication digest;
- canonical task-catalog digest and task count; and
- runtime-host identity and compatibility date.

Its digest is the independent parent commitment for the current task-runtime
publication. No second candidate table, lookup, compatibility projection, or
runtime generation is needed.

```mermaid
flowchart LR
  C["Application candidate + exact scope clock"] --> A["Analyzed manifest and inactive revision"]
  A --> P["Whole-Application publication"]
  P --> T["Application task-catalog binding"]
  T --> R["Current task-runtime publication"]
  R --> V["Cold-verification proof"]
  V --> D["Task-aware Application readiness"]
```

The task-runtime receipt is evidence below the task-catalog binding. It never
selects or authenticates its own parent.

## Corrected Standard Application Contract

### Application revision task binding

The current binding commits:

- `applicationTaskCatalogBindingSha256`;
- canonical task-catalog digest and count;
- task-entry root;
- nullable task-runtime projection, group-manifest, and materialization-spec
  digests; and
- an exact empty-versus-populated shape.

It contains no Declarative candidate digest, package digest, artifact digest,
or semantic root. Source and Application publication authority are reached
through the authenticated task-catalog binding digest.

### Task-runtime publication receipt

The current canonical receipt commits:

- scope, Application candidate, analysis, and revision identities;
- Source Artifact V2 root and whole-Application publication digest;
- Application task-catalog binding and task-catalog digests;
- the Application revision task-binding digest;
- task-entry and nullable singleton roots;
- ordered immutable runtime-object membership; and
- object count and canonical byte total.

It has a strict canonical encoder/decoder, stable codec identity, digest, byte
ceiling, role/count ceilings, and exact empty/populated correlation. These are
properties of the current persisted contract, not reasons to call the whole
implementation V2.

### Preparation authority

The corrected preparation operation accepts only:

- an owned prepared Standard Application definition/source graph;
- an owned hashed canonical task catalog;
- authenticated Application task bindings from the same catalog owner;
- an owned Application publication/task-catalog authority projection; and
- trusted runtime materialization policy.

It rehashes and correlates these inputs before producing runtime objects and a
receipt. It does not accept a raw database row, arbitrary candidate frame, old
Declarative repository, or caller-selected digest bundle.

## Consumer And Persistence Inventory Gate

Source inventory is currently empty: no non-test production source constructs
the publication receipt authority, publication preparation, publication
repository, launch authority, or connected runner. The private export paths and
test fixtures do not create a compatibility obligation.

Migration `0061_modern_avengers.sql` introduced the current task-runtime header
and membership tables on 2026-08-12. This checkout has no configured
PostgreSQL URL or deployment inventory proving whether that migration reached a
persistent environment. Source-level non-use is not proof that database state
is empty.

Before changing the persisted shape:

1. inspect every configured development, staging, and production migration
   journal that this repository actually owns;
2. count task-runtime publication and membership rows where the tables exist;
3. identify any external reader or writer not visible in this checkout; and
4. record the commands, environment identities, migration state, row counts,
   and owner conclusion without exposing credentials.

If all owned environments are absent or empty and no external consumer exists,
the correction may replace the unused schema/migration and current code in one
bounded cut. It must leave no legacy reader, dual write, fallback, or parallel
runtime table.

If any environment or consumer is nonempty, stop. Record that evidence and
obtain separate approval for the smallest explicit `Legacy...` retention or
data migration. Do not silently turn this preflight back into a V1/V2 design.

## Persistence Contract After An Empty Inventory

Persistence owns one current Application task-runtime publication and
membership schema. Its header has a restrictive foreign key to the exact
existing Application task-catalog tuple containing scope, revision, candidate,
Application publication digest, task-catalog digest, and task-catalog-binding
digest. It stores the exact current receipt bytes and digest plus normalized
roots. Membership rows reference the exact receipt identity and retain the
canonical order, role, codec, object key, length, and digest.

The publication transaction:

1. locks the current scope clock;
2. locks and verifies the Application candidate's stored generation, fence,
   epoch, and Source Artifact root;
3. locks and canonically verifies the Application task catalog and binding,
   whose existing restrictive foreign keys retain the inactive Application
   revision and whole-Application publication parents;
4. captures only a receipt issued by the configured Standard authority;
5. compares every receipt parent field to the independently loaded rows; and
6. inserts or exactly replays the header and ordered membership atomically.

No R2 operation or readiness write occurs in this transaction.

## SAP-TRP5 Snapshot Contract

After this prerequisite, the SAP-TRP5 reserve transaction may load:

- the current Application candidate/revision/publication/task-catalog chain;
- the exact current task-runtime publication and membership; and
- the existing schema, candidate-validation, physical, and unique-constraint
  readiness prerequisites.

The snapshot supplies expected evidence from the Application parent rows and
task-catalog binding. It supplies receipt evidence from the runtime receipt. It
compares the two before returning. No expected field may be derived solely from
the receipt field it is intended to authenticate.

The final readiness transaction reloads and compares the same Application
parents, receipt digest, and normalized membership. It accepts only a cold-
verification proof captured by the same configured backend authority instance.

## Failure Policy

| Condition | Result |
| --- | --- |
| Application candidate/revision/publication/catalog missing | deterministic not-ready or missing-parent result owned by the caller |
| Current scope authority differs from candidate authority | stale-authority failure |
| Task-catalog binding or publication digest differs | non-retryable authority mismatch |
| Receipt parent fields differ from independently loaded parents | non-retryable authority mismatch |
| Receipt or membership is malformed/noncanonical | stored-state corruption |
| Exact receipt already exists | exact replay |
| Different receipt exists for the revision | conflicting replay |
| Transaction response is uncertain | no success claim; exact cold replay allowed |
| Database resource failure | typed retryable persistence failure when classification permits |

An authority mismatch is never repaired by selecting a Declarative candidate
row, trusting receipt self-consistency, or trying a parallel runtime version.

## Required Validation

### Standard Application

- current binding and receipt canonical round trips and golden digests;
- empty and populated publication preparation;
- exact Application publication/task-catalog correlation;
- wrong scope/candidate/analysis/revision/source/publication/catalog negatives;
- proof that the current receipt contains no old
  candidate/package/artifact/semantic fields;
- hostile accessor/proxy, detached/shared byte, ownership, and asynchronous
  mutation tests; and
- source-level proof that no old/current fallback or dual path remains.

### Persistence

- the environment/consumer inventory above;
- fresh and immediately-prior-journal PGlite migrations;
- ordinary-role genuine-PostgreSQL migration in a non-public schema;
- empty and populated publication plus exact replay;
- same IDs and source root with a changed parent publication/catalog digest;
- receipt self-consistent but parent-inconsistent negative proof;
- restrictive parent and membership foreign keys;
- malformed stored receipt/membership, rollback, hidden commit, competing
  publication, and reusable-connection proof; and
- a zero-write proof for every rejected authority case.

### SAP-TRP5 reconnection

- reserve snapshot derives expected evidence from Application parents;
- receipt evidence is compared independently before R2;
- parent drift and membership drift fail on final revalidation;
- no database lock remains open during R2; and
- step-2, foreign, and other-instance backend proofs remain rejected.

## Implementation Order

The original implementation order was:

1. `SAP-CAA1-A`: record the external consumer/deployment inventory, then correct
   the pure Standard Application binding, receipt, preparation, names, and
   tests in place;
2. `SAP-CAA1-B`: after an empty inventory, correct the current persistence
   schema/repository and prove PGlite plus genuine PostgreSQL behavior;
3. `SAP-CAA1-C`: replace the discarded SAP-TRP5 snapshot prototype with the
   parent-versus-receipt correlation;
4. `SAP-CAA1-D`: settle the snapshot transaction, then compose the existing
   backend cold verifier against that owned snapshot with a trusted runtime
   policy and process-local proof;
5. `SAP-CAA1-E`: extend the existing Application readiness owner with explicit
   task-aware issuance and final revalidation after the connected proof exists;
   and
6. `SAP-CAA1-F`: extend the existing activation and active-selection basis with
   the exact task-readiness projection while preserving one active head; and
7. create a legacy-retention checkpoint only if concrete inventory evidence
   requires one.

The approved correction implemented steps 1 and 2 together because the private
persistence repository directly compiles against the corrected Standard
Application receipt. Keeping only step 1 would have required a temporary alias
or compatibility reader for an implementation with no retained consumer,
which would contradict this preflight's no-parallel-path decision. Steps 3 and
4 are now complete as separate production-inert checkpoints. `SAP-CAA1-E` owns
the schema extension, exact legacy replay, task-aware issuance, and final
no-network revalidation/commit. `SAP-CAA1-F` is separately approved below;
launch remains unimplemented.

### SAP-CAA1-D connected-verification boundary

The persistence owner supplies one read-only reservation operation. It cannot
succeed until the snapshot transaction settles. The backend owner then:

1. receives the owned snapshot or the explicit missing result;
2. combines parent evidence with one trusted, constructor-captured runtime
   materialization policy;
3. invokes only the existing cold-verification authority after reservation
   settlement;
4. preserves persistence and object-store failures in their original typed
   channels; and
5. mints an instance-local connected proof containing copy-on-read receipt and
   readiness-basis evidence.

This checkpoint must prove the cold verifier is never called for a missing
snapshot and cannot run while the reservation transaction is open. It writes
no readiness row and is not currently imported or wired by a production Worker
or route. Production import prevention remains an activation-boundary gate, not
an authority inferred from the current dependency graph.

Local `SAP-CAA1-D` evidence:

- the persistence reservation cannot succeed until transaction settlement and
  classifies a hidden successful response as typed settlement uncertainty;
- the backend connected authority captures the canonical receipt, digest, and
  parent evidence once, applies the constructor-captured runtime policy, then
  reuses the existing cold verifier;
- missing snapshots produce zero object-store reads and no proof;
- connected proofs are authority-instance-local and expose only copy-on-read
  receipt/readiness evidence; and
- focused backend tests, PGlite tests, genuine PostgreSQL 18 lock/settlement
  tests, package typechecks, Effect boundaries, and Trigger boundaries pass.

### SAP-CAA1-E task-aware readiness boundary

The existing Application readiness repository remains the only readiness
owner. Its plain current `settle` operation becomes task-aware, while the
retained displaced function-only operation is named `settleLegacy`. The current
operation:

1. completes its existing schema, physical, unique-constraint, and ordinary
   function cold-read prerequisites;
2. invokes the configured connected task-runtime authority outside the final
   transaction;
3. captures only a proof issued by that exact connected-authority instance;
4. decodes, hashes, owns, and correlates the canonical runtime-readiness basis;
5. relocks and reloads the exact runtime publication and membership through
   the existing transaction-only snapshot owner; and
6. inserts or exactly replays the same Application readiness row with an
   explicit task-aware canonical envelope.

The existing persisted legacy readiness envelope remains an exact compatibility
contract. New task-aware settlement cannot synthesize it, update it in place,
or treat it as task-launch authority. The schema extension therefore admits
only two exact shapes: legacy readiness with null task columns, or task-aware
readiness with a restrictive runtime-publication foreign key plus canonical
basis bytes and digest. This is compatibility-contract versioning, not a
parallel product/runtime implementation.

No R2 or other network call may occur while the final transaction is open.
`SAP-CAA1-E` does not change activation or expose the task basis through an
active selection; that remains the next separately approved checkpoint.

Locally implemented `SAP-CAA1-E` evidence:

- additive migration `0062_new_maestro.sql` admits only exact legacy
  version-1 or task-aware version-2 readiness shapes and restrictively binds
  version 2 to the immutable runtime-publication receipt;
- empty and populated task-aware settlement insert and replay the current
  version-2 envelope, while `settleLegacy` preserves exact version-1 bytes;
- neither compatibility shape can overwrite or convert the other;
- a runtime-membership change after connected verification is rejected by the
  final transaction with no readiness row; and
- `SAP-CAA1-E` itself retained activation on `settleLegacy`; the separately
  approved `SAP-CAA1-F` checkpoint below now moves the current activation path
  to exact task-aware settlement and selection projection.

Local validation passes persistence, backend, and system-test typechecks; 39
Application readiness/activation/query tests; the 29-test PGlite migration
chain; Drizzle generation agreement; scoped Oxlint; Effect boundaries; and the
Trigger boundary. The added ordinary-role genuine-PostgreSQL schema/constraint
and task-aware settlement lane is skipped locally because
`FLAREX_POSTGRES_DATABASE_URL` is unset.

### SAP-CAA1-F task-aware activation boundary

The approved checkpoint reuses the existing Application activation row, CAS
head, activation request, and active-selection capability. It adds no task
activation table, task head, dual write, or alternate routing decision.

The current activation operation must call the current task-aware readiness
operation, then revalidate that exact issued evidence inside the existing
activation transaction. The readiness owner remains responsible for relocking
and comparing the immutable runtime publication and membership without network
work. The activation basis and active selection project an owned copy of:

- the explicit `empty` or `populated` task-runtime kind;
- the runtime-publication receipt digest;
- the readiness-basis digest; and
- the decoded canonical readiness basis needed by the later located launch
  adapter.

`readActive` must reconstruct and revalidate the same task-aware readiness
before returning a selection. A selection minted from legacy readiness remains
rejected by the current task-aware activation path; the retained legacy
settlement operation is test/compatibility evidence, not current activation
authority. Existing activation and head canonical frames continue to bind the
readiness digest, which already commits the task projection, so this checkpoint
does not create a new activation wire or persisted-schema version.

The stop boundary remains production-inert: no Worker, route, Queue, Cron,
Task System run creation, Worker Loader, or task-runtime object read is wired.

#### Shared commit-authority blocker discovered during SAP-CAA1-F

The first connected PGlite activation run exposed a shared-owner incompatibility:

- **scenario:** issue exact task-aware readiness version 2, activate that
  revision through the existing Application head, create an ordinary
  Application mutation session, and load its stored commit-authority graph;
- **expected:** the graph verifier accepts the same authenticated Application
  candidate, publication, schema, function, task-aware readiness, and activation
  evidence already accepted by the activation owner;
- **actual:** `verifyApplicationMutationCommitAuthorityGraph` reconstructs only
  the legacy version-1 `flarex.application-readiness` canonical frame, so the
  loader returns `applicationGraphInvalid` for the valid version-2 readiness;
- **affected owner:**
  `packages/persistence-postgres/src/applicationMutationCommitAuthorityGraph.ts`
  and its stored-commit materialization caller, which are shared commit/OCC
  authority rather than the Application activation owner; and
- **evidence:** the focused `Application activation` PGlite lane passes the
  new activation insert/read projection cases but fails the existing
  `admits and replays exact Application mutation authority` assertion at the
  first stored graph load (`expected loaded`, `received corrupt`).

**Disposition:** separately approved and corrected in the shared owner. The
existing graph now loads the immutable Application task catalog for both exact
readiness shapes and the immutable task-runtime publication only when validating
task-aware readiness. It reconstructs the unchanged legacy canonical frame or
the exact task-aware canonical frame, decodes and hashes the canonical readiness
basis, and correlates its Application/catalog/runtime-publication evidence before
accepting the graph. Legacy readiness remains valid even if a runtime publication
is registered later. No fallback, dual write, parallel verifier, commit-execution
change, OCC change, journal change, idempotency change, outbox change, or
Application-row change was added.

Local `SAP-CAA1-F` evidence now proves:

- current activation settles and transactionally revalidates task-aware
  readiness before the existing CAS head changes;
- insert, exact replay, cold `readActive`, second-revision head movement, and
  query/mutation selection revalidation preserve the same task basis;
- the returned active basis and the process-local selection own independent
  copies of all task digests, lists, and canonical readiness-basis data;
- retained legacy readiness is rejected as current activation authority without
  writing activation history or a head;
- the stored commit-authority loader accepts exact task-aware readiness and
  still rejects post-capture corruption; and
- the shared graph has isolated positive coverage for both compatibility shapes
  plus negative task-basis digest correlation.

Validation on 2026-08-13: Standard Application and persistence typechecks pass;
the focused Application readiness plus commit-graph PGlite lane passes 2 files
and 56 tests. No genuine-PostgreSQL URL is configured in this shell, so no new
external database claim is made for this behavior-only checkpoint.

## Local Implementation Receipt

Completed on 2026-08-13:

- replaced the current task-runtime publication and revision-binding names with
  plain semantic names while retaining version markers on concrete object,
  Task Definition, RPC, and persisted SQL compatibility contracts;
- removed the Declarative candidate frame/digest plus package, artifact, and
  semantic roots from publication preparation, binding, receipt, and readiness
  evidence;
- made the Application task-catalog binding, Application publication digest,
  Source Artifact root, and scope/candidate/analysis/revision tuple the exact
  parent authority;
- corrected migration `0061_modern_avengers.sql`, its Drizzle snapshot, schema,
  publication repository, and test fixtures in place; and
- added exact negative coverage for every Application parent facet and for a
  changed independently stored Application publication digest.

Completed for `SAP-CAA1-C` on 2026-08-13:

- extended the existing `ApplicationTaskCatalogSnapshotPort` to expose its
  already authenticated canonical catalog through a copy-on-read operation;
- added one private transaction-only runtime-readiness snapshot port that
  locks and correlates the current scope clock, inactive revision, Application
  candidate/publication, authenticated task catalog, canonical runtime receipt,
  and normalized object membership;
- derives readiness parent evidence only from the independently authenticated
  Application parent/catalog side and never from the receipt field it checks;
- returns `null` when the current runtime publication is absent, with no R2
  call or readiness write; and
- proves a structurally self-consistent receipt with a different Application
  publication parent fails before object-store work.

Inventory evidence for this checkout:

- no non-test production composition consumer was found;
- no configured development, staging, production, or shared PostgreSQL URL was
  present in the working shell;
- local PGlite and a disposable PostgreSQL 18 instance prove the corrected
  migration/repository, but do not claim that an unknown external environment
  is empty; and
- therefore deployment remains blocked until an owner supplies and audits each
  actual persistent environment named by the deployment process.

Validation receipt:

- Standard Application typecheck and 69 tests passed;
- backend typecheck and 17 focused object-store/readiness tests passed;
- persistence typecheck passed;
- PGlite publication plus full migration-chain tests passed;
- genuine PostgreSQL 18 publication tests passed against a disposable local
  instance; and
- Trigger compatibility boundary check passed.

`SAP-CAA1-C` validation adds focused PGlite coverage for missing, empty,
populated, ownership, stored-membership drift, and self-consistent
parent-inconsistent receipt cases, plus a genuine PostgreSQL 18 transaction
and reusable-connection proof. This checkpoint changes no schema or migration.

## Explicit Non-Goals

This preflight does not authorize:

- a foreign key from Application Analysis to the old Declarative candidate;
- a parallel V2 runtime implementation, dual write, comparison path, or read
  fallback;
- preserving an unused implementation under `Legacy...` without evidence;
- changing unrelated concrete wire, RPC, Source Artifact, or Application
  readiness compatibility contracts;
- a generic candidate API or universal database abstraction;
- production activation wiring or an active-selection consumer that launches
  a task runtime;
- Task System definition/run creation, compute delivery, Worker Loader, or
  production routing;
- R2 credentials, object reads, repair, deletion, or garbage collection;
- OCC, commit, journal, idempotency, outbox, change-feed, or Application-row
  authority changes; or
- public SDK, route, Queue, Cron, deployment, or observability behavior.

## Stop Boundary

This preflight is complete when the correction-in-place decision and inventory
gate are recorded and linked from SAP-TRP4/SAP-TRP5. No implementation starts
until the user approves `SAP-CAA1-A`.

The prerequisite implementation ends after one private, production-inert
current runtime publication can be prepared, persisted, and independently
correlated to the Application task-catalog authority with PGlite and
genuine-PostgreSQL proof. It does not make task readiness, activation, launch,
or hosted execution complete.
