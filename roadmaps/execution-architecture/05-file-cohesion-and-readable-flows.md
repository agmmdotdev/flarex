# File Cohesion And Readable Flows

## Status And Scope

**Owner-authorized organization goal active.** Journal consumer contracts,
concrete journal owners and schema declarations are separated. The journal,
schema and test cutover follows these concrete owners. Point publication source,
API and test organization is complete with connected consumer verification;
activation/readiness and session organization remain open.
The owner requested continued organization, readable end-to-end flows, sensible
folder/file boundaries, file splitting, clean APIs and corresponding tests.
The [source/test layout](04-source-and-test-ownership.md) and admitted local
[construction cutover](03-consumer-construction-and-domain-apis.md) are complete.
Performance optimization remains paused until the organization goal closes.

This plan organizes existing admitted behavior. It does not start composed
Application queries, hosted activation, new framework support, schema evolution,
durable-data deletion or a new transaction contract. Necessary private import,
type and construction breaks are authorized with complete caller migration.

## Remaining Structural Problem

Domain folders expose the outer owners. The journal now has distinct attempt,
operation, evidence, persistence and seal owners; database declarations follow
their actual dependency graph. Point publication has concrete settlement owners
and a separate consumer/construction boundary. Application activation/readiness and session
activation also contain substantial lifecycle and protocol work. Audit their
actual ownership rather than splitting at an arbitrary line count.

| Existing owner | Responsibilities to separate or verify |
| --- | --- |
| Database schema | Shared database primitives; control catalogs; scope/commit identity; execution journals; document/index/relation state; installation; Application metadata; tasks; sync and retained legacy tables. |
| Session journal | Consumer contracts; authentic attempt and capability state; point/index/relation evaluation; framework borrowing; finite capture and freeze; durable journal persistence; seal and recovery projections. |
| Point publication | Consumer commands/outcomes; authentic frozen-work handling; fresh authority and conflict validation; mutation/history/fact publication; retry replacement and uncertain-outcome recovery. |
| Application serving | Construction; active selection and admission; readiness/projection integrity; activation; relation-aware serving and explicit retained profiles. |
| Frameworks and adapters | Native lifecycle/semantics; trusted construction; direct operations; borrowed participant completion; finite workflow orchestration; explicit test-only inspection/fault profiles. |
| Tests and fixtures | Driver/resource construction; shared behavioral scenarios; owner-specific fault witnesses; connected consumers; measurement setup and reports. |

Before changing an owner, inspect its private state, exported contracts, actual
callers and decisive tests. A moved helper does not acquire new authority.

## Selected Direction

Use cohesive modules under the existing domain folders. The entry module should
make the actual operation and resource lifetime easy to follow. Move substantial
stages to named local owners when their responsibility and dependencies are clear;
keep short ordered composition visible at the entry point. Avoid a generic engine,
service locator, one-file folders or a web of forwarding barrels.

Pure contracts and error families should not load SQL construction, crypto or
driver initialization merely because a consumer imports a type or capability.
Separate runtime contracts from implementation where a real dependency/runtime
boundary requires it. Preserve exact capability identity and private registry
ownership; splitting must not create competing registries or settlement paths.

Table definitions remain typed Drizzle objects with one authoritative definition
per physical table. Organize by the real database/domain dependency graph and
retain exact names, columns, constraints, migration order and schema enumeration.
Do not replace typed definitions with hardcoded SQL or duplicate table objects.
Cross-domain foreign keys must remain explicit and cycle-safe.

The read-through guide should answer: which entry point receives the request,
which owner prepares and admits it, what readiness it requires, where native
behavior runs, who owns pending state, who settles, and how failure/closure or
uncertainty is handled. Keep direct, borrowed, finite atomic and durable task
lifecycles distinct.

Tests follow those owners. Split a large fixture or scenario only when setup,
driver lifecycle, behavioral cases or fault ownership has a distinct purpose.
Preserve one shared scenario for paired drivers and existing discovery/provenance
guards. Test support must not implement production orchestration.

## Connected Delivery And Removal

### Selected Journal Consumer Boundary

The journal boundary separates its process-local consumer surface
from database composition. It preserves existing execution, admission, settlement,
canonical formats, table definitions and durable rows. The current store mixes
operation contracts, opaque handles, errors, query-port issuance, per-store
evaluation and SQL persistence. Its finite entry/freeze helpers also combine
registry identity with accepting transactions and closed-root construction.
Executor value imports for errors and frozen projections consequently load the
concrete store and can reach Node crypto before a Worker request runs.

The replacement stays in the existing execution and storage owners:

| Module | Responsibility and dependency limit |
| --- | --- |
| journal/contracts.ts | Operation/outcome, borrowed-participant and store-port contracts; exact opaque handles. Lower owner references are type-only. Issuer symbols are absent from the consumer export. |
| journal/errors.ts | Existing journal error classes and precise error unions. External error types are type-only; existing external error values come from their owner's error leaf. |
| journal/state.ts | Trusted attempt, pinned table/index/relation and resolved target types. No SQL construction or registries. |
| journal/indexQueryPort.ts | One query-port issuer registry, authenticated construction and internal lookup. Invalid composition retains its current unregistered-handle behavior. |
| journal/finiteEntry.ts | One private prepared/confirmed registry, authentic issuance, status/capture transitions, once-only abandonment/release, COMMIT-confirmed installation and detached reads. No mutable-map export. |
| journal/finiteEntryActivation.ts | Existing control preparation, Application selection, candidate planning, continuation and replacement accepting transaction. |
| journal/finiteEntryPublication.ts | Original confirmed-session projection using the actual Drizzle table columns and existing byte/date/bigint/null encoding. |
| journal/frozenAttempt.ts | One private frozen registry, origin/owned lookup and borrowed or detached consumer projections. No root evaluator or metadata construction dependency. |
| journal/freezeClosedRoot.ts | Existing closed-root authentication, pin verification, canonical adoption, issuance and consumption through that same registry. |
| journal/api.ts | Explicit consumer export boundary for contracts, errors and read-only projections. Excludes constructors, issuer symbols, registry mutation and raw SQL capabilities. |
| sessionJournalStore.ts | Concrete resource/options assembly and ordered preparation, admission and dispatch into the journal owners. |

Move the original pinned-table/developer-index error classes to a storage-owned
error leaf. Move the original Application syscall-validator and logical
participant errors to their owning error leaves as well, then route error-only
consumers to them. Preserve each single class identity and exact failure payload;
do not define equivalent new classes or load construction through error exports.
The concrete implementations consume those same definitions. Executor journal
errors have their own leaf too: Worker RPC error imports must not load journal
construction and session activation through the executor implementation.

Finite registry operations replace direct map access with explicit issuance,
authenticated control retention, running capture and confirmed-attempt claims.
Tests inspect a read-only lifecycle projection and inject failures at the actual
accepting/source boundary. They must not receive a mutable registry/state handle
or gain another settlement path. The store retains its strong exact-claim map,
capacity reservation, evaluator and receipt accounting in this change: moving
those together requires the subsequent state/codec/evaluation decomposition.
A weak registry or generic state service is not a substitute.

Break and migrate all private consumer imports. The concrete store route becomes
construction-only; its consumer types/errors/projection reexports move to the
explicit journal API. Replace the old finite entry/freeze files after all value,
type, test, export, source inventory and documentation consumers migrate. No old
forwarding files, competing registry or compatibility path remains. No stored
journal codec, durable identity or named data needs conversion or deletion.

Preserve first-failure and cleanup order: profile refusal, optional authoritative
retirement observation, synchronous capacity reservation and cleanup acquisition,
tentative capture, acknowledged-COMMIT installation and once-only release.
Record a running capture before later planning SQL can fail. Abort/uncertainty
discards tentative values but retains the exact-claim tombstone; authoritative
retirement alone removes it. Freeze registers canonical closed-root ownership
and consumes the root in the existing order. Detached projections keep mutable
bytes separate while issued authority handles retain object identity.

The nearest proof is the existing journal capability/RPC in actual Workerd,
paired with finite-entry and frozen-attempt owner/consumer proofs in PGlite and
ordinary-role Postgres. Check the consumer runtime import/bundle graph: contracts,
errors and frozen projections must not pull in schema/SQL, driver construction,
root evaluation or Node crypto. A graph check alone does not prove a runtime;
execute the Worker witnesses too. Exact execution may expose separate publication
or activation imports; retain those gaps explicitly until their real owners are
organized. No polyfill, host compatibility expansion or guard bypass is selected.

Validate current finite provenance, capacity, cancellation/drainage, full Cause,
control identity, mixed entry ordering, delayed/uncertain acknowledgement,
detachment, replay origin, publication bytes and metadata ABA witnesses. Run
affected typechecks, package/boundary/source/discovery checks and lint, obtain
both reviews, remove displaced paths and commit the connected cutover. Update
the reading guide with the actual sequence and test ownership. This does not
claim native-relative performance acceptance.

### Concrete Journal Owners

The concrete store assembles receipt schemas/codecs, counters, input capture,
SQL persistence, point/index/relation execution, borrowed participant
orchestration, finite-root construction and seal projection/settlement through
their named owners under `journal/`. Target resolution and exact admission have
their concrete owner; ordered preparation/admission/dispatch stays visible at
the store entry. The [journal reading map](../../packages/persistence-postgres/src/execution/journal/README.md)
identifies each stage and its actual dependency direction.

The required dependency direction is input/codecs/accounting, then receipt
evidence and persistence, then operation execution and journal projection, then
participant/seal orchestration and store assembly. Participant preflight and
seal preparation both authenticate generated insertions through the same lower
journal projection owner. Relation-page and stored-range correlation belong
below their executors so receipt authentication does not create a cycle.

One per-store attempt owner retains all issued capabilities, admitted-operation
exclusion, finite roots, strong exact claims and capacity reservations. It offers
specific issuance, lookup, installation, consumption and retirement operations,
not mutable maps or a generic context carrying every port and callback. Finite
root state moves out of the concrete store only with its real capture/discard/
freeze owners. Preserve current finite relation refusal; this does not add a
profile. All canonical codecs, transaction boundaries, acknowledgement and
release rules remain exact. Migrate internal callers and remove the displaced
bodies together, with the same paired driver and connected consumer proofs.

The PGlite journal cases belong to point/index execution, admission,
receipt corruption, limits, seal transitions and transaction-lifetime owners
under `test/execution/journal/`. One fixture owns database construction, authentic
scope/installation setup and resource closure; shared evidence/value helpers
remain journal-specific test support. Each suite owns its fixture lifetime.
Preserve case bodies, fault boundaries and expected failures, and independently
compare test registration and executable case content during the move. Do not
replace behavioral witnesses with implementation-shaped helper tests.

Keep accepted-operation receipt policy and point/event/receipt/root sequencing
in their Effect owners. The inherited Promise helper combines canonicalization,
marker authenticity, receipt limits, row correlation and SQL; broad caller
handlers can classify an internal defect as a persistence failure. Reuse the
existing statement adapter for lazy foreign SQL, the protocol Effect
canonicalizer for outcomes and direct sequential composition for domain work.
Preserve the same transaction, statement/fault-hook order, public profile error
mapping and interruption masks. The exact kernel retains full Cause and owns
rollback; it does not require domain orchestration to become a Promise.

Stored-range transport conversion preserves the original candidate field and
branch evaluation order as well as its exception boundary. Consume row-ID
validation through Result without throwing to extract its value. Capture the
actual foreign row-to-candidate conversion once, then carry its typed result;
keep cardinality/ordinal admission, Schema validation and evidence correlation
in their original order. Finite indexed-read limit recovery uses its typed
error at the actual materialization/success boundary, preserving first limit,
pending-state publication and the existing abort/in-flight finalizers.

### Concrete Database Schema Decomposition

Replace the central declaration body with domain modules in `database/schema/`.
Keep `database/schema.ts` as the explicit aggregate used by database composition;
declaration modules and companion schemas import the actual declaration owners,
never that aggregate or the generator aggregate. The audited foreign-key graph
has no inter-table cycle. Keep self-references inside their declaration module
and preserve lazy foreign-key callbacks and declaration order.

| Declaration owners | Responsibility and lower dependencies |
| --- | --- |
| primitives | Existing Drizzle custom types, text checks and canonical-frame SQL helpers; no tables. |
| catalogIdentity, catalogIndexes, catalogUniqueConstraints, catalogRelations, catalogApplicationBindings, catalogLogicalReads, controlScopes | Deployment and catalog identity, then the respective definitions/bindings; logical read access remains below its source/table definitions. |
| scope, installation, commitHeaders, commitFacts | Scope clocks and observations; installation state; commit/idempotency/wakes; document and relation facts. Facts depend on commit headers and document revisions. |
| transactionSessions, transactionJournals | Sessions and leases, then journal claims, receipts, points, ranges, relation dependencies and writes. Keep the existing shared point-dependency CHECK helper with journal declarations. |
| documents, documentIndexes, relations | Authoritative row revisions/current rows, their index/search/unique projections, and physical edge/adjacency state. |
| relationReadiness, buildReadiness | Existing relation provenance/readiness and index/search/unique/candidate maintenance state. Preserve the semantic-readiness origin self-reference. |
| applicationRevisions, applicationLegacyPublications, applicationEffects | Current candidate/analysis/revision chain; retained publication/function/schema/readiness/task-catalog metadata; action and external-effect attempts. Task catalogs remain with publication metadata to avoid a task/publication cycle. |
| taskRuns, taskCompute | Definition revisions, runs, requests, attempts, requested effects and repair; then pending compute, dispatch and cancellation. |
| executionRecovery, retainedHistory | Their distinct scheduler declarations and existing domain-owned model constants. |
| legacyPersistence, sync, legacyInvokeSessions | Existing retained persistence, freshness/live-query and invocation-session declarations, with their current consumers. |
| legacyDeclarativeCandidate, legacyDeclarativeRuntime, legacyDeclarativeVerifier, legacyApplicationRevision, legacyDeclarativeActivation | The retained candidate-to-verifier/revision/verdict/activation DAG. Preserve activation's previous-revision self-reference. |

Preserve three different current surfaces exactly: all 117 central table
declarations and named exports; the driver's explicit 82-key `flarexSchema`
membership, order and inferred types; and the generator's explicit 140 table
exports from `database/drizzleSchema.ts` (98 central and 42 companion tables).
They are not interchangeable inventories. Do not spread all declaration exports
into the driver schema, use a generator glob, or broaden generator coverage.
Existing companion declaration owners remain in place and depend directly on
primitives, catalog, scope, commit or Application declaration leaves.

The generator configuration still referenced the displaced root file. Point it
at the existing `src/database/drizzleSchema.ts` owner. This repairs the path
without adding tables, generating DDL or changing migrations. Existing generator
exclusions, including retained Declarative tables and Application read bindings,
remain explicit; organization does not decide a schema-evolution capability.

There is no durable-data conversion, schema-name change or reset in this cutover.
Migrate internal declaration imports and remove the displaced declaration bodies.
Validate independent before/after table metadata, export inventories, aggregate
order and singleton identity, including columns/defaults/indexes/CHECKs/foreign
keys. Existing migration SQL alone cannot prove declaration parity, and an
expected key list derived from the new aggregate cannot prove unchanged coverage.
Run paired driver and installation/catalog/Application/journal consumer proofs,
typechecks, generator checks and required reviews. Keep one domain reading map
that distinguishes declarations, driver composition and migration generation.

### Point Publication

Point publication now separates consumer contracts, six authentic capability
registries, capture/preparation, durable accepting transactions, finite
publication/nonacceptance, finishing, conflict reproduction/replacement and
relation recovery under `commit/point/`. Construction binds the operations;
the consumer API imports lightweight contracts, errors and claims. Lower error
families no longer route declarations through installation or SQL construction.
The displaced transaction/error/Promise/observation bodies and broad system-test
route are removed. The [owner guide](../../packages/persistence-postgres/src/commit/point/README.md)
shows the concrete flow. Connected validation and both final reviews are complete;
this organization cutover makes no performance acceptance claim.

Use contracts/errors and specific capability registration/lookup at the bottom,
then capture and genuinely shared private command/locked state. Preparation,
attempt acceptance, participant proof, OCC and lowering compose above them.
Durable publication, finite publication, finishing, replacement and relation
recovery retain distinct ordered operations; construction visibly connects
them through the existing transaction runners. Consumers use the lightweight
contract/error boundary; trusted constructors use their explicit route. Separate
single lower-owner error classes from heavyweight matching/SQL conversion where
necessary. Do not create equivalent classes or merely move the heavy import to
another barrel.

The selected concrete publication layout is:

| Owner under `commit/point/` | Responsibility |
| --- | --- |
| contracts, errors, limits | Exact consumer commands, outcomes, errors and existing bounds; no SQL construction or installation dependency. |
| capabilities | The six existing publisher, terminal-refusal and maintenance/eligibility registries with specific authenticated issuance and lookup. |
| capture, preparedCommands, lockedState | Descriptor-safe command capture, prepared evidence and the actual locked-row projections. |
| uniqueEligibility | Existing unique readiness preparation and transactional acceptance, independent of publisher construction. |
| preparation, attemptAcceptance, participantProof, occ, lowering | Ordered authority preparation, fresh acceptance, participant/source proof, conflict validation and conversion to the existing materialization command. |
| durablePublication, finitePublication | Their distinct original settlement and nonacceptance operations, using the authoritative publication owners. |
| finishing, rollbackProof, replacement, relationRecovery | Their distinct state transitions, conflict reproduction, acknowledged replacement and uncertain-outcome recovery. |
| promiseBoundary, observation | Existing full-Cause runtime/transaction conversion and passive diagnostic observation. |
| constructionContracts, construction | Trusted composition inputs and short assembly of the actual operations. |

Keep `point-commit-transaction` as the lightweight consumer package route. Add
explicit internal construction and eligibility routes, then migrate constructor
and readiness callers to them. Internal owners import the actual module they
need. Remove the old combined API bodies and implementation paths after all
callers move; forwarding exports would preserve the dependency problem.

Move each original lower error family once into its own existing domain: unique
keys, candidate write guards, committed outcomes, rows, index entries, scope
clocks, read-committed transaction failure and execution claims. Preserve exact
class identity, prototype, message, tag, fields and expected failure projection.
Implementations and matchers consume those same classes. Error declarations do
not acquire SQL matching or accepting authority.

Resolve the actual materialization/acceptance cycle in the connected cutover.
Place the original head-evidence decoders, sidecar ordering/preparation policy,
unique-failure projection and limits below both owners. Move original-build-lock
recording, capture, acceptance and their two identity maps together into one
specific owner. Keep committed-row materialization and publication acceptance
above those leaves; do not create a second build-lock registry or wrapper engine.

Private import and constructor routes break across executor authentication,
planning, execution and recovery; Application serving/readiness; lower storage
and publication; framework composition; and connected fixtures/tests. Move the
actual consumer imports, package routes, source inventories and runtime guards.
No durable identity, codec, journal, table or stored outcome requires conversion
in this organization. Preserve the current native business and public failure
contracts, and inventory any deliberately corrected touched-flow defect before
changing it.

Retain existing materialization, scope publication, stored-authority, journal,
installed finite observation/procedure and full-Cause Promise boundary owners.
They already own actual committed writes, prefix/facts/outcome/wakes and durable
uncertainty. No generic settlement context, competing registry or universal
transaction API is selected.

Preserve durable replay and protection ordering, database-time observation after
the real lock wait, participant/source first refusal and OCC before lowering.
Finite preparation deliberately stores ordered Exit verdicts: splitting must
not evaluate them early or concurrently. Generated insertion guards remain
distinct from genuine missing-read evidence. Only acknowledged COMMIT confirms
replacement entry or nonacceptance proof; a missing outcome after uncertain
COMMIT remains uncertain. Preserve interruption drainage, serialization/deadlock
classification, rollback/release failures and passive observer isolation.

Migrate executor authentication/planning/execution/recovery, Application serving
and readiness, and privileged/connected test consumers. Remove displaced bodies
and constructor reexports in the coherent cutover. Validate paired publication,
finishing, replacement, stored evidence, relation/strong-reference, concurrency,
lost-ack and full-Cause witnesses plus genuine finite mixed and Worker consumers.
An import graph check alone does not establish actual Worker execution.

The two durable replacement callbacks currently wrap their owned clock,
outcome, authority, profile and conflict sequence in one Promise error boundary
inside an already Effect-owned transaction. Replace that broad domain wrapper
with sequential native Effect composition in `replacement` and
`relationRecovery`. Keep narrow adapters at the actual inherited Promise/SQL
operations, enter the existing pure verdicts with `Effect.fromResult`, and keep
owned refusals in the same typed failure channel. The durable-profile helper
returns its existing corruption verdict as Result instead of throwing it.
Preserve every lock, observer, first-refusal and SQL order, the existing error
projection, transaction masking, rollback drainage and full Cause. This corrects
composition at the actual replacement owner; it adds no transaction runner,
retry, capability, schema or durable format. Existing replacement, conflict,
rollback and uncertain-settlement witnesses remain the acceptance evidence.

Connected publication validation exposes a pre-existing failure projection in
developer membership acceptance. Its native owner detects damaged stored
membership as `AppIndexEntryStorageCorruptionError`; publication acceptance then
replaces that error with generic `developerIndexTransitionInvalid` corruption.
Preserve the existing precise storage-corruption instance in the one developer
failure mapper and reuse that mapper for native SQL projection. Its existing
public failure union already admits this class. Keep limit, persistence and
unknown failures, first-refusal order, SQL and rollback unchanged. The four
authentic damaged-membership witnesses retain their precise error assertions.

Reconcile stale diagnostic assertions against the actual accepting owner.
Missing relation targets are checked inside native `acceptPublication`, before
materialization; verify the actual function, exact target refusal, no application
write and atomic rollback. Forced rollback legitimately observes both native
acceptance and application statements; retain interruption/drainage and complete
state assertions. Adjacency facts use bounded JSON packets instead of seven
parameters per row; verify the actual native statement, packet sizes and all
committed facts. Do not add synthetic observation, redundant queries or weaker
business assertions to reproduce the displaced SQL shape.

The connected Application consumer typecheck also exposes an inaccurate table
membership contract. The participant admission owner lends an immutable view
with membership, iteration and `forEach`, but names it as the complete native
`ReadonlySet`; newer consumer library profiles then correctly require methods
that this view does not implement. Give that actual source-owned view one
precise `LogicalParticipantTableMembership` contract and use it in admission
state, inspection and admission callback signatures. Preserve the private Set
clone, frozen view, iterator and exact callback identity. Native Set inputs and
actual cloned Set results keep their genuine contracts. Do not expose mutation,
add generic set operations, cast the view or change consumer library settings.
This is a type-contract correction with no runtime, authority or database change.

Complete the stored-attempt fault-witness migration as well. Native publication
procedures deliberately restrict `search_path`; test triggers that resolve their
own sequence by an unqualified name fail with `42P01` before raising the intended
serialization or deadlock failure. Qualify those actual test-owned sequence
relations, including reset operations. Keep the installed procedure policy and
all genuine SQLSTATE, retry/exhaustion, drain and durable-state assertions.
The row-fact witness now observes the native two-parameter statement: verify the
real function, complete 128-row packet and final verification packet while
preserving callback rollback, dense ordinals, distinct rows, resume and replay.
Retain the real stepped publication callback on the resumed witness so both
attempts exercise that same native profile; assert one tentative and one resumed
row-fact event, and no new event or query on durable replay.
This corrects test setup and observation; it adds no production SQL or fallback.

The reusable Native Application PostgreSQL fixture must describe its actual
installed target namespace. Its default `public` locator currently conflicts
with the split fixture's fresh migrated target schema, so activation correctly
looks for its native procedure in the wrongly advertised namespace. Capture the
actual target schema once during fixture construction and use one physical
locator for provisioning, placement and located targets. Reuse the existing
readiness-fixture topology capture and retain intentional explicit-locator fault
witnesses under their recorded contracts. Do not repair another namespace,
recreate procedures, relax installed protection or introduce a runtime fallback.
This is test topology correction, with setup cost outside business execution.

Connected fixture proofs keep the actual installation contract. The competing
row writer must acquire genuine installation admission before scope locking and
row mutation in its existing transaction; it must not bypass the owner or use a
second transaction. Phase-stop diagnostics include the real empty-membership
preparation span, while the SQL witness still permits only acceptance and forbids
materialization or durable changes. Outcome lookup requires representative
unrelated scope/authority/header rows and fresh planner statistics to prove the
unique scope-UUID index seek; a full primary-index scan of a one-row clock table
does not establish bounded lookup. Keep the exact resource-release, conflict,
first-refusal, rollback and index-condition oracles.
Fresh-attempt diagnostics follow the actual combined `attemptTailLocked` stage;
its journal and execution-claim locks remain under the existing clock/session/
lease order. Keep the genuine concurrent replacement winner/loser and subsequent
rerun/publication assertions rather than requiring displaced observation names.

### Application Activation And Readiness Decomposition

Follow point publication with a connected replacement of the concrete
Activation/Readiness layout and its consumers. Selection claims and transaction
lending invalidation currently reach concrete Activation construction from lower
materialization, index and installation owners. Readiness obtains unique
preparation and acceptance through concrete point publication. Separating only
error declarations would leave these dependency cycles and hide the actual
serving flow. This layout is selected for the organization goal; its concrete
cutover remains unimplemented.

Use `application/activation/` for the following actual responsibilities:

| Owner | Responsibility |
| --- | --- |
| contracts, errors | Exact opaque capabilities, bases, repositories, outcomes and the one existing error family. Lower domain references are type-only. |
| selectionIdentity, repositoryIdentity | The existing selection/binding/head registries and specific authentic claims; registered repository/reader composition and preparation dispatch. No SQL or constructor dependency. |
| acceptedBinding | Accepted-token identity and its transaction lending index together, including borrowing, writer invalidation and callback cleanup. |
| bindingPreparation, bindingAcceptance | Request/retained capture and readiness correlation, then fresh legacy/relation acceptance and checked-head lending. |
| currentBinding | Current-generation probes and staging, the existing semaphore, schema fixation and lexical refresh loan. |
| standaloneBinding | Protected indexed capture and installation/epoch-guarded acceptance. Its identity storage stays below SQL construction. |
| finiteIdentity, finitePreparation | Prepared/root-bound metadata identity and detached projections; actual initial, confirmed replacement and cold-recovery graph preparation. |
| activationPersistence, readBindingPublication | CAS/replay and atomic activation history/maintenance/ownership/revocation/head persistence; existing canonical parent-derived read-binding publication and installation backfill. |
| repository | Recognizable ordered `activate` and `readActive` operations and concrete assembly. |

Use `application/readiness/` for contracts/errors and one identity owner holding
repository issuers, captured rows, prepared/stored results and activation views.
Its specific issuance operations preserve explicit request/retained policy.
Bundle authentication, control-schema correlation, cold evidence, canonical
frames and physical coverage have their distinct existing domain owners.
Preparation captures SQL rows before closed-transaction authentication and
control work; acceptance retains prepared/stored/protected/finite validation;
persistence owns atomic readiness settlement/replay. Repository assembly keeps
`settle` and `readReady` ordering visible.

Keep registry maps private and singular. Reuse the existing ActiveHeadRead,
ActivationFrames, StandaloneBinding, relation and ownership implementations.
Declaration movement does not justify a second codec, cache, acceptance path or
generic context carrying every callback and port. Lower metadata writers import
invalidation from `acceptedBinding`; materialization and task authority import
claims from `selectionIdentity`. Those changes remove the actual backedges.

Consumer APIs export explicit lightweight contracts, errors and authentic
claims. Trusted construction has its explicit internal route. Migrate the
standard Application task/action/query/mutation systems, framework direct and
borrowed hosts, journal/session/finite owners, publication/materialization,
logical-source admission/readiness, index and installation writers, test
environments and package routes together. Separate system-test inspection from
construction. Remove the displaced implementation bodies and constructor
reexports; do not retain forwarding paths to avoid moving callers.

Preserve request evidence without an ambient lease or executable verdict, actual
retained charging/disposal and exact transaction/selection/clock/checked-head
lending identity. Installation acquisition remains before scope/metadata locks;
protected callbacks retain their final epoch guard. Capture transactions close
before hashing/materialization, and current-generation refresh precedes business
execution without retrying business callbacks. Finite initial lexical loans,
confirmed replacement and cold recovery remain distinct; finite relation
refusal remains. Indexed full-proof maintenance can refuse `storedState` before
the final `concurrentHead` check, and the cutover preserves that order.

Keep durable legacy/relation/policy head formats and activation/serving login
pairing exact. History, maintenance, ownership, revocation, read-binding and head
changes stay atomic. Callback rollback, cleanup failures, interruption and
uncertain settlement keep their complete Cause and ordering. This organization
does not authorize hosted activation or a general migration/reset.

Finalize the unique eligibility/preparation/acceptance dependency against the
selected point-publication owner after its cutover. Preserve exact factory
authentication and the finite metadata registry instead of introducing a wrapper
port or substitute issuer. Validate consumer value-import graphs and genuine
Worker witnesses separately; lightweight claims must avoid SQL, installation
construction and Node crypto, while accepting operations remain actual SQL
owners.

Tests follow binding preparation, current preparation, catalog integrity, finite
correlation, serving, standalone/backfill, active admission, metadata, relation
readiness/read and ownership. Move task/action/query cases embedded in the
readiness suite to their existing domain test owners with genuine shared fixture
support. Keep driver/resource construction explicit and preserve every original
case, fault boundary and expected refusal. Validate paired drivers, connected
consumers, cleanup/cancellation, stale/clone/closed issuers, current refresh,
finite replacement/recovery and full-Cause settlement before removal and commit.

### Request Binding Lifecycle Correction

The existing ambient-host standalone witness exposes an Application issuer
defect: `issueLegacyBindingPreparation` registers every token for host disposal,
including request-owned preparations whose `lifetime` is absent. The host's
disposal set then strongly retains those request tokens and deletes their issuer
registry entries when that unrelated host closes. This contradicts the accepted
[request/retained contract](../core-performance/read-admission-construction-preflight.md):
request entries are bounded weakly held evidence, carry no retained lease and
must not accumulate in an ambient host allocation.

Register legacy binding head preparation and host disposal only when the actual
preparation carries its retained lifetime. Keep request registry entries weak;
they still grant no executable or serving verdict, and every business use keeps
the existing fresh binding/source/clock acceptance. Do not change the protected
standalone or finite issuers that genuinely own retained lifetimes, the general
host runtime or relation-only preparation semantics. The composite issuer's
legacy branch uses this same corrected owner.

Carry the captured request/retained profile into the nested stored-readiness
issuer as well. Its unconditional ambient lifetime capture and disposal would
otherwise invalidate surviving request bindings during their first fresh
transactional acceptance. Request readiness remains weak issuer-owned evidence
without a host lease; retained readiness and the existing independent read-ready
and finite issuance routes keep their actual host lifetimes and cleanup.

Preserve the current failing witness: request tokens remain inspectable after
ambient-host closure, while authentic retained selections refuse after their
issuer closes. Validate the exact profile with PGlite and ordinary-role Postgres
and retain clone/wrong-issuer, fresh acceptance and source closure proofs. This
is a lifecycle correction during organization, not a performance acceptance.

1. Finish construction/API migration and its validation, review and commit.
2. Record the concrete module/dependency and caller inventory for each substantial
   connected owner change, then implement it within this standing authorization.
3. Migrate consumer imports, package exports, guards, resource paths and tests;
   remove displaced bodies/paths in the same coherent change.
4. Audit connected flows for duplicate construction, accidental implementation
   imports, confusing names and stale guides. Correct the real owner.
5. Finish one accurate source/API/test map and validate the complete admitted flows.

The ordering follows dependencies and risk, not a per-file or per-turn size cap.
Existing retained formats and legacy consumers need named ownership and removal
gates. This plan does not authorize silent deletion of their durable data.

## Completion Gates

Completion requires clear source and test ownership, readable construction and
request orchestration, cohesive substantial modules, explicit internal exports,
no displaced forwarding/duplicate paths, and accurate flow guides. Folder moves,
line-count reductions and passing isolated helpers do not close the goal.

Validate affected typechecks, package/provenance/import and test-discovery guards,
core/diff lint and exact staged lint. Preserve connected native and mixed behavior,
failure order, cancellation/drainage, authentic authority, scoped liveness,
concurrency, recovery and outer-only settlement. Database/transaction/schema
claims require PGlite and focused ordinary-role PostgreSQL proof; browser/Worker
boundary claims require the actual runtime witness. Obtain both required reviews,
remove obsolete paths and commit each verified coherent outcome. Stop owned
validation resources. Structural cleanup makes no native-relative latency claim.
