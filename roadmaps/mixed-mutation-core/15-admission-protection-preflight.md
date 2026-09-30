# Admission and protection replacement

Status: **draft next preflight; planning only, runtime scope unapproved.** This
is the first proposed package in the [execution redesign](./14-execution-redesign-roadmap.md).
Resolve the inventory, threat, attestation, maintenance and budget decisions
below with the owner before dependent implementation. Existing standing approvals
for other goals do not approve these new authority contracts.

## Connected outcome and reason

Evaluate replacing repeated structural authentication with trustworthy bounded
preparation where complete writer protection permits it, and compact fresh DB acceptance
with a mandatory accepting-transaction tail guard. Cut over the checked kernel,
metadata owners and actual Application/Product/Payload/workflow consumers
together. Redesign their contracts if needed; a cheaper isolated SQL helper is
insufficient. The observed graphs still issue 988 / 1,252 / 1,979 / 354 SQL
dispatches and 41 / 52 / 78 / 6 transactions. [Slice 13](./13-dependency-validation-preflight.md)
establishes source-complete read readiness, not wider immutable protection.

The [accepted prepared-execution design](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
currently permits only a narrow protected legacy Application projection.
Extending it changes integrity authority and requires an explicit accepted-design
decision. Preparation never substitutes for fresh live admission. Protected
preparation is the recommended hypothesis, not a requirement to build a broad
certification subsystem regardless of cost. Compare it with retaining complete
authentication in a cheaper bounded accepting plan and replacing duplicated
representations at existing owners. Choose from attributable cost and an
enforceable threat contract; do not default to a generic certificate/cache service.

## Current owners and proof

| Existing owner | Proposed responsibility |
| --- | --- |
| [Checked activation](../../packages/persistence-postgres/src/transactionSessionActivation.ts) and [attempt kernel](../../packages/persistence-postgres/src/transactionSessionAttemptKernel.ts) | One fresh exact-root acceptance at every actual DB boundary; compact issued context and ordered final guard, revoked on exit |
| [Protected metadata epoch](../../packages/persistence-postgres/src/preparedMetadataEpoch.ts) | Replace or extend the currently ten-table protection/installation proof only after complete coverage and attestation decisions |
| [Application projection](../../packages/persistence-postgres/src/applicationBindingProjection.ts) and [binding repository](../../packages/persistence-postgres/src/frameworkSchema/binding/repository.ts) | Canonical bodies, sidecars, heads, lane membership and issued immutable preparation |
| [Source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts), [readiness](../../packages/persistence-postgres/src/logicalStorageReadiness.ts), [binding verification](../../packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts) | Separate authenticated structure from fresh required lifecycle, frontier, coverage and per-source head/authority checks |
| [Journal](../../packages/persistence-postgres/src/sessionJournalStore.ts) and [publication](../../packages/persistence-postgres/src/pointCommitTransaction.ts) | Entry, read, aggregate seal, recovery and settlement consume the same owned protection contract without cached live verdicts |
| [Product attempt](../../packages/medusa-adapter/src/product-attempt.ts), [Payload adapter](../../packages/payload-adapter/src/adapter.ts), [workflow runtime](../../packages/medusa-adapter/src/workflow-runtime.ts) | Translate existing native operations through issued capabilities; no adapter admission, SQL or protection policy |

Current epoch protection authenticates the restricted login and ten legacy
Application tables; it does not cover all relation-bearing Application,
framework or control descendants. Runtime DML grants remain relevant. The
[catalog-integrity tests](../../packages/persistence-postgres/test/applicationPreparationCatalogIntegrity.test.ts)
alter bodies/closure while digests stay fixed. The
[search build scenario](../../packages/persistence-postgres/test/logicalSearchBuildBatchScenario.ts)
replaces a same-name GIN with wrong columns/operator classes. Preserve these
refusals under the existing contract until their complete approved replacement.

## Proposed contract and unresolved decisions

1. Inventory every authenticated structural table, field, sidecar and closure
   predicate: candidate/source/manifests, Application/relation projections,
   ordered/unique/search specifications, complete lane and unique membership.
   Inventory canonical writers, direct SQL, fixtures, migration, restore,
   repair and privileged DDL. Cover INSERT/UPDATE/DELETE/TRUNCATE, relevant
   zero-row statements, OLD/NEW key movement, missing/extra members and every
   authenticated field. Ten-table coverage is not a complete inventory.
2. Decide which immutable fields receive same-transaction invalidation and
   which evidence stays freshly checked. Separate ordinary coverage/frontier
   advancement from structural change so routine publication does not destroy
   valid preparation or authorize stale readiness. Specify installation and
   existing-data attestation; names, readonly objects and stable digests prove
   neither writer confinement nor absence of extra members.
3. Issue detached bounded preparation with exact database/installation, scope,
   source/revision and generation identities, canonical authentication and a
   real owned lifetime. Specify revocation, disposal and reprepare behavior;
   no module-global cache or caller-created evidence. Fresh binding/pins and
   full/selected readiness remain distinct accepting contracts.
4. Select an attestation contract: **backend-bound connection proof** with exact
   backend/login identity and pool/reconnect invalidation, or **installation
   certificate** with enforced maintenance generation plus fresh installation
   and login checks. Compare their cost and deployment feasibility before
   choosing. Database object identity, `PoolClient` quarantine identity, TTL or
   cache-disabled Hyperdrive alone proves neither.
5. Implement any required privileged-maintenance barrier at its true owner:
   stop admission, drain/quarantine active execution, repair, change generation
   or installation, invalidate stale proof, reattest, then resume. Current
   quiescence requirements are not this implemented mechanism. Define crash,
   partial repair, restore and resume refusal. No privileged repair silently
   retains old preparation.
6. Specify separate control/target preparation and acceptance. They have no
   atomic joint generation. Retain their current checks unless an explicit
   coordinated contract is accepted; do not infer coordination from a digest.
7. Agree the accepting demand shape with draft 16 before fixing the kernel API:
   admission should accept a bounded trusted demand round, not cement one SQL
   boundary per helper. Keep fresh scope/placement/storage generation/fence, binding/head pins,
   revocation, session/lease/claim/journal state, expiry and post-lock DB time
   before data at each actual DB boundary. Keep exact-running checks on seal,
   publication and recovery. End each accepting transaction with its ordered
   nonblocking protection guard; contention or change rejects that transaction.
8. Decide physical DDL/catalog coverage separately, including table/index
   identity, validity/readiness, predicate absence, key order/method/columns and
   operator classes. Fresh physical checks remain until a complete approved
   replacement includes tamper-witness disposition. This draft does not change
   the privileged or physical threat contract implicitly.

Challenge retaining repeated body/hash/catalog work forever versus protected
preparation with explicit writers and maintenance. Prefer the latter only where
its complete enforcement can be proved. Also challenge a broad global epoch
that invalidates unrelated preparation on every ordinary publish; choose scope
and invalidation keys from actual predicates and lock order. Reject digest-only
reuse, stale admission caching and adapters compensating for shared-owner gaps.

## Breaks, cutover and cost gate

Replace preparation tokens, checked-context and invalidation contracts as
needed; migrate kernel, metadata repositories, source admission, journal and
publication plus their real consumers together. Retain independent standalone
and durable-operation profiles for named callers, not as fallback engines.
Before runtime, list exact exports/callers, outstanding attempts, retained
outcomes, installed epochs/triggers/roles and environments. Decide migration,
drain or isolated reprovision explicitly; preserve named durable data and never
reinterpret old proof bytes. Delete displaced authentication/caching/trigger
paths, obsolete exports and fixtures after the single cutover, with equivalent
behavioral coverage. Temporary retention requires a named caller and removal gate.

Use the [roadmap budget table](./14-execution-redesign-roadmap.md#budget-and-attribution-gate).
Before implementation, agree numeric per-graph SQL, transactions and sequential
round trips from a complete operation graph; fix structural amortization,
fresh live checks/data/seal costs, invalidation rates and batch/byte formulas.
The targets remain Product 100/200, Product + Payload 200/400, mixed 500/1,000 ms
p50/p95; standalone median below 400 ms and regression strictly below 10%.
Exact SQL/transaction limits are unresolved, not promised. Account for server
statements inside a combined call and for reprepare/contention/retry work.

## Validation and exit

Prove writer coverage and field/predicate invalidation in PGlite and ordinary-role
Postgres, including direct DML, key movement, zero-row cases, missing/extra members,
TRUNCATE, altered bytes/sidecars, login privilege drift, connection reuse/reconnect,
epoch contention, maintenance races and stale proof after restore. Use distinct
connections for locks, fresh post-wait time and drain/refusal. Prove full/selected
readiness, source authority and physical replacement refusal retain their contract.

Run real Product, Payload Local API and finite workflow success, pending/OCC,
late failure, rollback-only, retry, events, replay, cancellation and uncertain
COMMIT recovery plus standalone regression. Apply Effect patterns/error guidance
to runtime lifetime and failure changes. Run affected types/builds/source/Worker
guards and lint, both project reviewers on the final owned diff, substantive-fix
re-review, cleanup, staged lint and one scoped commit after successful validation.

Exit requires the accepted enforceable admission contract, including complete
protection/attestation/maintenance where protected reuse is selected, plus the
connected consumer cutover and removal, preserved correctness and measured
graph-derived limits. Functional delivery alone does not meet latency acceptance;
compare matched traced structure and untraced distributions retaining all samples
and outliers. Advance to the next agreed connected slice when correctness,
cleanup and this slice's agreed stage cost budget pass, with the remaining gap
quantified and its cost owner assigned. If the stage budget fails, reconcile it
within this slice or explain a changed contract before continuing. Final latency
goals govern whole-successor acceptance; 15 need not satisfy them all before 16.
Record unmet targets and their remaining owner. Developer APIs, new operations,
hosted activation and advanced evolution remain outside this slice.
