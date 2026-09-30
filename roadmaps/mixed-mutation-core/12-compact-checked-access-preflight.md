# Compact checked database access

Status: **proposed; private callback contract decision and implementation
approval pending.** This preflight proposes one connected persistence-owner
correction for the existing private graphs. No runtime, schema or protection
cutover is delivered by this document. The
[accepted prepared-execution rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
and [11 checked-boundary contract](./11-attempt-admission-preflight.md) remain
current. “Compact” here means narrower transport and fewer dispatches for the
same fresh proof, not a prepared immutable session or a cached DB admission.

## Connected outcome and limits

Reduce the work of each actual finite-root database access and aggregate seal
by narrowing the checked session projection, separating the unused callback
facet observation from execution-eligibility consumers, and consolidating
full selected source/Application/readiness reads through their existing owners.
Deliver those changes together with the real Product, selected Payload and
finite workflow consumers, cleanup and a comparable measurement series.
Retain ordered authority locks, post-lock database time, exact source selection,
current mutable readiness, live physical facts and the full protected-epoch
tail guard. Publication, reload, acquisition and recovery retain their own
fresh authentication and eligibility obligations.

This slice adds no protected table, immutable-field trigger, migration,
durable-data reset, cheaper catalog attestation, public framework operation,
hosted activation or Worker reuse. It changes neither the tentative local
revocation contract nor snapshot/pending evaluation, dependency capture,
one settlement authority, budgets, failure latch, cancellation or uncertain
COMMIT recovery. No SQL transaction spans native callbacks or foreign input
capture. Ordinary standalone and durable-operation callers retain their
current proof unless explicitly migrated to an equivalent owned reader.

The [11 measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/attempt-local-admission/README.md)
identify the next cost owner: Product update retains **492 SQL dispatches in
16 checked intervals**, and workflow run **650 in 22**. The same four graphs
have warm outer p50 **857.9 / 1,000.2 / 1,782.8 / 286.5 ms** for Product,
Product plus Payload, mixed workflow and standalone workflow. The mixed
100 / 200 / 500 ms proposals remain unmet. These counts identify repeated
SQL owners; they do not attribute CPU, hash/decode cost or lock wait, or
predict the gain from a proposed query shape.

A pristine checked kernel normally performs seven SELECTs; removing its unused
facet observation saves one of those. That count excludes BEGIN/COMMIT,
source/readiness, document work and final epoch attestation. The full phase
counts above include the actual graph work. Do not equate them with kernel-only
cost or promise one statement per interval. This is the next connected
reduction, not a guarantee of reaching the mixed latency proposals.

## Checked kernel contract and correction

[transactionSessionActivation](../../packages/persistence-postgres/src/transactionSessionActivation.ts)
owns `loadLockedRunningAttempt`: scope clock, session, snapshot lease,
journal root, execution claim, then database time after locking. It observes
the attempt facet conditionally after those checks. Preserve that acquisition
order, lock strengths and refusal order; an all-owner locking CTE or parallel
transaction statements are not a shortcut.

The checked session transport needs `sessionId`, `attemptFence`,
`storageGeneration`, `storageGenerationFence`, `authorizationRevocationEpoch`,
`authorizationGrantExpiresAt`, `hardExpiresAt`, `createdAt`, `updatedAt`,
`protocolVersion`, `lifecycle`, `schemaVersionId` and `requestKey`, with
`scopeUuid` retained if its correlation is part of the owner contract. Keep
all scalar checks and anchor construction. Do not fetch unused argument/grant
JSON, canonical bodies, body digests, function/principal/access-policy pins
merely because the shared row type currently includes them. Define the narrow
checked record at this owner; full reload/authentication readers remain full.

The current read/seal kernel checks session fences, generation, revocation and
expiries, request key, schema pin and the named lifecycle/lease/journal/claim
facts. It does **not** authenticate/hash argument or grant
bodies, despite fetching them. Activation replay's `sessionEvidenceMatches`,
the [stored evidence loader](../../packages/persistence-postgres/src/storedAttemptEvidence.ts)
and executor [commit authority verification](../../packages/executor/src/storedAttemptAuthentication/commitAuthorityVerification.ts)
own separate body validation. [Point publication](../../packages/persistence-postgres/src/pointCommitTransaction.ts)
`lockPointCommitSession` checks scalar pins and body lengths after that
authentication; this alone does not prove refusal of a same-length body edit
that preserves its stored digest after authentication. This is a static proof
limitation requiring targeted owner tracing and a witness, not a demonstrated
incident or permission to weaken security. Narrowing unused transport does not
fix this limitation, remove existing body-authentication checks or establish
new body protection.
Preserve current authentication tests; any correction to that publication
contract needs its responsible owner and an explicit focused decision.

**Private callback decision:** remove `attemptFacet` from the checked callback
context and omit its otherwise-unused observation there. Current checked
callback consumers use clock, anchor, execution pin, journal and claim, not
that facet. This removes a diagnostic query failure opportunity but does not
change a current scalar authorization verdict. Keep facet observation for
`LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1`, disposition/replacement,
crash redispatch and execution-claim acquisition, where hidden receipt,
point, range, relation-dependency or write-event children must still cause
`nonPristine` refusal. Reuse one structural validator; do not create a fallback
kernel. Approval must explicitly accept this callback contract change.

## Full selected evidence and query candidates

[sourceAdmission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts)
orchestrates the binding repository, Application binding projection and
logical readiness owners. [Participant admission](../../packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts)
still checks each source's pinned head and contract. Existing evidence sharing
lasts only for the exact checked transaction and is revoked at scope exit.

| Existing owner and candidate | Proof retained and feasibility gate |
| --- | --- |
| Checked kernel: narrow session SELECT and omit unused callback facet SQL. | Preserve every consumed scalar, expiry/revocation comparison and ordered lock; reload/acquisition/recovery still observe pristine eligibility. |
| [Binding repository](../../packages/persistence-postgres/src/frameworkSchema/binding/repository.ts): head plus selected activation; candidate plus complete physical-lane sidecars. | Return full canonical bytes/length/digest and correlation fields. Authenticate head, activation, candidate and exact sidecar membership through current decoders. Preserve share locking and strong-reference endpoint correlation. |
| [Application active-head reader](../../packages/persistence-postgres/src/applicationActiveHeadRead.ts) and [binding projection](../../packages/persistence-postgres/src/applicationBindingProjection.ts): coherent head, selected activation and revision-schema evidence. | Preserve full frame hashing/canonical comparison, readiness/version/policy correlation and schema selection. Reuse the nominal checked-active evidence under the accepting callback only. |
| [Logical readiness](../../packages/persistence-postgres/src/logicalStorageReadiness.ts), index/unique/search owners: consolidate selected state/frontier projections where equivalent. | Preserve exact required rows, lifecycle/authority/maintenance decoding, table and clock frontiers, snapshot coverage, live `pg_index` identity/operator checks and the three-observation READ COMMITTED refresh bound. |

These are concrete query-reduction candidates, not a promised dispatch total.
Inventory before/after dispatches per owner as an implementation gate, including
retained locks, full decodes and final epoch work. Check SQL feasibility before
choosing each combined shape. Retain explicit
ordered acquisition when a join cannot prove equivalent lock behavior; batch
only bounded same-owner reads after the required locks. Avoid Cartesian child
inflation and unbounded aggregate transport. Keep exact duplicate/missing/extra
row checks and first-failure order in existing typed decoders; do not turn
corruption or resource failure into ordinary absence. A combined statement's
snapshot differs from successive READ COMMITTED statements, so prove the
intended observation and coverage-race behavior. Do not move shared validation
into adapters, introduce a universal admission registry or add a second codec.

## Metadata field and writer boundary

The following inventory determines what full reads retain. It does not approve
a selective watched-column proof or certify other metadata by stored digest.

| Evidence | Authenticated fields / selection | Current writers and future protection gap |
| --- | --- | --- |
| Binding candidate and physical lanes | Candidate scope/generation/digest, canonical bytes/length and complete frame; exact lane membership, slot, installation/receipt/readiness digests, availability sequence/status/history digest and FK storage identities. | Binding repository inserts candidate and complete sidecars together. Protection must cover changed bytes with unchanged digest, missing/extra lanes and OLD/NEW selection-key movement, not only existing-row updates. |
| Binding head and activation | Scope/generation/sequence, candidate/activation/request identities, canonical bytes/length/digest, activation time and complete strong-reference projection. | Binding repository inserts activation and upserts head. Current selection stays fresh; digest-only payload reuse needs authenticated same-transaction tamper protection. |
| Application head and activation | Scope/sequence/revision, readiness discriminator/digest, relation set/count, policy/ownership commitments, frame bytes/digest; activation previous sequence/request digest/time. | `applicationActivation.ts` inserts activation and inserts/updates head. Ten-table preparation does not cover these tables or unversioned relation-bearing Application descendants. |
| Physical definition lifecycle | Scope/deployment/kind/ID, lifecycle/transition fence, spec/request codec and digests, generation/fence/epoch, finite ordered timestamps. Missing means implicit active. | `physicalDefinitionLifecycle.ts` inserts, transitions and retires. Inserting a selected formerly-absent row changes the predicate; a root covering only existing rows misses it. |
| Index build | Scope/definition, generation/fence/epoch, start/lifecycle/attempt fence, cursor codec/cursor, first-readable/covered-through, maintenance activation/bytes/digest, finite ordered timestamps. | Reconciliation inserts/redeclares; `intrinsicCreationTimeIndexBuildV1.ts` transitions; `indexMaintenance.ts` opens/closes maintenance; materialization normalizes/advances coverage and resets developer/intrinsic validation; `commitPublication/strongReferenceValidation.ts` advances coverage. |
| Unique build | Scope/definition, generation/fence/epoch, start/lifecycle/coverage/cursor/attempt fence, maintenance activation/bytes/digest and ordered timestamps. | `appUniqueConstraintSetBuildV1.ts` opens/closes maintenance, deletes stale workspaces, transitions, advances publication coverage and declares/redeclares. |
| Search build and physical index | Scope UUID/table/index selection, source digest/ready lifecycle and coverage against clock/table frontier; live named GIN/table identity, validity/readiness, predicate absence, key count/order, columns/method/operator classes. | `logicalSearchBuild.ts` inserts missing ready state for empty tables; `logicalDocuments/searchEntries.ts` advances coverage. Privileged CREATE/DROP/ALTER/rename/replacement changes physical facts outside the protected epoch. |

Ordinary publication updates build coverage. A coarse additional epoch trigger
would invalidate prepared roots on business writes. Partial protection would
need an explicit disposition for every currently decoded field, complete
INSERT/UPDATE/DELETE/TRUNCATE and OLD/NEW predicate entry/exit coverage, raw
DML/fixture/restore/repair/DDL inventory and runtime-grant proof. Named canonical
writers do not establish immutability: the restricted test runtime has ordinary
table DML grants. Keep these full fresh checks in this slice.

Initial source preparation also reads control schema artifacts, table/source
bindings, index/unique/relation definitions, unique closure, stable identities,
physical requirements and framework installation/availability evidence.
Their schema/catalog and framework repositories own writes. Control and target
databases have no joint atomic generation. Retain their current owned entry,
acceptance and terminal checks; a future control cache needs independent
writer proof and a quarantine-first, resume-last barrier.

## Protected epoch and connection decision

[preparedMetadataEpoch](../../packages/persistence-postgres/src/preparedMetadataEpoch.ts)
and [migration 0119](../../packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql)
protect exactly the ten legacy Application candidate, analysis, revision,
publication, function, task-catalog, task-definition, revision-schema,
readiness and readiness-function tables. BEFORE STATEMENT triggers invalidate
INSERT/UPDATE/DELETE/TRUNCATE, including zero-row statements. Preparation and
the final `FOR SHARE NOWAIT` helper authenticate login/grants, installation
identity, exact function bodies, covered tables and triggers. Preserve that
full catalog attestation and fail closed on epoch contention or change.

The preparation token binds the database object and login/database-name/schema
OID/incarnation, not an exact checked-out backend. The
[physical-session owner](../../packages/persistence-postgres/src/physicalSession/postgres.ts)
has per-`PoolClient` identity for quarantine/recovery exclusion; it is not a
catalog-attestation capability. A pool switch or reconnect cannot inherit an
earlier proof. The cache-disabled Hyperdrive request lifecycle also does not
establish exact origin-backend reuse. No protected-metadata maintenance barrier
currently enforces the policy's privileged quiescence requirement in these
owners. A smaller epoch read therefore requires a new approved connection and
privileged-operation contract: stop admissions, drain accepting work, perform
repair, advance installation identity/generation, destroy stale connection
proofs, reattest and resume. A TTL or host flag is insufficient.

Retain the current threat contract and regression witnesses. In particular,
`applicationPreparationCatalogIntegrity.test.ts` changes bytes/JSON/closure
with unchanged digest/head, and `logicalSearchBuildBatchScenario.ts` renames or
replaces the same-name GIN with wrong columns/operator classes while source and
coverage stay unchanged. Removing their immediate fresh refusal would require
an accepted-design amendment. Wider protection and cheap attestation are
deferred alternatives, not extra implementation phases of this slice.

## Cutover, validation and completion

The private callback type loses unused facet evidence; checked session transport
narrows, and existing owners may gain combined full-evidence readers. Migrate
`sessionJournalStore.ts` checked callbacks and borrowed facades together with
their connected executor/backend finite-root callers. Medusa and Payload
lifecycle semantics stay with their framework owners. Required full reload,
acquisition, recovery, authentication and standalone readers remain supported
current paths, with no retirement gate. No journal/session format, durable row,
identity or existing-data migration is required. Remove displaced repeated
wrappers/readers and context fields in the same slice; any temporarily retained
displaced path needs a named unmigrated consumer and removal gate. Do not leave
parallel compact/full kernels or diagnostic scaffolding.

Completion requires one connected implementation and its owner/consumer proofs:

- PGlite and ordinary-role PostgreSQL: wrong scope/fence/profile, revocation,
  expiry after a blocked lock, stale/missing lease or claim, cancellation,
  journal corruption and facet-hidden-child refusal for reload/acquisition.
  Demonstrate the callback's approved facet-query distinction.
- Real PostgreSQL distinct connections: explicit lock order and post-lock time;
  combined-query snapshots; changed source/Application selection; byte/digest,
  JSON and sidecar corruption; missing/extra/predicate members; concurrent build
  coverage/table-frontier progress and persistent misses; physical index
  replacement; final protected epoch change/contention and privilege bypass.
  Keep authentication/body-validation witnesses; trace the stated publication
  proof limitation before altering that owner's security contract.
- Existing real Product, selected Payload and finite workflow success, late
  failure, conflict/retry, events, replay, cancellation and uncertain-outcome
  witnesses, plus standalone regression. Preserve both driver results distinctly.
- Quiet traced smoke plus full untraced series on the same four graphs, with
  unchanged workload/recovery/deadline/exclusion policy. Compare SQL dispatches,
  checked intervals and warm/cold outer distributions; attribute changed SQL
  to the proposed owners. Add focused phase decode/hash/await/wait evidence only
  to resolve an implementation decision, and mark unavailable lock wait/CPU
  attribution explicitly. Codec/CPU timings are optional at existing owners;
  driver awaited time includes transport, server work and waits, not pure server
  execution. No inference of native ORM parity, hosted performance
  or production capacity follows from this local series.
- Affected typechecks/builds/source guards, `pnpm lint:core`, `pnpm lint:diff`,
  both standing reviewers on the stable owned diff, required review reruns,
  final staged lint, cleanup and one scoped commit after successful validation.

Before runtime work, agree the bounded full-check consolidation and the private
callback facet decision. If query feasibility changes authority, locking,
refusal order or publication/body verification materially, return to that
specific contract decision rather than broadening this optimizer package.
