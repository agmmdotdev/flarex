# Application Projection And Data Bindings Preflight

Status: private implementation complete for Application-only binding,
owner-correct synthetic Medusa commerce evidence, and scalar content-overlay
admission against activated V3 Application ownership. The Application selector
retains authority. CMS document operations/publication, Payload lifecycle
profiles, real framework adapters, relational data writes and production
serving remain gated.

## Outcome And Boundary

Connect an exact installed schema to a scope that may use it. One private
capability should cover the read-only Application projection, immutable binding
candidates, atomic framework selection, transaction-local admission, and restart
recovery. Implement and validate these together, rather than separating value
codecs, metadata and recovery into another sequence of approval checkpoints.

The existing Application selector remains authoritative. A framework binding
pins its exact current activation; it cannot select an Application revision,
create another content schema or grant domain mutation permission. A complete
binding set is admitted or refused as a unit. Optional lanes add no dependency
when absent.

This is the next dependency after the completed
[bounded installation and additive upgrade capability](./12-base-backed-additive-upgrade.md).
It precedes the owner-scoped transaction/store and typed finalization work in
[the master sequence](../README.md#master-execution-order). It does not introduce an
adapter, a public API, production target resolution, a general transaction API,
cross-database atomicity, or a combined Application/framework activation owner.

## Current Evidence And Reuse

Paths below are relative to `packages/persistence-postgres/` unless stated
otherwise. These are implementation seams, not claims that the binding path
already exists.

| Existing owner | Evidence and disposition |
| --- | --- |
| `src/applicationActiveHeadRead.ts` | **Keep.** `readCoherentApplicationActiveHeadForShareInTransactionEffect` authenticates the selected head and immutable activation frame. Its output alone does not authenticate the complete schema/readiness/placement projection. |
| `src/applicationReadiness.ts`, `src/applicationRelationReadinessFold.ts`, `src/applicationActivation.ts` | **Keep.** Reuse the existing readiness validation and exact activation matching for both admitted readiness variants. Add a narrow Application-owned read composition; do not reconstruct those rules in the framework owner. |
| `src/scopeAuthorityResolution.ts`, `src/scopeClock.ts` | **Keep.** Reuse trusted target resolution and generation/fence/epoch validation. Existing activation paths already take the scope clock before dependent selection work. |
| `src/frameworkSchema/installation/` | **Keep.** Restore exact installation/readiness/history evidence through existing repositories. The ordinary availability-head reader does not by itself hold an availability row lock; accepting transactions need a narrow locked read and corroboration operation here. |
| `src/migrationCoordination/targetSession.ts` | **Keep as migration authority.** Its structural capability and driver identity are not a framework serving or data-write capability. Reuse owned identity checks, not the migration handle as a universal session. |
| `src/relationalSchema/physical/model.ts` | **Keep.** Physical evidence explicitly leaves searchable-text queries, numeric companion writes, managed timestamp updates and soft-delete behavior as residual requirements. |
| `test/applicationRelationBinding*.test.ts`, `test/transactionSessionActivation*.test.ts` | Preserve Application binding/activation and native contention/uncertain-settlement evidence. Extend focused coverage where the new composition consumes these owners. |

The accepted
[framework architecture](../../../design-notes/flarexdb-framework-storage-architecture.md#coordinated-data-bindings)
and [binding owner](../02-schema-artifacts-and-bindings.md#data-binding-set)
govern these decisions. Neither generic artifact-owner vocabulary nor a
migration receipt supplies a runtime lane or a semantic write owner.

## Application Projection

Issue the projection through an Application-owned operation inside the caller's
accepting transaction. Authenticate the coherent active head, its selected
revision/schema binding, the corresponding readiness basis, and trusted scope
placement together. Use the existing schema/readiness owners to validate their
evidence; merely checking digest lengths or joining matching IDs is insufficient.

The durable reference contains:

- deployment and scope identity, physical locator, storage generation and fence,
  the opaque storage epoch, and the separate authorization-revocation epoch;
- exact Application activation sequence, head digest and activation digest;
- revision identity, schema-version identity, Application schema digest,
  schema-manifest digest and readiness digest; and
- the existing discriminated readiness contract: legacy schema-binding evidence,
  or relation-aware manifest-binding/bound-publication and relation-readiness
  commitments. Preserve the relation frontier and relation count where required
  by that owner; do not downgrade a relation-aware reference to a legacy one.

Do not pin the scope's advancing `lastCommitSeq` or `lastOutboxSeq` as binding
identity. Ordinary data commits must not invalidate a binding. An immutable
relation-readiness frontier remains part of its own readiness evidence.

Canonical references are serializable evidence. An authenticated projection is
an opaque transaction-local value, bound to the exact issuing transaction and
resolved target. Deserialization, object spreading, matching properties, or
reusing a handle after transaction settlement cannot manufacture that authority.
Application absence is an explicit refusal; there is no default revision.

## Binding And Capability Contract

`DataBindingSet` has exactly these slots:

| Slot | Required evidence |
| --- | --- |
| `application` | The exact Application projection above; always required. |
| `payloadContent` | Optional independent canonical Payload configuration/provenance identity, exact Application reference and stable table IDs, plus Application-owned table write-policy evidence. It has no independent content installation. |
| `payloadLifecycle` | Optional `payload`-owned artifact, installation, readiness and exact ready availability token, plus authenticated lifecycle adapter/store requirements. |
| `commerce` | Optional `medusa`-owned artifact, installation, readiness and exact ready availability token, plus authenticated commerce adapter/query/store requirements. |
| `crossDomainReferences` | Empty in this capability. Non-empty input is rejected. |

There is no catch-all slot or generic `system` binding. A `system` installation
cannot be relabeled as commerce or Payload lifecycle to exercise this path.
Neither a populated content overlay nor installation readiness alone can grant
Payload writes; the separately owned Application write-policy gate is still
required. Absent owner support is a typed refusal, not an implicitly supported
empty capability profile.

The private scalar content overlay requires policy-bearing, relation-free
Application readiness and the complete retained managed-table set in ascending
stable table-ID order. Configuration, provenance and per-table write-policy
digests must match activated ownership. Legacy readiness, missing/extra or
ordinary tables, stale heads and corrupt ownership are refused. Head movement
requires explicit overlay rebinding. This admission alone grants no CMS document
operation. The separate private request host and materialization capability now
consume it under the [accepted CMS contract](./17-cms-request-transactions-and-application-publication.md).

Each physical binding pins owner-qualified artifact identity, target namespace,
installation/receipt digest, readiness digest, and the exact availability
sequence/history digest/status. It separately pins the identity and canonical
contract digest of the required adapter, query and store profiles. Match every
residual requirement against its exact capability and table/column identities.
An unrelated profile with the same feature name is insufficient.

A trusted, closed runtime composition must authenticate the implementation of
each profile in the current target/session. Persisted profile digests identify
the required contract; they are not proof that the loaded implementation meets
it. Unknown profiles and missing residual coverage refuse admission. Test-only
profile issuers stay in test composition and cannot resolve in a production
host. This preflight does not claim any real Payload or Medusa profile is ready.

Use strict canonical frames for the candidate, activation request, immutable
activation record and mutable head. Reuse existing identity and canonical-byte
validation conventions. Codec versions describe persisted compatibility only.
Candidate identity includes all slots and their scope/placement commitments;
an activation request also includes its stable request identity and expected
previous framework-head token. Operational timestamps belong to history, not
candidate identity. The head token is sequence plus digest, not candidate ID.

The initial implementation should bound each candidate at 1 MiB, allow at most
the two named physical bindings, and accept no more than 64 residual capability
requirements per physical binding. Profile kinds are the closed adapter/query/
store set. Apply byte/count limits before parsing or following dependencies;
reuse the installed coordinator's graph limits for referenced installation
evidence. Larger profiles require an explicitly reviewed limit change.

## Persistence And Private Operations

Keep binding persistence in source-private
`src/frameworkSchema/binding/`. Application projection validation stays with
the Application owner; adapters and `flarex-protocol` do not receive the database
or new public exports. Separate pure frames/policy, repository operations and
transaction orchestration. Use the repository's Effect conventions for scoped
work and typed failure boundaries during implementation.

Add target-local platform metadata through the existing migration owner:

- immutable binding candidates, keyed by scope/generation and canonical digest;
- normalized candidate physical-lane references, unique by candidate and named
  slot, with exact installation/readiness/immutable availability-history foreign
  keys and corroborated owner/target identity;
- immutable activation history with a scope-qualified unique request identity,
  candidate reference, expected previous head, resulting sequence and digest;
  and
- one framework head per scope/generation selecting an exact history record.

Canonical bytes remain authority; normalized columns enforce constraints and
bound indexed access and must be corroborated on restore. Application refs are
read-only dependencies, not rows in a new Application catalog. Do not reference
mutable availability heads as though they were immutable readiness history.
Choose the next migration number from the live journal during implementation.

Index current selection and exact-request recovery directly. Ordinary admission
restores the selected head/history/candidate and its bounded dependencies; it
must not walk every prior binding activation. Historical audit pagination is
outside this capability. Read-pass caches may reuse immutable corroborated
evidence, but may not cache a mutable head as current authority.

The private operation surface is: prepare a candidate, activate an exact
candidate with compare-and-set, inspect/recover an exact activation request,
and admit the current complete binding set in an accepting transaction. No
operation accepts arbitrary SQL, a raw adapter-supplied driver, a caller-authored
readiness assertion or an unauthenticated runtime profile.

All selected physical lanes and the binding metadata must resolve to the same
transaction-capable physical authority as the scope/Application state in this
first profile. Different locators or database identities refuse admission.
Being located on the same PostgreSQL server is not sufficient.

## Locking And Admission

An outside-transaction head read is only a hint identifying dependencies to
load. It is never selection authority. After trusted local target/profile
resolution, the first private accepting transaction follows this order:

1. Lock the scope clock for update and validate scope, generation, fence and
   epoch. Take this lock at entry; do not introduce a shared-to-exclusive clock
   upgrade or move the existing commit lock later in the transaction.
2. Authenticate and lock the exact Application head and validate the owned
   schema/readiness projection in the same transaction.
3. Lock every referenced availability head in canonical target/owner/
   installation order, then corroborate its exact installation, readiness and
   immutable history. All must still equal the candidate's ready tokens.
4. Lock/re-read the framework head and its immutable candidate/history. For
   activation, verify the expected prior head; for admission, verify the hint
   still identifies the complete selected set.
5. Validate residual profiles and any lane-specific write-policy evidence;
   atomically append activation history and switch the framework head, or issue
   a transaction-local admitted selection. Keep protective locks until settlement.

Deduplicate availability locks without dropping slot-specific identity checks.
A missing row cannot be treated as protected by a nonexistent row lock. Missing
Application/availability dependencies refuse admission; first framework-head
creation is serialized by the existing scope row and protected by uniqueness.

If the hint changed, exit without issuing authority. A host may restart once in
a new bounded transaction using a fresh hint, then return a typed conflict. Do
not acquire newly discovered earlier-order locks after locking the framework
head. Callbacks, remote work and framework hooks do not run during activation.

The initial private clock policy deliberately preserves existing conservative
serialization. It is not a throughput claim or a decision about standalone
Payload read isolation. The later transaction-owner capability still owns
that policy and the full mutation/finalization lock hierarchy.

## Recovery And Failure Semantics

Application A changing to B invalidates A's framework binding, even if B uses
compatible tables. The initial two-owner activation has an explicit serving
gap until an exact B binding activates. Existing Application execution remains
under its own owner; framework admission must report the mismatch.

An exact repeated activation request returns its authenticated committed
receipt if history proves it, including after a lost COMMIT response. Report
separately whether that receipt is still the selected head and currently
admissible. Historical success must not silently reactivate an old candidate.
The same request identity with different canonical input is a conflict.

After an interrupted switch, a trusted recovery operation inspects that exact
request and candidate in a fresh transaction. If it committed, return the
receipt/current-admission distinction. If it did not commit, retry only while
the original Application and expected prior framework head still match and all
evidence remains ready. A third Application head, changed scope authority or
changed availability requires a newly prepared candidate/request. An unresolved
database outcome remains uncertain; do not infer rollback from a transport error.

Re-selecting an earlier Application revision creates a different activation
identity. Supported rollback is a newly validated binding activation against
that current identity, not reuse by revision ID. Recovery performs no DDL,
Application-head write, partial activation, stale serving or automatic schema
rollback.

Distinguish invalid input, stored corruption, missing dependency, stale scope,
stale Application, concurrent framework head, changed/unavailable installation,
unsupported profile, placement mismatch, expired/foreign transaction authority,
resource failure and uncertain settlement. Return bounded identity-based
diagnostics without connection strings or canonical payload dumps. Retry policy
belongs to the operation/host; corruption and unsupported profiles are not
transient failures.

## Synthetic Core Selection Decision

Choose a **non-serving test-only selection capability**, not a new system slot,
for the later synthetic relational transaction proof. The trusted fixture mints
it only after authenticating scope, target, generation/fence/epoch, exact
installation/readiness and locked ready availability inside the accepting
transaction. It has distinct runtime issuance and cannot pass the binding-set
admission check, escape settlement or resolve through a production host.

Include this selection seam and its refusal tests in the binding capability so
the subsequent transaction/store proof has a defined consumer. It authorizes no
store or finalization implementation by itself. Physical-lane binding tests use
owner-correct fixture artifacts and explicitly test-only profiles; those tests
prove binding mechanics, not Payload/Medusa conformance or production readiness.

## Completion Evidence And Execution

The approved migration prerequisite adds `synthetic-medusa-fresh` alongside
`synthetic-system-fresh`. Fresh plans retain their artifact owner in collision
coordinates and authenticate the matching admission profile on restoration.
Both profiles require synthetic provenance; source-snapshot artifacts still
refuse planning. Additive migration remains system-only. Existing system
installations cannot be relabeled as commerce.

The Application-owned entry point is `src/applicationBindingProjection.ts`.
`src/frameworkSchema/binding/host.ts` composes preparation, CAS activation,
current admission and exact-request recovery through the existing located
read-committed runner. Migration `0082_data_binding_selection` adds the separate
target-local ledger; `0083_synthetic_medusa_admission` extends only the private
fresh admission constraint. No package-root or public subpath is added.

The only physical serving slot currently exercised is commerce with explicit
test-only profiles and owner-correct synthetic artifacts. Populated Payload
content/lifecycle slots refuse admission until their own profile issuers exist.
Consequently, simultaneous multi-physical-lane admission is a later Payload
gate, not evidence supplied by this implementation. Canonical lane traversal is
retained, and no unsupported owner is substituted to manufacture that proof.
Native scope-isolation evidence proves another scope-clock operation can finish
on the same database while binding admission holds its own scope lock; it does
not claim concurrent same-scope operations or framework mutation throughput.

Focused commands are `test:framework-bindings:pglite` and
`test:framework-bindings:postgres` in `@flarex/persistence-postgres`, backed by
the existing test-lane manifest. Shared deterministic scenarios reuse one
Application fixture per driver. The native lane adds observed lock barriers,
real forwarded-COMMIT acknowledgement loss, and separate crashing/recovery OS
processes which rebuild Application, target and profile authorities from stored
evidence. Neither runtime tokens nor an already constructed host cross the
process boundary.

Binding installation reads explicitly apply the existing bounded immutable-graph
policy even for fresh installations. At most eight linked availability-history
nodes are admitted; a ninth returns the installation owner's non-transient
reference refusal. Tests cover cold admission at the limit, refusal beyond it,
and historical receipt recovery with current admission refused. Ordinary
migration readers retain their existing policy. Existing binding candidates
must already contain every normalized lane reference; repeated preparation
refuses missing sidecars as corruption and never repairs them implicitly.

| Lane | Required proof |
| --- | --- |
| Pure contracts | Strict canonical decoding, exact identity, slot/owner mismatch, unknown profile, missing residual coverage, limits and digest-cycle avoidance; copied/forged/expired authority rejected. |
| PGlite | Prepare/activate/admit/replay; optional-lane absence; atomic all-slot rollback; scope and placement refusal; corrupt/missing evidence; changed Application/availability; historical receipt versus current selection; cold restoration; test-only selection isolation. |
| Ordinary-role PostgreSQL | Additive metadata migration/constraints; competing first and replacement activations; Application switch versus binding acceptance; availability withdrawal versus acceptance with locks held; scope-fence races; independent scope-clock progress; lost COMMIT and process-restart recovery. Multi-physical-lane lock-order acceptance remains with the gated Payload profile. |
| Application regression | Both admitted readiness variants retain exact schema/head evidence; ordinary Application activation and relevant document/OCC/native-relation/commit behavior remain unchanged. |
| Cost and lifecycle | Share fixture setup only within its proven isolation/lifetime; reuse fully authenticated immutable graph nodes only inside one owned read pass; lock and re-read mutable heads on every accepting transaction. Record focused SQL/phase cost and assert bounded restoration. |

Use shared scenario definitions for deterministic PGlite/native behavior and
native-only tests for actual lock/driver/process semantics. Register one focused
binding lane in the existing manifest-driven test runner, with bounded workers;
do not repeatedly rerun the entire coordinator matrix or initialize a full
database for every pure refusal case. Native race tests use observed barriers,
not long sleeps. Fresh-process tests retain actual process isolation.

Implementation completion requires the focused lanes, affected Application
regressions, package typecheck, core/diff lint, both standing reviewers and the
exact staged diff gate. Keep timing and reviewer receipts in the task/commit
report, not this roadmap. A skipped native lane cannot close native acceptance.

Execute the new frames, Application projection composition, locked availability
read, additive binding metadata/repositories, activation/admission/recovery and
test-only selection as one bounded private implementation. Then advance to the
transaction-owner and commit-owner capabilities, the synthetic/Application
proof, Payload scalar and relation profiles, and Medusa Currency in that order.
No additional document-only checkpoint is needed within this capability unless
new evidence changes a material ownership or compatibility boundary.
