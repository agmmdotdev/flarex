# Managed Schema Deployment And Migrationless DX

Status: Accepted deferred foundation contract with `M01-A`, `M01-B`, `M02`,
and production-inert `M03-A` through `M03-C` complete. The private
managed-schema compatibility, read-only planning, candidate-document policy,
canonical validation frames, guarded target-local single candidate head,
bounded exact-frontier scanner, authenticated point-commit write guard,
readiness receipt, and activation gate now exist. Application Analysis
`AA-R0` through `AA-R8` are complete. `M03-D` is complete through its
current-generation schema-A through schema-G system-test lineage and all nine
acceptance items. `M04-A` provides the private read-only prepared-plan
composition. `M04-B` now has its private bounded exact-plan apply coordinator
and matching PGlite plus genuine-PostgreSQL schema-B proofs, so the private
checkpoint is complete. `M04-C` now provides the private `flarex-dev` adapter
and shared detached JSON projection, with the same connected schema-B proof in
PGlite and genuine PostgreSQL. `M05-P`, private `M05-A`, and private `M05-A2`
are complete: the accepted retirement boundary is explicit, one exact non-
enabled unique-set build workspace can be reclaimed without retiring physical
authority, and authenticated candidate supersession now performs that narrow
reclamation atomically.
It remains private and production-inert: no public route, CLI, deployment
caller, trigger, enabled-definition retirement, physical/evidence purge, or
production generation cut is authorized by this roadmap.

## Decision

Flarex developers declare desired schema state and deploy it. They do not write
SQL migration files for ordinary app or Payload schema changes:

```text
schema source
  -> authoritative backend analysis
  -> canonical immutable schema artifact
  -> compare with active production schema and data
  -> deterministic deployment plan
  -> apply safe metadata changes or managed builds
  -> validate
  -> atomically activate, or reject without partial activation
```

This is a migrationless developer experience, not a migration-free database.
Flarex owns durable internal plans, additive DDL, stable identity allocation,
backfills, validation, activation fences, rollback retention, and eventual
cleanup.

## Convex And InstantDB Precedent

Convex automatically pushes schemas during `convex dev` and `convex deploy`.
The first push of a changed schema validates existing documents, and the push
fails when existing data does not match. Its production guidance uses gradual
expand/backfill/contract changes for required fields and type changes:

- <https://docs.convex.dev/database/schemas>
- <https://docs.convex.dev/production/overview>

InstantDB exposes `instant.schema.ts` plus `instant-cli push schema`. The CLI
compares local and production schemas, plans and applies data-model migrations,
and asks for explicit rename intent when delete-plus-create is ambiguous. CI
can provide rename mappings non-interactively:

- <https://www.instantdb.com/docs/cli>
- local `client/packages/platform/src/migrations.ts` for attr/link comparison,
  rename resolution, required/index/unique/type/cardinality operations;
- local `client/packages/platform/src/api.ts` and
  `server/src/instant/db/indexing_jobs.clj` for schema push and managed jobs.

Flarex adopts that desired-state UX while retaining stronger Postgres build,
OCC, generation, and rollback gates.

The local Convex implementation adds an important concurrency rule beyond the
public documentation:

- `crates/database/src/bootstrap_model/schema/mod.rs` permits one active schema
  and at most one pending or validated non-active schema per namespace;
- writes are checked against the active schema, while an incompatibility with
  the pending/validated schema fails that candidate rather than rejecting a
  write that is still valid under the active schema;
- `crates/application/src/schema_worker/mod.rs` validates existing documents
  from a fixed snapshot, persists bounded progress, and stops when the pending
  schema is failed or superseded; and
- `crates/application/src/deploy_config.rs` waits for both document validation
  and required index backfills before finish/activation.

Flarex adopts those semantics, not Convex's physical system-table shapes. Its
scope clock, immutable schema artifacts, stable table IDs, row-revision model,
point-commit owner, readiness receipt, and activation CAS remain authoritative.

## Current M03-D Composition

The managed-schema owners now publish immutable schema artifacts, preserve
stable table and logical-index identities, validate candidate rows at an exact
frontier, guard active-valid writes against the pending candidate, require the
exact validation receipt for readiness, and consume it through the existing
activation CAS.

Roadmap 49 now records the complete one-way private consumer migration and
retirement cut. Current Standard query, mutation, action, and Task consumers use
the unversioned Application authority; the displaced analysis, readiness,
activation, and Standard owners are reachable only through explicit historical
system-test subpaths. The current Application point-mutation runner also shares
the journal's exact tagged point-read outcome with the generated Worker and has
connected Workerd, sealing, OCC replacement, replay, and single-publication
proof. `M03-D` must consume those current owners rather than reconstructing the
superseded pre-migration harness.

The current composition path is:

```text
Application Analysis
  -> immutable schema and runtime publication
  -> managed candidate validation
  -> Application readiness and activation
  -> Application Query System / Application Mutation System
  -> real Workerd Application runner
  -> existing journal, OCC, commit, feed, and outbox owners
  -> authoritative persistence inspection
```

The shared `ScopeExecution` capability is already consumed by current query and
transaction-session owners. The scenario exercises it through those private
system operations; it must not call the scoped transaction kernel
directly or duplicate its lock, placement, or authority policy.

The first `M03-D` implementation slice establishes schema A only in a new,
separate multi-revision cooking harness: real analysis, publication, candidate
validation, readiness, activation, Workerd query/mutation execution, durable
reload/replay, and exactly one commit. Subsequent slices extend that same
lineage through schemas B and C and the remaining acceptance matrix. The
scenario must not revive the deleted
stored-attempt harness, extend the historical single-revision runner, create a
test-owned scanner or receipt, or add dual selection or fallback.

The schema-A baseline is complete. It exposed `ST-CORE-022`, where the backend
Worker-definition owner compared nested function validators with
property-order-sensitive `JSON.stringify` equality after durable reload. The
approved correction now reuses the canonical Application function-entry frame
for exact order-independent comparison. The unchanged scenario completes two
cold analysis loads, one Workerd mutation, durable replay without re-execution,
one Workerd query, and exactly one commit/outcome/feed/outbox publication in
both PGlite and genuine PostgreSQL.

The first schema-B run exposed `ST-CORE-023` before remediation could begin.
The existing scanner correctly rejects a populated removal and persists bounded
failure evidence, but the active-reader readiness path then evaluates active
schema A against the single failed schema-B candidate head. Consequently
`readActive()` fails `notReady`, so schema-A queries and the ordinary schema-A
remediation mutation cannot run. This is a shared readiness/activation and
candidate-head composition defect, not permission for the system-test package
to cache an active selection, synthesize a receipt, or clear the failed head.
The approved correction preserves the last accepted active-revision readiness
authority independently of mutable non-active candidate progress. Candidate
settlement still requires the exact current validation head; active reads
authenticate and transactionally revalidate the durable readiness row, its
canonical bytes/digest, schema/task bindings, cold children, a freshly reloaded
application function/task graph, scope authority, and active-head CAS. The
resumed scenario proves A remains available, removes the incompatible field
through a normal A mutation, restarts validation at the new frontier, activates
B, rejects the removed argument before execution, and rejects a valid-argument
handler write that attempts to restore the removed field without publishing a
commit, feed, or outbox entry. No new schema, fallback, or readiness owner was
added.

The schema-C required-field cut is complete. Schema B introduces `slug` as an
optional field so ordinary active-schema mutations can perform the business
backfill; schema C tightens that same field to required. Existing rows without
`slug` produce bounded `$document.slug` failure evidence, block readiness and
activation, and leave schema B serving. Two ordinary schema-B mutations
backfill the rows, the same candidate restarts at a newer frontier, and schema
C then validates and activates. The active schema-C argument validator rejects
a missing slug exactly, and final Workerd queries prove both authoritative rows
carry their backfilled values. No setup write, synthetic receipt, fallback,
second schema authority, or shared-core correction was required. The nested
validator tightening case follows from that same lineage.

The schema-D nested-validator cut is complete. Schemas B and C admit optional
`details` whose required `difficulty` child is a string; the ordinary schema-B
slug backfill leaves one recipe at `easy` and one at `expert`. Schema D narrows
that child to the literal `easy`. Candidate validation identifies only the
authoritative `recipes` table/row and `$document.details.difficulty` path, with
no document body or rejected value in the bounded failure entry. Schema C stays
active while its ordinary mutation rewrites the incompatible row, the same D
candidate restarts at the newer frontier, and D then validates and activates.
The active D function validator also rejects the incompatible nested argument
at `$args.details.difficulty`. No shared validator, scanner, evidence, runtime,
or commit owner changed.

The schema-E concurrent-write cut and `ST-CORE-024` correction are complete.
The unversioned `ApplicationMutationSystem` now requires the existing opaque
M03-B write guard, authenticates its exact session-authority binding at Layer
construction, and passes it to the unchanged point-commit publisher. Missing,
structurally copied, and foreign-authority capabilities fail closed. The
connected cooking scenario tightens `details.servings` from number to literal
`2`, advances the non-active E candidate to a non-null cursor, and then commits
two ordinary schema-D mutations through Workerd. The candidate-valid mutation
leaves the exact progress digest unchanged. The active-valid/candidate-invalid
mutation still publishes its row, outcome, feed, and outbox while the same
transaction replaces E progress with bounded `pointCommit` evidence at
`$document.details.servings`. Schema D remains active, E cannot become ready or
activate, and both writes are visible through D. This adds no validator,
transaction, head writer, fallback, public API, or second commit path.

The schema-F recovery cut completes acceptance item 8 without adding another
owner. Schema E first replays exactly, then an F candidate with a distinct
schema identity supersedes it. F installation commits before a deliberately
lost response and a newly issued candidate-validation port recovers the exact
durable head; replay preserves its digest and attempt fence. A fault after the
next progress write reports confirmed rollback and leaves that head unchanged.
F then settles through the existing scanner/readiness owners, and two
concurrent requests to the existing activation CAS converge on one inserted
activation plus one exact replay. A final stored-frame corruption is rejected
by another cold port while the already-active F revision remains coherent from
its immutable readiness and activation evidence. PGlite and genuine
PostgreSQL run the same scenario and retain one candidate head, one active
head, and the unchanged application commit/feed/outbox counts.

The schema-G stale-attempt cut completes acceptance item 9 and resolves
`ST-CORE-025`. The existing point-commit transaction now performs one
Application-generation-only schema fence after its scope-clock lock and exact
outcome replay: it authenticates the pinned session schema against the
immutable readiness row selected by the current active Application head.
Ordinary same-schema active-revision movement remains allowed, while a
schema-replacing activation makes an admitted old-schema attempt fail with
typed stale authority before any row, outcome, feed, or outbox publication.
The cooking lineage pauses a real schema-F Workerd attempt after ordinary
admission, activates compatible schema G through the existing activation CAS,
proves publication/application storage and the exact G candidate receipt stay
unchanged, then issues a fresh ordinary G mutation and observes exactly one
publication plus a G-selected final query. PGlite and genuine PostgreSQL run
the same transaction and inspection path. No second active-head reader,
session owner, OCC system, commit path, fallback, or test-owned retry was added.

## M04 Developer-Tooling Composition Preflight

### Current truth

The current system-test composition proves the complete Application path, but
it does so through a persistence-owned fixture. That fixture explicitly joins
the current Application Analysis context and cold host, durable Application
publication, schema-authority publication, candidate validation, readiness,
activation, Standard query/mutation Systems, and real Workerd execution. It is
proof evidence, not a developer-facing deployment coordinator.

`@flarex/managed-schema` currently owns the pure canonical
`AppSchemaEvolutionPlanV1` operation. It accepts already-decoded authenticated
active/candidate manifests, exact scope/storage/epoch/frontier pins, and
optional explicit rename intents. It intentionally performs no catalog, row,
DDL, readiness, activation, or source-analysis I/O and grants no apply
authority.

The current `flarex-dev deploy` command is not that missing coordinator. It
speaks the existing deployment-push `start` / `finish` / `abandon` contract and
its finish operation activates that contract's deployment metadata. Treating
it as managed-schema apply would bypass the new Application Analysis,
candidate-validation, readiness, and activation authorities. The current
`@flarex/standard-application-registration` package also exposes only an
explicit historical system-test entrypoint; it has no current unversioned
Application registration/deployment composition yet.

### Decision

M04 must first extract the proven current-generation composition behind one
private host-neutral deployment capability. CLI and AI adapters consume that
same capability only after its direct PGlite and genuine-PostgreSQL proof.
Neither adapter may reconstruct planning, read raw authority tables, or call
candidate/readiness/activation repositories independently.

```text
developer source package
  -> current Application Analysis and immutable publication
  -> private managed deployment plan coordinator
     -> authenticated active/candidate manifests and authority frontier
     -> @flarex/managed-schema canonical AppSchemaEvolutionPlanV1
  -> explicit apply request bound to the exact plan digest
     -> existing candidate validation and physical-build owners
     -> existing readiness owner
     -> existing activation CAS
  -> one detached machine-readable result
     -> local CLI presentation
     -> CI or AI-tool consumption
```

The private composition owner remains
`@flarex/standard-application-registration`, but its current entrypoint must be
a new plain unversioned Application module rather than an extension of the
retained `internal/system-test/legacy-v1` surface. Domain planning policy and
the canonical plan remain in `@flarex/managed-schema`; PostgreSQL mechanics and
opaque authority ports remain in `@flarex/persistence-postgres`; source
packaging and human/JSON presentation remain in `flarex-dev`.

### Checkpoints

1. **M04-A — private prepared plan.** Add the unversioned current Application
   deployment composition and one read-only plan operation. It consumes exact
   current Application Analysis/publication evidence plus opaque active-schema,
   schema-artifact, and scope-frontier ports; invokes the existing pure planner;
   and returns the canonical plan and digest. Structural copies, cross-control
   or cross-target composition, stale active/candidate identities, and changed
   scope authority fail closed. It performs no candidate installation, build,
   readiness settlement, activation, route, or CLI work.
2. **M04-B — private exact-plan apply.** Accept only an exact prepared plan from
   M04-A, revalidate every activation prerequisite, and drive the existing
   candidate-validation, physical-build, readiness, and activation owners.
   Blocked plans remain non-applicable; remediation is ordinary application
   work followed by a new plan at a new frontier. Apply is resumable and
   idempotent but owns no new transaction, OCC, row-write, readiness, or
   activation semantics.
3. **M04-C — developer adapters.** After the private capability passes the full
   system scenario in PGlite and genuine PostgreSQL, add one `flarex-dev`
   adapter and one shared detached JSON projection for human, CI, and AI-tool
   callers. Exact command spelling remains deferred until this checkpoint. AI
   tooling receives no separate privileged API and cannot auto-confirm rename
   intent or destructive remediation.

M04 does not authorize an HTTP route, Worker binding, production caller,
credential model, deployment discovery, public compatibility promise, raw SQL,
automatic data deletion, migration-history rewrite, dual apply path, fallback
to the existing deployment-push finish operation, or `AA-R9` production
cutover. Those require their directly owning roadmaps and separate approval.

### Current M04-A implementation

The unversioned Application entrypoint in
`@flarex/standard-application-registration` now exposes one Effect service for
private read-only plan preparation. Its persistence port authenticates the
exact Application publication object, control catalog, active-selection owner,
schema-artifact publisher, scope-authority resolver, and located target
database before it takes a shared scope-clock snapshot. It revalidates the
active head and candidate publication under that target transaction, then
passes immutable active/candidate manifests and the exact frontier pins to the
existing pure `@flarex/managed-schema` planner.

The result contains the canonical plan, its digest, and an opaque process-local
prepared handle bound to the exact planning port, candidate publication, and
plan identity. Structural
copies of the port, publication, or prepared handle fail closed; cross-control
composition, changed scope authority, a candidate that became active, and
changed stored publication evidence also fail closed. The current cooking
lineage for schemas B through E consumes this service instead of reconstructing
planner pins in the test package, and the later schema-F scenario traverses the
same lineage. M04-A performs no candidate installation, physical build,
readiness settlement, activation, route, CLI, or production work. The M04-B
coordinator below consumes only its exact prepared handle.

### Current M04-B implementation

The private Application entrypoint now exposes a separate apply Effect service
that accepts only the opaque handle issued by the exact M04-A planning port.
It rejects copied handles and foreign planning/application composition, checks
whether the candidate is already active, recomputes the canonical plan from the
current authenticated snapshot and stored rename decisions, and rejects a
changed plan digest before performing work. A plan whose canonical disposition
is `blocked` returns a non-applicable result without installing a candidate or
starting a build.

One apply call performs at most one bounded validation or physical-build page.
The coordinator delegates candidate installation/scanning/settlement, index
reconciliation and intrinsic/developer backfill, unique-set closure/backfill,
readiness settlement, and final active-head CAS to their existing persistence
owners. It owns no durable deployment row, loop, transaction, OCC path, row
write, readiness rule, or activation rule. Progress is therefore resumed by
calling the same exact prepared handle again. Once the candidate is already
active, the coordinator returns a distinct convergence result without a plan
digest: activation evidence does not persist the managed-plan commitment, so
an older handle for the same candidate must not be mislabeled as an exact-plan
replay.

Validation, authority, physical-build, and unique-build owner failures remain
in their existing typed error unions, including decision uncertainty. The
activation repository's generic host/schema failure channel is retained behind
a distinct typed activation-owner error with its original cause; the
coordinator does not guess a retryable disposition from an unknown property.

The connected cooking schema-B proof now publishes the candidate without the
fixture pre-enabling its prerequisites. The canonical plan includes both a
document-validation change and a new developer index. Apply rejects a copied
handle and a foreign target, records the populated-row validation failure,
leaves schema A active, rejects the old plan after the ordinary remediation
commit advances the frontier, accepts a newly prepared plan, drives the new
physical build, settles readiness, activates schema B, and observes the same
active candidate without another sequence. The proof also retries the older stale
handle after activation and confirms it is reported only as candidate
convergence, not exact-plan replay. The same scenario is green in PGlite and
genuine PostgreSQL, completing M04-B without a public route, CLI, or production
caller.

### Current M04-C implementation

The internal `flarex-dev/internal/managed-schema` subpath now provides one
Effect-native preparation adapter and one apply adapter over the existing
Standard Application services. Preparation returns the exact process-local
opaque handle separately from a detached JSON projection of the canonical
plan. Apply accepts only that exact handle and projects the existing bounded
result union field by field into one protocol-validated JSON discriminated
shape; the only wire adaptation is the activation sequence's canonical
unsigned decimal string. Connected coverage proves lossless JSON round trips
for the plan and every apply status. The adapters do not catch, reinterpret, or
replace the planning/apply error channels and do not reconstruct planner,
persistence, build, readiness, or activation logic.

The existing `flarex-dev deploy` push operation is intentionally unchanged and
is not a managed-schema apply path. M04-C adds no CLI command, HTTP route,
Worker binding, database access, deployment discovery, autonomous confirmation,
or AI-only privilege. Human, CI, and future AI callers must consume the same
projection and retain the same opaque-handle and remediation boundaries.

The connected cooking schema-B simulation now prepares and applies entirely
through this adapter while preserving the M04-A/M04-B authenticity and
fail-closed assertions. It proves detached plan presentation, JSON-safe apply
presentation, copied/foreign/stale handle refusal, bounded progress,
remediation, activation, and convergence in both PGlite and genuine
PostgreSQL. This completes the private M04-C adapter checkpoint; public command
spelling and production wiring remain separate decisions.

## Approved Code And Package Ownership

Managed schema evolution is a separate private domain capability, not another
block of policy inside persistence, point commit, readiness, generated Worker
source, or the system-test package. Its accepted package owner is
`@flarex/managed-schema`.

The dependency and authority boundary is:

| Owner | Responsibility | Must not own |
| --- | --- | --- |
| `flarex-protocol` | Existing immutable schema-manifest types plus any canonical persisted validation frame/receipt codecs and budgets | Diff orchestration, PostgreSQL, scanning, readiness, or activation |
| `@flarex/managed-schema` | Pure conservative compatibility classification, candidate-document policy, lifecycle transitions, planning policy, Effect service contracts, and live/test Layer interfaces | SQL, migrations, scope-clock implementation, point-commit publication, active pointers, or test-only authority |
| `@flarex/persistence-postgres` | Guarded DDL/migrations, fixed-frontier repository and scanner, transaction/lock mechanics, durable progress/receipts, and exact authenticated adapter facets | Independent compatibility semantics, a second commit owner, or activation |
| `@flarex/standard-application-registration` | Private composition root that installs the managed-schema service with exact schema, persistence, commit, readiness, and authority dependencies | Reimplementing validation or exposing raw repository mutation as a developer API |
| `@flarex/system-test` | Production-compatible scenario configuration and assertions through the live composed service | Candidate-table mutation, synthetic validation receipts, direct activation, or a fake commit path |

`@flarex/managed-schema` depends inward on `flarex-protocol`, Effect, and only
approved domain-neutral utilities. It must not depend on persistence,
invocation, registration, or system-test packages. A machine-enforced package
boundary check will reject those reverse dependencies. The package uses plain
unversioned names for the accepted implementation; only canonical persisted or
wire contracts receive compatibility versions.

`M01-A` implements the first pure portion of this boundary. The package
exports `./compatibility` and classifies decoded manifests without storage,
host, or runtime work. It reports document compatibility, physical-
requirement drift, and stable-identity ambiguity as separate facets; neither a
safe document verdict nor the aggregate result is a readiness or activation
capability. Unknown/narrowing comparisons and exhausted bounded comparison
work fall back to data validation.

`M01-B` freezes the private candidate-validation contract at
`flarex-protocol/internal/app-schema-candidate-validation-v1`. Its separately
canonical progress, bounded failure-evidence, and final-receipt frames pin the
scope generation/fence/epoch, schema version and immutable manifest digest,
fixed snapshot frontier, and attempt fence. Progress is predecessor-linked;
failure evidence is strictly ordered, unique, bounded, and document-body-free;
the final receipt commits to the final progress digest and settlement frontier.
The contract owns row/page/semantic-byte/slice-time and frame/evidence ceilings
and fail-closed canonical decoding. Corruption, supersession, interruption,
confirmed rollback, and decision uncertainty retain distinct recovery
dispositions. This completion adds no storage owner or runtime integration.

`M02` adds the package's private `./planning` contract and the exact inward
dependencies already allowed by this roadmap: `flarex-protocol`, Effect, and
domain-neutral byte utilities. It produces a deterministic read-only
`flarex.managed-schema/evolution-plan/v1` identity over active and candidate
artifact digests, scope generation/fence/epoch, and a data-frontier commit
sequence. Operations remain canonically ordered and independently classified;
incompatibility evidence is document-body-free and capped; and remediation,
activation, and rollback prerequisites are data rather than executable
authority. Explicit rename intent can acknowledge only a logical rename that
already preserves the stable table or logical-index ID in the immutable
candidate artifact. It cannot reinterpret a different-ID remove/add or an
index move across tables. The plan is not a persisted validation frame,
readiness receipt, apply token, or activation capability.

`M03-A` adds the package's private `./candidate-document` policy and one
target-local persistence owner. PostgreSQL stores only the one canonical
progress, bounded body-free failure, or final receipt frame plus scalar
identity/lock commitments; authoritative app-document bodies remain in app-row
revision storage. Installation locks the scope clock before the one per-scope
head, authenticates the immutable candidate artifact outside the target write
transaction, and pins the current commit frontier. A different schema replaces
the head with a monotonically increasing attempt fence; exact replay is
idempotent for progress, receipt, and an unchanged-frontier failure. A matching
failure restarts only after the scope clock advances to a possible remediation
frontier. The scanner walks the current identity directory in stable
`(table_id,row_id)` pages and authenticates each identity's unique first
revision before materializing and validating the latest authoritative revision
at or before the pinned frontier. A missing or duplicate history root fails
closed. Metadata pages, live-row chunks, semantic bytes, elapsed slice time,
and failure evidence are bounded. Post-frontier identities never enter
validation, although they can consume bounded directory pages. Progress is
predecessor-linked; exact-frontier exhaustion is recorded with a terminal
cursor so later inserts cannot change the completed scan. Settlement
reacquires the scope clock and rechecks every
identity/authority pin, and interruption, confirmed rollback, uncertainty,
supersession, and corruption remain fail-closed. Migration `0057` adds only this
head plus a unique partial first-identity invariant over existing app-row
history. Its ordinary index build is bounded by migration-local lock and statement timeouts while
the `flarexdb_v1` application runtime remains production-inert; populated
history preservation and duplicate-root rollback are proved separately. The
migration remains portable to a selected non-public PostgreSQL `search_path`.

The package is organized by domain rather than adapter:

- pure compatibility and validator-subsumption policy;
- pure candidate-document validation and bounded diagnostic projection;
- pure candidate lifecycle transitions and settlement rules;
- a `ManagedSchemaService` contract for planning, starting, advancing,
  inspecting, superseding, and settling validation; and
- a deterministic in-memory test Layer for service contract and state-machine
  tests. That Layer is test infrastructure, not authority used by end-to-end
  simulations.

Two narrow authenticated integrations connect the domain to current core
owners:

1. Point commit receives one opaque candidate-schema write-guard facet. After
   it has derived final material rows and before publication, it invokes the
   guard inside the existing transaction. The guard may leave the candidate
   unchanged or atomically fail it; it cannot publish a commit, replace active
   validation, or reject an active-valid write merely because the candidate is
   incompatible. Storage, corruption, or composition uncertainty still fails
   the whole transaction closed.
2. Readiness receives one opaque validation-evidence facet. It loads and
   authenticates the exact settled receipt and contributes its commitment to
   the existing readiness root. Readiness does not scan rows, advance cursors,
   classify validators, or mutate candidate state.

The facets must be constructed from one captured control database, target
locator/resolver, and trusted scope authority, following the existing exact-
composition pattern. Structural copies, accessors that swap dependencies, and
cross-control or cross-target composition fail closed. No schema-evolution
logic or manifest body is generated into the user-function Worker runtime.

This separation permits four fast test layers before the cooking scenario:

1. table-driven and bounded generated tests for pure compatibility policy,
   including the invariant that every classification of
   `universallyCompatible` admits no generated old-valid/new-invalid witness;
2. pure lifecycle/model tests for replay, supersession, failure, interruption,
   uncertainty, and settlement;
3. golden protocol vectors for persisted frames, canonical bytes, digests,
   budgets, and corruption rejection; and
4. one repository contract suite run against PGlite and genuine PostgreSQL,
   followed by focused point-commit and readiness integration suites.

Only after those layers pass does `@flarex/system-test` exercise the same live
composition end to end.

## Accepted First App-Document Concurrency Model

For ordinary app-document schemas, Flarex will keep exactly one non-active
schema-validation head per scope. The head is schema-version authority, not an
application-analysis or function-revision identity, so multiple application
revisions that reference the same exact schema version may consume one result.
A different candidate schema supersedes the previous non-active head; both are
never shadow-enforced concurrently.

The lifecycle is conceptually:

```text
absent
  -> validating(frontier, cursor, attempt fence)
  -> validated(exact receipt)
  -> activated by the existing application-revision activation owner
  -> historical

validating | validated
  -> failed(bounded incompatibility evidence)
  -> superseded, or failed -> restarted at a newer remediation frontier
```

The exact persisted contract and DDL remain an implementation preflight, but
the following transaction semantics are fixed:

1. Installing a validation head locks the scope clock, authenticates the exact
   immutable candidate schema artifact, records the current commit frontier,
   and makes all later material commits observe that head.
2. A bounded scanner walks the current identity directory in stable
   `(table_id, row_id)` order, authenticates one unique history root for every
   identity, and validates every live row at that exact frontier. It reads
   authoritative row revisions rather than treating mutable current pointers
   as a historical snapshot; post-frontier identities are skipped without
   contributing validation evidence.
3. Every later successful point commit continues to validate its final live
   documents against the active schema. In the same existing scope-clock-first
   commit transaction, it also checks the one non-active schema head.
4. A value invalid under the active schema still rejects the mutation through
   the existing catchable validation boundary. A value valid under the active
   schema but invalid under the non-active candidate commits normally and
   atomically marks that candidate failed. Candidate deployment must not make
   the currently active application unavailable.
5. A valid concurrent write needs no cursor reset: the historical value was
   checked by the scanner and the replacement final value was checked by the
   commit hook. A delete removes an incompatibility and does not fail a
   candidate merely because its old value would have been invalid.
6. Final validation settlement locks the scope clock, rechecks the exact
   schema head, artifact digest, generation/fence/epoch, frontier, cursor, and
   attempt fence, then emits one immutable receipt. Missing, changed, failed,
   superseded, corrupt, or uncertain evidence cannot become readiness.
7. Application-revision readiness consumes that exact schema-validation
   receipt in addition to the existing index, unique, runtime, and cold-load
   evidence. Only the existing activation CAS changes the active schema.

This model avoids two unsafe alternatives: validating only a snapshot while
later writes escape the candidate, and restarting the entire scan after every
write. It also bounds commit work to one candidate schema and the existing
material-row ceiling rather than every registered application revision.

### M03-B point-commit integration preflight

`M03-B` uses one process-local opaque candidate write-guard facet derived from
the committed M03-A capability and bound to the exact point-commit scope
metadata, provisioning-receipt, and target-resolver objects. Copies, accessors,
foreign M03-A ports, and differently composed authority ports are unavailable;
the lower O07 proof lane remains independently usable only when no managed
candidate capability is composed.

For a material point commit, preparation reads one candidate-head snapshot and
authenticates the exact candidate manifest/digest outside the target write
transaction, compiling its pure document validator once. The existing point-
commit transaction remains the sole transaction and publication owner. After
it has locked and revalidated the scope clock, proved OCC dependencies, and
allocated the next commit sequence, it locks the one candidate head, rechecks
its candidate/authority commitments, and validates only final live material
documents. Deletes contribute no candidate failure. A concurrently advanced
progress frame for the same candidate remains admissible; an absent-to-present,
failed-to-restarted, or different-candidate transition without matching
prepared authority fails the transaction closed so the caller can reload.

If every final live document is candidate-valid, the head is unchanged. If one
or more are incompatible, point commit builds stable ordered `pointCommit`
failure entries at the allocated commit sequence, records the exact observed
failure count with at most sixteen bounded entries, and atomically replaces a
progress or receipt head with failure evidence. That candidate transition does
not reject the active-valid user write. Any later OCC, sidecar, publication, or
outcome failure rolls the candidate update back with the rest of the existing
transaction. Storage corruption, capability mismatch, stale authority, or an
unverifiable candidate artifact remains a whole-transaction failure rather
than a permissive candidate no-op.

Rollback proof exercises the same guard and then discards its tentative
candidate transition through the existing sentinel. Publication uncertainty
continues to resolve through the existing committed-outcome owner: a committed
row publication and candidate failure replay together, while confirmed
rollback preserves the prior candidate head. Work is bounded by the existing
material-row ceiling, one prepared validator, one locked candidate row, and the
persisted failure-entry/frame budgets. Focused acceptance requires same-table
and cross-table multi-row validity/failure, mixed live/delete behavior,
progress and settled-receipt invalidation, exact replay, concurrent scan/head
movement, rollback after candidate update, confirmed rollback, decision
uncertainty, and genuine-PostgreSQL lock/atomicity evidence.

`M03-B` is complete at this private checkpoint. The point-commit publisher may
be constructed with the exact opaque write-guard facet; when absent, the
existing lower lane is unchanged. Guard preparation, final-live-row validation,
candidate failure replacement, rollback proof, publication, and committed-
outcome recovery all reuse the existing point-commit transaction and outcome
owners. The lower point-commit lane may still omit the capability, while the
unversioned Standard Application mutation path now requires its exact guard
composition. Its failure or receipt is not readiness, activation, or routing
authority.

### M03-C readiness and activation preflight

`M03-C` adds one process-local opaque candidate-validation evidence facet to
the existing readiness composition. The facet is issued only from the exact
candidate-validation control database and trusted scope-authority resolver used
by readiness. Structural copies, accessor-swapped dependencies, foreign control
catalogs, and differently located targets fail closed. It does not expose the
candidate-head repository or grant installation, scanning, settlement,
readiness, or activation authority by itself.

Readiness preparation share-locks the scope clock and authenticates the one
current candidate head. An absent head, a head for another schema version, an
in-progress scan, or failure evidence returns a typed not-ready result. Only a
canonical settled receipt whose schema-manifest digest, generation, fence,
epoch, frontier, attempt fence, counts, settlement sequence, and frame digest
match the registered revision becomes opaque evidence. The existing readiness
transaction revalidates that exact evidence under its already-owned scope-clock
lock before inserting or replaying the readiness verdict. It does not scan app
rows, advance the candidate cursor, or mutate candidate state.

The readiness receipt directly commits the exact candidate-validation receipt
digest. This is an in-place refresh of the private, production-inert readiness
receipt contract: old private receipts without the commitment fail closed and
there is no dual decoder, fallback, or second verdict format. No PostgreSQL
schema or migration changes are required because the canonical readiness body
already lives in the existing verdict frame columns.

The existing activation CAS must revalidate the current candidate receipt when
first activating a revision, closing the race between readiness settlement and
activation. Once that revision is already active, its activation revision and
readiness receipt preserve the transitive candidate-receipt commitment. A
coherent active read or exact activation replay validates that immutable chain
without consulting the mutable single candidate head, because installing the
next candidate must not invalidate the current active application. A not-yet-
active revision can never use that stable-replay exception.

Focused acceptance requires missing, in-progress, failed, wrong-schema,
corrupt, stale-authority, and exact-receipt cases; receipt replacement between
preparation and readiness; candidate invalidation between readiness and first
activation; active-read and activation replay after the head is repurposed;
rollback, decision uncertainty, cold reload, exact root/vector stability, and
PGlite plus genuine-PostgreSQL transaction/lock evidence. M03-C does not wire
Standard live registration, expose a developer API, activate a route, create a
second active-schema owner, or begin the M03-D multi-revision cooking scenario.

`M03-C` is complete at this private checkpoint. The readiness receipt now
commits the exact candidate-validation receipt digest, readiness revalidates
opaque current evidence in its existing transaction, and a first activation
revalidates the receipt under the activation CAS lock. Repurposing the mutable
candidate head blocks a new activation request for the displaced schema but
does not invalidate the already-active reader or an exact historical
activation replay. The contract, direct lifecycle checks, PGlite composition,
and genuine-PostgreSQL readiness/activation paths prove the fail-closed
boundary without a new table, migration, transaction owner, activation owner,
route, or Standard live wiring.

Old attempts remain pinned to their activation revision. Once a replacement is
activated, an attempt pinned to the prior active head must fail/retry through
the existing active-head revalidation; it cannot publish under the new schema
by reinterpretation. Rolling back to an older schema is itself a new candidate
validation against current data, never a pointer-only reversal.

## Exact First-Cut Compatibility Rules

The first classifier is deliberately conservative. It may return
`universallyCompatible` only when it can prove that every value accepted by the
old table validator is accepted by the new one. Exact equality, adding an
optional object field, changing a required field to optional without changing
its validator, and adding a demonstrably new union branch are representative
safe cases. Unknown or complex subsumption is `requiresDataValidation`, not
safe-by-default.

Because app-document object validators are strict:

| Desired change | First-cut result |
| --- | --- |
| Add table or optional field | Universally compatible when stable-ID and index requirements agree |
| Remove an optional field | Requires data validation; any retained occurrence is incompatible |
| Add a required field | Requires data validation and normally fails until old-schema mutations backfill it |
| Required to optional | Universally compatible when the nested validator is unchanged |
| Widen a literal/union/type | Safe only when conservative subsumption proves it; otherwise scan |
| Tighten a validator or remove a union member | Requires data validation; incompatible rows block |
| Remove a populated table | Blocked while any live row remains; table deletion policy remains separate |
| Rename a field/table | Blocked without explicit rename intent; first app-document slice does not invent stable field IDs |
| Add/replace index or unique constraint | Uses the existing physical build/unique readiness owners in addition to row validation |

The first implementation does not invent business values. A required-field or
type-change remediation uses an ordinary bounded application/system mutation
while the old schema is still active, followed by a new plan/validation
attempt. A later managed backfill contract may automate only an explicitly
declared deterministic transformation with its own authority and receipts.

## Change Classification

Every schema diff receives one explicit class before anything is applied.

### Safe metadata activation

Examples:

- add a table;
- add an optional field;
- add a non-required relation whose target exists;
- widen a validator while preserving existing values;
- change presentation-only Payload metadata.

These may activate without a data backfill when catalog and compatibility
checks pass.

### Managed build and validation

Examples:

- add or replace a physical index;
- add uniqueness;
- add a required field with a deterministic accepted backfill;
- enable an edge or hidden block projection;
- replace a physical edge definition whose extraction, endpoint identity
  representation, localization/ordering representation, occurrence codec,
  projected facts, or edge-read keys changed;
- change an ordered-key codec or locale-aware physical definition;
- tighten a validator after an explicit data backfill.

Flarex creates a new immutable physical definition, runs a resumable build at a
pinned fence/watermark, validates authoritative data and derived sidecars, and
activates only when every required definition is ready. The old enabled schema
remains authoritative until the final activation transaction.

### Blocked or ambiguous

Examples:

- remove or narrow a populated field while rows remain incompatible;
- make a field required while rows are missing it;
- add uniqueness while duplicate values exist;
- change relation cardinality while current edges violate it;
- delete a referenced table or change delete behavior without proving policy;
- remove one name and add a similar name without explicit rename intent.

These changes fail closed with counts, representative non-sensitive evidence,
and a machine-readable remediation plan. A confirmation flag must not turn an
incompatible change into a destructive operation.

## Rename And Stable Identity

Names are not identities. A deploy cannot infer whether this diff:

```text
- posts.author
+ posts.creator
```

means rename or delete-plus-create. The schema source or deploy plan must carry
explicit rename intent. A confirmed rename preserves the stable table, field,
index, or relation identity when its semantic compatibility rules allow it.
Unconfirmed ambiguity blocks non-interactive deployment.

Exact CLI syntax remains deferred, but the contract must support both a
source-level `renameFrom`-style declaration and a CI-safe explicit rename map.
Agents must never be required to answer an interactive prompt.

## Relation Definition Activation

A stable logical `relation_id` does not authorize reinterpretation of existing
edges after a semantic change. R01 first classifies whether the new immutable
semantic definition can reuse its existing physical edge definition or requires
a replacement. Managed deployment must:

```text
bind the replacement semantic definition
  -> bind a proven-compatible existing edge definition
     or allocate a replacement physical edge definition
  -> retain the old active semantic/physical binding
  -> when physical identity changed, populate replacement current edges from
     authoritative rows
  -> validate counts, canonical occurrence evidence, collisions, and policy
  -> mark every required replacement build ready for each affected scope
  -> atomically switch the semantic and physical schema binding
  -> retain old semantic artifacts and replaced physical definitions until
     rollback, active-attempt, and dependency floors permit retirement
```

Old and replacement edges may therefore coexist under different immutable
physical identities. A backfill must not update old edge rows in place or let
new mutations cross-delete occurrences owned by the other physical definition.
The active schema binding selects the semantic definition and physical edge
binding used by new reads and writes. Attempts already pinned to an older schema
must never reinterpret themselves through the new binding. The first
app-document cut requires stale attempts to fail/retry after activation;
relation work may not weaken that rule merely because an old physical edge
definition remains retained.

An additive relation is safe metadata activation only when it requires no
derived edge population for already-valid rows and no new read/delete
enforcement. Otherwise it is a managed build. Retargeting, cardinality,
localization, ordering, occurrence-codec, on-delete, requiredness, and
extraction-plan changes require explicit compatibility classification even when
the developer-facing relation name and stable `relation_id` are preserved.
Policy-only changes may reuse the physical edge definition after validation;
physical extraction/read-key changes may not.

## App, Payload, And Medusa Boundaries

App and ordinary Payload collection fields live in shared typed row JSON, so a
logical field add/remove usually does not require `ALTER TABLE` on a
developer-named physical table. The managed work is schema validation plus any
index, unique, edge, block, or codec build. Payload lifecycle tables still need
their own adapter-owned plans.

Medusa remains genuinely relational. Medusa module/DML changes may require real
Postgres DDL and data migrations, but Flarex should compile and execute those
internal migrations from Medusa's real schema/migration inputs. It must not
pretend an app-row schema diff can replace Medusa repository and module
migration semantics.

## AI And Tooling Contract

The plan is a versioned data structure before it is terminal prose. It includes:

```text
base active schema identity and checksum
submitted schema identity and checksum
stable-ID binding and explicit rename decisions
ordered change operations and safety class
required builds/backfills/validations
blocking incompatibility codes and bounded evidence
activation and rollback prerequisites
```

Human and AI tooling may render that plan, but cannot reinterpret it. Planning
is read-only. Applying revalidates the active schema, catalog frontiers, data
watermark, and plan digest so a stale plan cannot activate.

Diagnostics should state the exact incompatibility and safe next actions, for
example: keep a field optional, run a named backfill, remove incompatible
values, declare a rename, or split the change into expand/backfill/contract
deployments.

## M05 Retirement And Purge Preflight

`M05-P` is complete as a design preflight. It rejects a broad "delete old
schemas" operation. Retirement, workspace reclamation, and purge are different
operations with different authority:

- **retirement** makes an obsolete physical definition ineligible for new
  selection or maintenance while retaining its committed evidence;
- **workspace reclamation** deletes rebuildable, non-enabled coordinator state
  that cannot currently confer readiness or activation authority; and
- **purge** irreversibly deletes physical current rows, revision history,
  claims, artifacts, or immutable evidence.

The current catalog and target state divide as follows:

| State | M05 policy |
| --- | --- |
| Active schema/application heads and the current non-active candidate-validation head | Never infer retirement. These are current selection or validation authority. |
| Immutable schema artifacts, schema-version bindings, application revisions, readiness receipts, activation revisions, and activation history | Retain. They are audit, replay, cold-materialization, and rollback evidence, not cleanup workspace. A separate evidence-retention policy may later prove a bounded deletion rule. |
| `fx_system_unique_constraint_set_build` rows in `declared`, `building`, `backfilling`, or `validating` | Eligible only for the narrow `M05-A` workspace-reclamation rule below. |
| Enabled unique-set builds and enabled developer-index builds | Retain until the exact rollback and admitted-attempt floors prove that no old revision can be selected or resumed. |
| Unique claims, developer-index current entries, and their revision histories | Retain until `O11` has advanced a mutually safe row/index/feed history floor. |
| Candidate-validation progress | It is already one scope-local slot that exact candidate installation supersedes in place; it is not a separate accumulating purge target. |
| Catalog definitions and schema-version bindings | Retain while any immutable artifact, application revision, readiness receipt, activation record, active/candidate selection, or retained physical evidence refers to them. Foreign-key reachability alone is not cleanup authority. |

The immediate pressure is the bounded unique-set build directory: it admits at
most 32 schema-version build rows per scope, and sanctioned point commits fail
closed if that directory is exceeded. Raising the ceiling would postpone the
problem and increase commit-lane work; it is not the accepted fix.

The first implementation-bearing checkpoint may therefore be only `M05-A`:
reclaim one explicitly identified superseded, non-enabled unique-set build row.
Under the existing scope-clock-first transaction order, the operation must:

1. authenticate the exact control database, located target, scope authority,
   and requested schema-version identity through a private capability;
2. lock the scope clock and the bounded build directory, then re-read the
   active application schema and current candidate-validation head in the same
   transaction;
3. refuse the active schema, the current candidate schema, every `enabled`
   build, a changed row, an authority mismatch, and every ambiguous
   composition;
4. delete only the exact non-enabled build-workspace row. It must not delete
   definitions, bindings, unique claims, index entries, app-row history,
   readiness/activation evidence, or R2 artifacts;
5. return an exact `already_absent` replay for an authenticated request when the
   row is already absent, fail closed on concurrent replacement, and preserve
   the existing reconciliation path so a later explicit submission can rebuild
   from retained authoritative rows; and
6. use no `CASCADE`, fallback, inferred age threshold, automatic oldest-row
   eviction, public route, CLI, production trigger, or second transaction/
   commit owner.

`M05-A` requires direct PGlite and genuine-PostgreSQL proof for active and
candidate refusal, every non-enabled lifecycle, enabled refusal, exact replay,
concurrent reconciliation, confirmed rollback, decision uncertainty, the
31/32-row directory boundary, and a subsequent rebuild from retained rows. It
needs no schema migration unless implementation evidence proves otherwise; a
new migration would require a separate preflight.

`M05-A` is complete at this private checkpoint. One operation authenticated by
the existing exact unique-set eligibility capability reclaims only an
explicitly selected `declared`, `building`, `backfilling`, or `validating`
unique-set build-workspace row. Its located transaction retains the existing
scope-clock-first order, locks the bounded build directory, re-reads active and
candidate selection, verifies the exact stored build authority, and refuses
active, current-candidate, enabled, corrupt, stale, or ambiguous state. Exact
absence replays, and a lost transaction response is resolved only by a second
authority-checked absence observation. Direct PGlite and genuine-PostgreSQL
coverage proves the refusal matrix, every eligible lifecycle, replay,
concurrent reconciliation, rollback, uncertainty, directory-slot recovery,
retained claims/catalog authority, and rebuild. No schema, migration, public
API, CLI, route, trigger, automatic eviction, `CASCADE`, definition retirement,
or physical/evidence purge was added.

### Private Supersession Reclamation

The accepted automatic shape is not a timer, oldest-row policy, or general
background garbage collector. A post-install callback is also insufficient:
if candidate installation commits and its response is lost before a separate
reclamation call, replay observes only the new candidate head and no longer has
authenticated authority to infer which displaced candidate should be cleaned.

`M05-A2` therefore makes workspace reclamation automatic only as part of the
private managed-schema candidate-supersession operation. It must:

1. authenticate the existing planning/application composition, candidate-
   validation authority, and exact unique-set reclamation authority before
   target mutation;
2. prepare an opaque reclamation claim for the exact candidate head observed
   before supersession, including its schema-version and immutable closure
   authority, without exposing a caller-forgeable schema choice;
3. under the existing scope-clock-first target transaction, re-read and lock
   that exact candidate head, refuse drift, install the new candidate head, and
   reclaim the displaced build workspace atomically only when it is absent or
   non-enabled and is neither the active schema nor another current authority;
4. retain enabled builds and every immutable definition, binding, claim,
   sidecar, app-row, readiness, activation, and R2 artifact body;
5. make committed replay and decision-uncertainty recovery derive only from
   the resulting authoritative head/build state, so a lost response cannot
   cause a guessed second cleanup; and
6. preserve the standalone exact `M05-A` operation for explicit private
   recovery while adding no public route, CLI, scheduler, age scan, directory
   scan, `CASCADE`, second transaction/commit owner, retirement, or purge.

This is the first automatic behavior allowed by M05: one exact cleanup caused
by one authenticated private supersession. It is not periodic maintenance and
does not make enabled-definition retirement or physical purge automatic.
Implementation requires direct PGlite and genuine-PostgreSQL proof for atomic
install/delete, absent and enabled displaced builds, active-schema retention,
head drift, rollback after each write, committed lost-response replay, directory
slot recovery, and exact composition rejection. The implementation preflight
must prefer a narrow transaction-composition owner over a callback that lets
the managed-schema coordinator inject arbitrary work into candidate-validation
transactions.

`M05-A2` is complete at this private checkpoint. Candidate installation now
prepares an opaque install claim, observes the exact displaced candidate head,
and authenticates the candidate-validation and unique-set capabilities as one
control/target composition. The target transaction rechecks that head under
the existing scope-clock lock, installs its replacement, and deletes only the
displaced non-enabled build row. Drift rejects before mutation; absent
workspaces replay as absent; active and enabled workspaces are retained; corrupt
or unclosed authority with a surviving row fails closed. The exact build-
directory ceiling remains intact and the reclaimed slot can be used by ordinary
reconciliation. PGlite and genuine-PostgreSQL coverage exercise atomic
supersession/reclamation, both rollback points, lost-response cold replay, head
movement, absence, active/enabled retention, directory-slot recovery, and
opaque composition rejection. The standalone `M05-A` recovery operation is
unchanged. No schema, migration, timer, scheduler, callback extension point,
public route, CLI, retirement, or physical/evidence purge was added.

Enabled-build retirement and physical purge remain deferred. Before either can
be approved, all of the following must exist and compose exactly:

- fully implemented `O11` active-snapshot retention and persisted
  `oldest_available_commit_seq`, with mutually safe row/index/feed compaction;
  the private owner pages, durable checkpoint, bounded runner, and manual
  adapter are complete, while scheduled production activation and deployed
  cadence/operability evidence remain deliberately deferred, so this gate is
  not yet a production-retirement clearance;
- roadmap 21's accepted reconnect identity, expiry/reset contract, retention
  DDL, and reconnect floor consumer;
- an explicit rollback-retention policy that says when an inactive application
  revision and its readiness evidence cease to be selectable;
- an admitted-attempt/lease floor proving no running execution remains pinned
  to the old schema or physical definition;
- adapter retention gates for every supported private or future public
  consumer; and
- an evidence-retention decision for immutable schema, readiness, activation,
  and cold-materialization records.

After those gates, a separately approved `M05-B` may add logical physical-
definition retirement. A later `M05-C` may add dependency-ordered, bounded,
resumable physical purge. Neither may use foreign-key cascades, reinterpret
compacted history as absence, delete PostgreSQL references before R2/evidence
policy permits it, or combine audit-evidence deletion with sidecar compaction.

## Ordered Turn Sequence

These are separate later goals, not one giant deployment goal:

1. `M01-A` - **complete**: create the private `@flarex/managed-schema` domain package,
   machine-enforce its inward-only dependency boundary, and freeze a pure
   conservative app-document schema diff and compatibility-classification
   contract over two authenticated immutable schema artifacts. Include direct
   table-driven and bounded generated safety tests. It creates no storage and
   cannot declare an unknown validator transformation universally compatible.
2. `M01-B` - **complete**: freeze the candidate row-validation progress,
   failure evidence, and final receipt contracts plus count/byte/page/time
   ceilings. Settle exact corruption, supersession, interruption, rollback,
   and uncertainty errors before DDL. This is a private protocol-only contract;
   it creates no table, repository, scanner, or runtime authority.
3. `M02` - **complete**: implement read-only planning with explicit rename maps, bounded
   non-sensitive incompatibility evidence, remediation actions, active-schema
   and data-frontier pins, and stale-plan identity.
4. `M03-A` - **complete**: add the guarded target-local single non-active schema-validation
   head and bounded exact-frontier scanner. This is one new schema/migration
   owner and requires PGlite plus genuine-PostgreSQL fresh/upgrade/replay/
   refusal/rollback/concurrency evidence.
5. `M03-B` - **complete**: integrate one authenticated candidate-validation capability into
   the existing point-commit transaction. It validates only final material
   rows, marks an incompatible candidate failed without rejecting an
   active-valid write, preserves the current transaction/OCC/commit owners,
   and proves same-table/cross-table multi-row rollback and bounded work.
6. `M03-C` - **complete**: make application readiness require the exact schema-validation
   receipt and let the existing activation CAS consume it. Reprove index,
   unique, runtime, cold-load, activation, stale-attempt, replay, rollback, and
   uncertainty behavior without a second active-schema authority.
7. `M03-D` - **complete; schemas A through G and all nine acceptance items**: extend `@flarex/system-test`
   with a separate current-generation multi-revision cooking scenario. The
   schema-A baseline, schema-B removal/remediation cut, and schema-C required-
   field/backfill, nested-validator-tightening, concurrent-write, recovery/
   concurrent-activation, and stale-attempt publication-fence cuts are complete
   in both PGlite and genuine PostgreSQL. Historical
   single-revision runners remain unchanged and are not fallback or comparison
   authorities.
8. `M04-A` - **complete and private**: the current-generation read-only planning
   composition authenticates exact publication, active-schema, schema-artifact,
   scope-frontier, control, and target identities and returns the canonical plan
   plus an opaque exact-plan handle. `M04-B` is **complete and private** with
   matching PGlite and genuine-PostgreSQL proof. Its bounded resumable
   coordinator consumes only that handle and delegates every validation/build/
   readiness/activation transition to the existing owner. `M04-C` is
   **complete and private**: `flarex-dev` delegates to those exact services and
   exposes one detached JSON projection proven through the connected schema-B
   scenario in PGlite and genuine PostgreSQL. Do not reinterpret the existing
   deployment-push finish operation as managed apply or add a public/production
   route before those private checkpoints pass.
9. `M05-P` - **complete preflight; no destructive cleanup authorized**:
   separate non-enabled build-workspace reclamation from logical retirement and
   irreversible purge.
10. `M05-A` - **complete and private**: reclaim one exact superseded,
    non-enabled unique-set build-workspace row through the existing authority
    and transaction owners. Enabled-build retirement and physical purge remain
    blocked on the explicit rollback, active-attempt, `O11`, reconnect,
    adapter, and evidence-retention gates above.
11. `M05-A2` - **complete and private**: exact workspace reclamation composes
    atomically with private candidate supersession, so lost responses cannot
    lose or guess the displaced schema identity. This checkpoint adds no timer,
    scheduler, public deployment trigger, enabled-build retirement, or
    physical/evidence purge.

The current FlarexDB foundation continues in its existing narrow order. These
goals do not authorize public CLI work, cloud deployment, or destructive schema
changes during current codec/catalog slices.

`M01-A`, `M01-B`, `M02`, and production-inert `M03-A` through `M03-C` are
complete. Roadmap 49's `AA-R6` through `AA-R8` replacement, private proof, and
retirement gates are also complete. `M03-D` is complete over those accepted
current owners. It added no managed-schema protocol, schema, migration,
transaction, readiness, activation, or runtime owner and did not revive a
displaced runner, add dual selection or fallback, or create another
active-schema authority, route, trigger, public deployment path, or production
generation cut.

## Multi-Revision Cooking Acceptance Matrix

`M03-D` is complete only when the same scenario passes in PGlite and genuine
PostgreSQL through real analysis, schema publication, readiness, activation,
Workerd execution, journal/OCC/commit, and authoritative inspection:

1. activate schema A with optional `description` and seed rows both with and
   without the field;
2. plan schema B that removes `description`; prove the populated row blocks B,
   B never activates, and schema-A reads/writes continue;
3. remove the field through a normal schema-A mutation, submit B again, finish
   candidate validation, and atomically activate B;
4. prove a schema-B mutation cannot reintroduce `description`;
5. submit schema C with required `slug`; prove rows missing `slug` block it,
   backfill through ordinary schema-B mutations, then validate and activate C;
6. tighten a nested validator and prove bounded incompatibility evidence names
   the table/path without exposing the document body;
7. pause validation after a non-null cursor, commit one candidate-valid row and
   one active-valid/candidate-invalid row, and prove respectively that progress
   remains sound and the candidate fails atomically while both active-valid
   commits publish normally;
8. prove supersession, exact replay, cold reload, corruption rejection,
   confirmed rollback, decision uncertainty, and concurrent activation; and
9. start an attempt under the old active revision, activate the replacement,
   and prove the stale attempt cannot publish without an ordinary owner-driven
   retry under the new revision.

The scenario must inspect active schema/application revision, validation head
and receipt, app revisions/current rows, index and unique sidecars, outcomes,
feed, and outbox. It must not inspect or mutate raw authority tables through an
application-facing API, and it must not use a test-owned row scanner,
validator, readiness receipt, activation pointer, or commit path.

## Known Limitations

- Exact public command names and schema-DSL rename syntax are not frozen.
- Arbitrary data transformations still require an ordinary bounded
  application/system backfill function; "no migration files" does not imply
  that Flarex can invent business transformations.
- Relation compatibility depends on `R01`/`R02`; Payload lifecycle parity and
  Medusa migration compilation remain separate source-driven plans.
- The current schema manifest has stable table and logical-index identities but
  no stable field catalog. The first classifier uses validator paths and
  explicit rename intent; it does not pretend a field rename already has a
  durable `field_id`.
- Application Analysis migration may replace application-revision, readiness,
  and activation contract generations. Candidate row validation must therefore
  remain schema-version/scope authority and expose a narrow receipt consumer,
  rather than foreign-keying its lifecycle to the displaced static-verifier
  generation.
- Real Postgres remains mandatory for DDL locks, concurrent builds,
  constraints, isolation, activation, and rollback proofs.
