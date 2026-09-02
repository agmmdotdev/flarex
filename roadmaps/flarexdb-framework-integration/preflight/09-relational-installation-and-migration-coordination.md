# Relational Installation And Migration Coordination Preflight

Status: accepted; checkpoint 1 private pure values and goldens implemented;
checkpoint 2 exact metadata/repository contract accepted separately and its
additive private metadata DDL, focused PGlite catalog evidence, stored
restoration, target/collision repository family, physical-name assignment
repository family, migration-plan aggregate repository family, and
plan-admission aggregate repository family implemented; later repositories
remain pending; no target
session, generated relational DDL, runtime caller, binding, or activation is
implemented

Last reviewed: 2026-09-03

## Decision

The next shared-core owner is a private, target-local relational installation
and structural migration domain. It consumes one already-admitted
`FrameworkSchemaArtifact` whose payload is an exact normalized
`RelationalSchema`, lowers that desired value into a deterministic PostgreSQL
physical layout and expansion-only plan, coordinates the plan under one stable
physical collision domain, and publishes immutable installation and readiness
evidence plus a separately mutable availability history/head.

This record deliberately stops before binding. The Application-owned coherent
projection, `PayloadContentOverlay`, `FrameworkSchemaBinding`, `DataBindingSet`,
framework activation head, and serving admission are the following checkpoint.
The first synthetic `system` installation proof therefore reaches authenticated
readiness and availability but is never activated or served. The initial
`DataBindingSet` has no generic `system` slot.

The first eventual execution proof admits only a synthetic `system` structural
artifact. The accepted Currency value may be used as a pure lowering fixture,
but this record does not compile live Medusa source, promote a Medusa package,
run Currency seed data, or create a commerce binding.

## Reconciled Existing Authorities

| Concern | Current owner | Decision for this domain |
| --- | --- | --- |
| Desired framework artifact | private `frameworkSchema/artifact` control repository | Consume the immutable identity and authenticated bytes; do not extend the artifact repository into target execution. |
| Relational desired value | private `relationalSchema` normalizer and artifact composer | Decode only the exact admitted codec and preserve it as desired semantic state. |
| Platform schema migrations | checked-in Drizzle migration tree and `FlarexPersistence.migrate()` | Keep unchanged. Static platform migrations create the coordinator's metadata tables in every schema that receives the current common tree; table presence is not authority, and generated framework plans never enter the Drizzle journal. |
| Application schema/build/readiness/activation | Application foundation owners | Reuse no rows, heads, receipts, or nominal capabilities. Their patterns are evidence, not generic framework storage. |
| Scope placement | `ScopePhysicalLocator` capture/equality and trusted host resolvers | Reuse exact locator policy and target-composition checks. A decoded locator never selects or redirects a database by itself. |
| Scope transaction fencing | scope clock and `ScopeExecution` | Reserve for later binding and data operations. Installation may serve several scopes and is not keyed by one scope clock. |
| Artifact control session | artifact-private control-session owner | Do not reuse as a migration host. It owns one short admission and one recovery, not a durable multi-step target plan. |
| Existing leases and schedulers | their scheduler, task, session, or retention owners | Reuse database-time, monotonic-fence, CAS, and settlement lessons only. Do not reuse their keys, handles, tables, errors, or lifecycle authority. |
| Transaction settlement helpers | package-owned Effect transaction/failure primitives | Reuse only where their exact callback, `Cause`, rollback, interruption, and cleanup semantics fit the new dedicated migration session. |

No existing type or table can be renamed into this coordinator. The new owner
belongs privately under the persistence package only after the implementation
checkpoint that introduces it.

## Cycle-Free Identity Graph

The identity order is fixed:

```text
admitted FrameworkSchemaArtifact identity
  + exact captured physical locator
  + host-authenticated canonical target namespace
  + optional base installation identity
  + physical-lowering and execution profiles
        |
        v
canonical MigrationPlan -> migrationPlanSha256
        |
        v
FrameworkSchemaInstallationIdentity
  = artifact identity + locator + target namespace + migrationPlanSha256
        |
        v
installation receipt -> readiness receipt -> availability history/head
```

A migration plan never contains its candidate installation identity. Doing so
would make the plan digest depend on the installation digest while the
installation digest already depends on the plan digest. The plan targets the
candidate artifact, locator, and authenticated target namespace, with an
optional base installation, and the installation identity is derived only
after the plan digest exists.

The base installation means "the exact prior physical proof used while
planning." It is not an active binding and does not assert that any scope still
selects that installation. A non-null base must resolve to authenticated
installation and readiness receipts for the same deployment, canonical
physical-database identity, schema name, captured locator, owner, lineage, and
physical namespace profile. Plan admission re-observes its required structure
and name assignments under the collision head. A quarantined base or any
mismatch is rejected. `null` means a fresh plan and cannot claim retained
candidate history.

Every value frame uses one plain contract name with its own persisted
`format` and numeric `version`. Chronological suffixes are not used in domain
type names. The first frame formats are reserved as:

- `flarex.relational-physical-layout`, version `1`;
- `flarex.framework-schema-target-namespace`, version `1`;
- `flarex.relational-physical-name`, version `1`;
- `flarex.relational-physical-name-assignment`, version `1`;
- `flarex.framework-migration-plan`, version `1`;
- `flarex.framework-migration-plan-admission`, version `1`;
- `flarex.framework-migration-collision-head`, version `1`;
- `flarex.framework-migration-attempt-start`, version `1`;
- `flarex.framework-migration-step-receipt`, version `1`;
- `flarex.framework-migration-attempt-terminal`, version `1`;
- `flarex.framework-migration-event`, version `1`;
- `flarex.framework-schema-installation`, version `1`;
- `flarex.framework-schema-readiness`, version `1`;
- `flarex.framework-schema-availability-history`, version `1`; and
- `flarex.framework-schema-availability-head`, version `1`.

The implementation checkpoint must freeze exact field sets, bounds, brands,
canonical preimages, and golden digests before any persistence or SQL work.
The existing framework artifact remains the sole owner of desired-state bytes
and identity; none of these frames rehashes the artifact payload as a competing
artifact.

## Target And Migration Collision Domain

The stable migration collision domain is:

```text
deploymentId
+ host-authenticated canonical physical database identity
+ exact physical schema name
+ framework owner
+ lineageId
+ physical namespace profile
```

The complete captured `ScopePhysicalLocator` remains authenticated plan and
target-composition evidence, but it is not sufficient as the collision key.
Its kind and database key are logical routing names and two logical locators
may alias one PostgreSQL database. The opaque target must therefore issue a
stable canonical physical-database identity, equal for every alias of the same
database, and bind it to the exact schema name before planning or claim. A
caller-provided locator or database identity cannot mint that fact.

The persisted target-namespace frame is comparison data, not connection or
routing authority. Checkpoint 1 may construct inert fixture frames and golden
digests, but only the later opaque target composition may authenticate and
issue the value for plan admission; execution revalidates it against the live
target capability.

The artifact digest, candidate installation digest, and plan digest are not in
the collision-domain key. Two different candidates for the same owner/lineage
physical namespace must serialize rather than acquire independent leases and
execute competing DDL.

One physical installation may support several scopes when they share its exact
locator and authenticated target namespace. Scope ID, scope epoch, storage-
generation fence, and scope commit sequence therefore do not identify an
installation claim. Those values return later when a scope binds or executes
data operations.

The first physical namespace profile is stable and in-place for one
deployment/owner/lineage at one authenticated target namespace. Physical
definition names remain stable across artifact revisions. Expansion may add
compatible objects while old objects remain. An installation's
`installedStructureSha256` hashes the
candidate-scoped required-structure projection observed in PostgreSQL, not the
entire database schema. Compatible retained objects from older candidates are
excluded from that projection, so their presence does not invalidate the new
receipt.

Changing the physical meaning of an existing stable definition identity is a
planning failure. The planner does not infer a rename, cast, replacement, or
drop. A new identity means a new object; retirement and destructive contraction
remain blocked until later binding-retirement evidence proves that no active
selection needs the old structure.

## Artifact And Owner Admission

The relational lowerer accepts only an authenticated framework artifact with:

- codec format `flarex.relational-schema` and version `1`;
- owner `system` or `medusa`;
- exact equality between the artifact owner/lineage and the embedded relational
  coordinate;
- exact outer capability IDs derived by the relational artifact composer;
- valid outer provenance and dependency evidence; and
- a payload that independently normalizes to the same owned `RelationalSchema`.

The first target-execution profile narrows this further to owner `system`,
synthetic provenance, no dependencies, and a fresh install with no base
installation. This is a target admission profile, not a weakening of the
general artifact codec. It does not prohibit checkpoint-1 pure lowerer tests
from using the already accepted inert Currency value as input evidence; that
fixture cannot be admitted as a target plan or produce installation evidence.

Payload content never enters this lowerer. A future Payload lifecycle artifact
requires its own exact codec and runner preflight. Application remains outside
the generic framework artifact lifecycle. Medusa owner values remain inert
fixtures until the package-promotion and adapter gates authorize a live
producer.

## Deterministic PostgreSQL Physical Lowering

The lowerer is pure. It receives the authenticated relational value, deployment
identity, captured locator, host-authenticated target-namespace value, optional
base structure projection, and fixed profiles. It returns an immutable physical
layout and plan; it receives no database handle, ORM object, service, callback,
or SQL text.

### Identifier policy

Semantic relational IDs may contain up to 512 UTF-8 bytes and cannot become
PostgreSQL identifiers directly. Each semantic relational physical name is
derived from a
canonical `flarex.relational-physical-name` version `1` frame containing:

- deployment ID;
- owner and lineage;
- definition kind;
- complete stable semantic definition identity; and
- the physical namespace profile.

The frame's SHA-256 bytes are encoded as lowercase RFC 4648 base32hex without
padding, producing exactly 52 characters. The spelling receives one fixed
kind prefix:

| Object | Prefix | Maximum spelling |
| --- | --- | --- |
| table | `fxrt_` | 57 bytes |
| column | `fxrc_` | 57 bytes |
| primary/unique key | `fxrk_` | 57 bytes |
| index | `fxri_` | 57 bytes |
| foreign key | `fxrf_` | 57 bytes |
| check constraint | `fxrh_` | 57 bytes |

The locator's schema name remains locator-owned and is never replaced by a
semantic ID or by this name encoder. Every target relation is schema-qualified,
and every emitted identifier is quoted by the PostgreSQL runner even though
generated spellings are safe lowercase ASCII. Artifact, installation, or plan
digests are deliberately absent from physical-name preimages so stable
definitions retain names across candidates.

Platform-reserved identifiers are the explicit exception to semantic hashing.
The injected `scope_uuid` column, existing `fx_system_scope_clock`, and later
coordinator metadata tables/columns retain names owned by checked-in platform
migrations. They are never produced from semantic IDs and cannot be authored or
overridden by a framework artifact. The dynamically generated foreign-key
constraint from a relational table to the scope clock is not exempt: it uses
definition kind `scopeAuthorityForeignKey`, the stable table identity, and the
ordinary `fxrf_` name/assignment policy.

Two different canonical name preimages producing one spelling are a fatal
`physicalNameCollision`. The pure planner rejects collisions within the
candidate. Historical detection is target-owned: an immutable physical-name
assignment registry is keyed by canonical physical database identity, schema
name, and generated spelling and stores the exact canonical preimage bytes plus
their digest. Plan admission checks every requested assignment under the
collision head and inserts new assignments transactionally. A unique key over
the physical target namespace and spelling also serializes conflicts across
owners, lineages, and profiles; exact bytes replay, while any different bytes
for the same spelling fail before DDL. PostgreSQL catalogs alone cannot prove
the historical preimage. The planner never truncates, appends a counter,
retries with salt, or falls back to an authored SQL name.

### Platform-owned scope isolation

Every reserved relational row table receives one physical platform column
named `scope_uuid uuid NOT NULL`. It is not a semantic
`RelationalColumnDefinition`, cannot be selected as a framework field, and
references the target-local
`fx_system_scope_clock(scope_uuid)` with restricted update and delete. The
injected FK's deterministic physical name, assignment, and exact catalog
projection are part of the layout even though the column and referenced
platform table use reserved literal names.

The lowerer injects scope isolation into every structure:

- a semantic primary key becomes `(scope_uuid, ...semantic columns)`;
- every semantic unique key becomes `(scope_uuid, ...semantic columns)`;
- every B-tree index begins with `scope_uuid` before its semantic columns;
- a foreign key becomes `(scope_uuid, ...source columns)` referencing
  `(scope_uuid, ...target columns)`; and
- index predicates and checks may inspect admitted semantic columns but never
  remove or substitute the scope prefix.

This applies to shared-database, schema-per-scope, and database-per-scope
locators. Redundant-looking isolation in a split profile is intentional: one
physical rule and one catalog proof prevent a later topology change from
silently weakening row authority.

No semantic default, input, repository filter, or optional application
predicate supplies `scope_uuid`. A later owner-scoped transaction capability
binds it from authenticated scope authority. Before DML it must authenticate a
scope-clock row with a non-null Flarex scope UUID and
`storageGeneration = flarexdb_v1`; logical scope identity or a nullable clock
projection is insufficient.

### First structural mapping

| Relational value | PostgreSQL physical requirement |
| --- | --- |
| `text` | `text` |
| `integer` | signed PostgreSQL `integer` |
| `numeric` | PostgreSQL `numeric` preserving the admitted exact literal contract |
| `jsonb` | non-SQL-null `jsonb` when the semantic column is non-null; JSON `null` remains distinct from SQL `NULL` |
| `timestamptz` | `timestamp with time zone` |
| `none` default | no default clause |
| text/integer/exact-numeric defaults | one literal emitted only by the trusted physical encoder |
| exact raw numeric default | the exact canonical `{ value, precision }` JSONB representation |
| current timestamp default | database-current timestamp expression, never caller time |
| primary/unique key | scope-qualified key using stable physical columns |
| B-tree index | scope-prefixed B-tree index in declared semantic column order |
| `isNull` predicate | exact `IS NULL` predicate on the admitted physical column |
| integer range | bounded check preserving null semantics of the admitted column |
| foreign key | scope-qualified, equal-arity, restrict/update-restrict foreign key |
| `manyToOne` / `oneToOne` | no second relationship object; authenticated evidence points to the exact FK and, for one-to-one, its source uniqueness |

The physical encoder is exhaustive over the admitted value union. It does not
accept authored SQL fragments or use unvalidated semantic text as an
identifier. Adding a column type, default, predicate, constraint action, index
kind, or relationship kind requires a new value-contract and lowerer gate.

## Physical Evidence Versus Runtime Semantics

A schema capability may contain both physical requirements and later runtime
behavior. DDL must not mint behavioral compatibility that it cannot prove.

| Relational capability | Installation may prove | Remains for a later owner |
| --- | --- | --- |
| searchable text | referenced columns exist and are `text` | exact query operators, normalization, ordering, and performance contract |
| exact numeric companion | numeric/raw columns, defaults, nullability, and pairing identity exist | paired-write synchronization, conversion, and repository result behavior |
| managed timestamps | created/updated columns and database-current defaults exist | exact update-refresh policy and repository mutation behavior |
| soft delete | deleted-at column and exact active-row partial index exist | delete/restore mutations and default query visibility |

Installation and readiness frames therefore carry per-capability physical
evidence plus a residual requirement classification. The structural chain is:

```text
required physical evidence
  subset of validated physical evidence
  subset of installed physical evidence
  subset of artifact-declared capability requirements
```

The later binding preflight must separately authenticate the adapter/query/store
profile that satisfies residual requirements. The earlier shorthand
`required ⊆ validated ⊆ installed ⊆ artifact-declared` is valid only for the
physical facet and must not be used as full Payload or Medusa compatibility.

## Structural Migration Plan

Each semantic migration family keeps its own plan producer and operation
meaning. The common coordinator owns only a bounded envelope:

- migration collision domain;
- exact candidate artifact, locator, and authenticated target namespace;
- optional base installation;
- lowerer, naming, isolation, and runner profiles;
- expected candidate-scoped physical-layout digest;
- deterministic step IDs, step digests, and dependencies;
- phase and transaction mode;
- bounded precondition and postcondition digests;
- required execution-capability profile;
- replay and checkpoint policy; and
- a typed operation codec plus inert operation value.

The coordinator never receives an executable callback from a plan. A trusted
composition root registers fixed runner tokens for admitted operation codecs.
The token and its implementation remain in a module-local authority map; a
decoded object cannot forge a runner or transaction.

The first structural runner admits only expansion and validation operation
codecs needed for a fresh synthetic installation:

- create one exact scope-isolated table per table step;
- create one exact ordinary B-tree index per index step;
- add one exact foreign key step after both referenced table steps exist; and
- inspect and validate one exact candidate structure projection.

Primary/unique keys and integer-range checks are part of the exact table
operation. A codec may occur in multiple deterministic steps within the
aggregate plan bounds frozen by checkpoint 1; "one" describes the atomic step,
not a one-table plan. Relationships contribute evidence but no duplicate DDL.
The first profile supports only transaction-bound PostgreSQL DDL. Concurrent index
creation, nontransactional DDL, table rewrite, backfill, seed data, drop,
rename, cast, trigger, function, extension, arbitrary check expression, and
user callback are rejected.

Later compatible expansion, bounded data transformation, and contraction
require their own runner profiles. A profile appearing in Payload or Medusa
source does not make it a common coordinator operation.

## Physical Migration Versus Scope Data Initialization

Physical installation is keyed by locator/owner/lineage and may serve many
scopes. Framework data initialization is different:

- Currency's future 123-row baseline is scope-bound Medusa data work;
- Payload lifecycle/data transformations may be scope- or binding-bound; and
- ordinary application migrations remain Application-owned.

Those operations may later reuse exact coordinator fencing or receipt
mechanics only after their own identity and transaction preflights. They do not
enter this physical installation plan or its readiness receipt. In particular,
structural Currency readiness cannot claim that the initial dataset exists.

Platform, Application, Payload, and Medusa plans remain separate families. No
single giant step union or compatibility classifier is authorized.

## Control And Target Placement

This table records logical authority and authorized repository use. It does not
claim that the common static migration tree omits unused tables from another
schema.

| Evidence | Authorized repository/authority | Reason |
| --- | --- | --- |
| Framework artifact bytes and dependencies | control authority | Immutable desired-state registry already exists there. |
| Captured migration plan bytes/digest | target-authorized coordinator repository after trusted preparation | Cold recovery must authenticate the exact executable plan without a distributed transaction. |
| Physical-name assignments | target-authorized coordinator repository | Exact historical preimages make generated-name collisions observable before DDL. |
| Collision-domain lease/head | target-authorized coordinator repository | It fences the database objects being changed. |
| Attempt and step receipts | target-authorized coordinator repository | They settle with the exact DDL transaction and survive host restart. |
| Installation/readiness receipts | target-authorized coordinator repository | They authenticate observed target structure. |
| Availability history/head | target-authorized coordinator repository | Activation and later serving must lock the same target-local status. |
| Application head and future framework binding head | their existing/later scope owners | They are not installation or migration state. |

The installer authenticates the control artifact before target work and stores
its exact identity in the target plan. It does not hold a control transaction
while executing target DDL. Target finalization does not claim that the control
artifact is transactionally current; artifacts are immutable, and later
selection decides whether a ready installation should be bound.

A target repository is selected only by a host-issued opaque target capability
whose hidden state contains the resolver, exact captured locator, database
identity, canonical physical-database identity, exact schema name, and
migration-capability profile. The composition root must issue the same
canonical identity for aliases of one physical database. Locator and identity
fields decoded from a plan are comparison evidence only.

The current checked-in platform migration tree is shared by control and located
target schemas. The checked-in coordinator metadata migration therefore
deliberately accepts duplicate physical presence of its tables wherever that
common tree is applied. Table presence grants no authority: only a future
target-side composition root may construct the opaque coordinator repository,
and it must authenticate the exact target capability above. The control
composition root receives no coordinator constructor. Splitting control and
target migration trees remains a separate, larger persistence-owner change and
is not authorized here.

## Software Capabilities And Database Roles

| Role/capability | May do | Must not do |
| --- | --- | --- |
| Platform migration capability | install coordinator and lifecycle metadata tables through checked-in migrations | execute generated framework plans or mark an installation ready |
| Framework planner | decode authenticated artifacts and create inert physical plans | connect to PostgreSQL or execute SQL |
| Framework migration target | claim a collision domain and execute admitted typed structural operations | serve runtime requests, allocate scope commits, or run framework callbacks |
| Readiness validator | inspect exact target catalogs and write authenticated structural receipts under the current fence | trust runner claims without observation or satisfy residual runtime semantics |
| Availability operator | append an authorized ready/withdrawn/superseded/quarantined transition and CAS the head | alter readiness, installation, artifact, or binding history |
| Runtime data capability | later execute owner-scoped store operations | DDL, migration claims, readiness publication, or availability changes |

For checkpoints 1 through 5, `FrameworkMigrationTarget` is a module-local
software capability, not a PostgreSQL login or grant boundary. Later local
PGlite and ordinary-role PostgreSQL lanes can prove typed runner, target
composition, and repository containment only; the current metadata-DDL receipt
proves none of those layers. Even the later lanes cannot prove that a leaked raw
connection is database-restricted. A separate mandatory hosted/production
preflight must own a dedicated PostgreSQL role or credential profile,
provisioning and rotation, `GRANT`/`REVOKE`, pool/Hyperdrive composition,
captured-schema restriction, and negative privilege tests. Until that passes,
no document may claim database-enforced migration-role isolation.

## Lease, Attempt, And Step State

The durable target model has one mutable collision-domain head and immutable
evidence beneath it:

```text
collision-domain head
  current plan digest
  current attempt identity
  monotonically increasing attempt fence
  lease owner and database-time expiry
  last authenticated event/receipt head

immutable plan
  -> immutable attempt-start evidence
      -> immutable exact step receipts
      -> immutable terminal attempt evidence
          -> immutable installation/readiness receipts

immutable availability history per installation
  -> one mutable availability CAS head keyed by exact installation identity
```

The claim row is never deleted and its fence never decreases. Claim and
takeover use database time. A new candidate for the same collision domain must
observe the current plan and may replace it only through an explicit authorized
supersession decision when no unexpired attempt owns the lane.

Lease expiry permits takeover between transactions; it is not permission to
run concurrently with an already locked step transaction. Every step:

1. opens a dedicated migration transaction on the exact target;
2. applies bounded local lock and statement timeouts;
3. locks the collision-domain head for update;
4. validates plan, attempt identity, fence, lease ownership, database-time
   expiry, role, and target composition;
5. authenticates immutable plan and dependency receipts;
6. executes exactly one admitted typed operation;
7. observes its exact postcondition inside the same transaction;
8. inserts one immutable step receipt or accepts an exact existing receipt;
9. advances the authenticated progress/event head; and
10. commits before releasing the connection.

A stale fence, replaced plan, lost lease, target mismatch, missing dependency,
or conflicting receipt prevents the runner from constructing SQL. A step that
began while owning the locked head may settle normally; takeover blocks on that
row, then observes the committed receipt or rollback before proceeding. The
coordinator never holds a transaction open across orchestration delays,
network calls, user code, framework hooks, or workflow pauses. Long future
backfills must be split into bounded independently receipted chunks.

## Replay, Interruption, And Uncertainty

Exact replay converges by plan and step digest. `IF NOT EXISTS` is not proof of
semantic equivalence: an existing PostgreSQL object must match the exact
candidate projection and receipt.

The dedicated migration session owns cancellation, query draining, rollback,
connection quarantine, and release. An interrupted or timed-out operation
cannot return while active SQL continues on a reusable connection. Unexpected
driver/platform failures retain their `Cause`; domain validation and stale
fences remain typed expected failures.

After a lost commit response, the original backend is discarded. One bounded
recovery on a distinct authenticated target session reads the exact step,
progress, and catalog evidence:

- exact receipt plus exact observed structure means the step committed;
- no receipt plus exact re-observation of the operation's original pre-state
  and absence of unexpected catalog facts means it rolled back and may be
  retried under a current fence;
- a postcondition without its required receipt, any partial or conflicting
  catalog state, a conflicting receipt, or unauthenticatable state is stored
  corruption/operator recovery, not an invitation to continue; and
- inability to settle before the recovery deadline returns
  `decisionUncertain`; it never blind-replays SQL.

Only errors explicitly classified as transient may retry, and only around the
same captured plan/step under a still-current fence. Deadlock and serialization
SQLSTATE policy is not inferred from another owner; it must be frozen and
proven for this coordinator before implementation acceptance.

## Installation, Readiness, And Availability

After every required structural step has an exact receipt, finalization runs
under the same collision-domain fence. The validator reconstructs the expected
candidate projection, independently inspects PostgreSQL catalogs, verifies
every physical capability facet, and requires exact equality with the expected
layout digest.

Only the trusted validator can create:

- an immutable installation receipt committing to artifact identity, locator,
  plan digest, observed required-structure digest, physical capability
  evidence, and database completion time; and
- an immutable readiness receipt committing to that installation, exact
  validation policy/digest, validated physical evidence, residual runtime
  requirements, and database validation time.

The domain runner cannot hand the coordinator a Boolean `ready` result.
Validation failure writes no readiness receipt. Lease loss, stale fence,
conflicting plan, missing receipt, or uncertain settlement likewise prevents
readiness publication.

Availability is a separate append-only history and one CAS head keyed by exact
installation identity, with statuses `ready`, `withdrawn`, `superseded`, and
`quarantined`. The first `ready` transition requires the exact readiness
receipt. Later transitions never edit installation or readiness evidence.
Corrupt bytes fail closed rather than normalizing into `quarantined`.

Readiness and availability still do not authorize serving. Binding activation
later must authenticate them on the exact target together with current scope
and Application evidence.

## Deferred Binding Boundary

This record reconciles but does not implement the next selection boundary:

- the existing Application head remains the only Application selector;
- the future coherent Application reference must be issued inside the
  caller's accepting transaction;
- `DataBindingSet` keeps named `application`, `payloadContent`,
  `payloadLifecycle`, and `commerce` slots;
- the initial set has no generic system slot and an empty cross-domain-reference
  collection;
- framework activation later locks scope clock, exact Application head,
  availability heads in canonical order, then the framework head; and
- runtime admission later re-resolves the target and revalidates the complete
  set inside the accepting transaction.

The next binding preflight must replace the earlier single capability-array
shorthand with exact physical evidence plus authenticated residual
adapter/query/store profiles. It must also freeze its remaining codecs,
repository, candidates/history/head, hint/re-read/restart policy, and genuine
PostgreSQL race proofs.

The later synthetic `system` transaction proof has no selection authority yet.
Before that proof, a separate preflight must choose either a specifically named
system slot with explicit product semantics or a non-serving test-only
selection capability minted by the trusted accepting-transaction fixture after
authenticating scope, target, installation, readiness, and availability. The
initial `DataBindingSet` cannot be used as if it already had a system slot, and
test selection cannot become a production binding or serving fallback.

## Persistence Direction

The coordinator cannot bootstrap its own ledger. The checked-in `0080` platform
migration adds only its bounded metadata tables through the existing Drizzle
runner. Because that tree is common, the tables are physically present wherever
it is applied; only a future authenticated target repository may use them. The
generated SQL, journal, and snapshot remain platform history. Framework-owned
physical tables are later installed only by the coordinator from admitted typed
plans; they never appear as generated Drizzle migrations.

Likely private domain placement is:

```text
packages/persistence-postgres/src/frameworkSchema/installation/
packages/persistence-postgres/src/migrationCoordination/
packages/persistence-postgres/src/relationalSchema/physical/
```

No root export, package export-map entry, workspace package, service singleton,
or public facade is authorized. Portable extraction waits for two real owners
to prove an identical contract.

## Effect And Lifecycle Ownership

- Pure physical capture, comparison, naming, canonical framing, planning, and
  stored-value decoding use `Result`.
- SQL sessions, timeouts, interruption, cancellation, transaction settlement,
  recovery, and repository orchestration use `Effect` with typed failures.
- Dynamic targets and migration transaction capabilities are scoped opaque
  values backed by module-local state, never structural interfaces or singleton
  `Context` values.
- A migration orchestration service or `Layer` is considered only when a real
  composition root exists; Layer construction never migrates automatically.
- Promise facades belong only at a later real operator/adapter host boundary.
- No `Effect.runPromise` is embedded inside core operations.
- Runtime startup, Worker construction, and adapter initialization never claim,
  resume, or auto-apply a migration.

## Failure And Result Policy

Expected outcomes remain results where appropriate:

- a held unexpired lease is `busy`, not corruption;
- missing progress is `pending`, not `Option`-encoded readiness;
- structurally incomplete validation is `not_ready` with a stable reason; and
- exact plan/step replay returns the existing receipt.

Typed migration failures distinguish at least invalid input, unsupported
artifact/owner/capability, target mismatch, base mismatch, physical-name
collision, plan conflict, stale fence, lease loss, dependency missing, step
conflict, validation failure, decision uncertainty, stored corruption, and
foreign resource failure. Authorization and validation failures are not
retryable. Unexpected defects and impossible platform results remain defects.

Error messages and stored receipts do not expose raw SQL, connection strings,
locator credentials, artifact payloads, or framework source objects.

## Evidence Matrix

### Design-only acceptance

This record must prove by inspection that it contains:

- a cycle-free artifact/plan/installation identity graph;
- a stable collision domain that serializes different candidates;
- alias-safe canonical physical-database identity plus exact schema identity;
- exact owner, target, and role boundaries;
- a bounded PostgreSQL name and collision policy;
- historical physical-name assignment evidence;
- scope injection into table/key/index/FK structure;
- a mapping for every admitted value-contract member;
- a physical-versus-runtime capability evidence split;
- distinct physical-installation and scope-data initialization identities;
- lease, attempt, step, recovery, readiness, and availability state models;
- a control-versus-target placement decision;
- explicit binding and activation deferral; and
- no implementation or production authority.

### Completed checkpoint-1 pure evidence

- Golden cross-process target-namespace, physical-layout, name-assignment,
  plan, ledger, installation, readiness, availability-history, and
  availability-head frames/digests.
- Input-order invariance without semantic column-order loss.
- Exact 57-byte identifier spellings, all definition kinds including the
  injected `scopeAuthorityForeignKey`, and synthetic name-collision rejection.
- Full physical lowering matrix, capability residual classification, and
  unsupported-vocabulary rejection.
- Scope-qualified primary, unique, index, and FK projection evidence.
- Exact replay versus changed-identity/changed-meaning conflict, including
  historical cross-plan physical-name collision.
- Caller detachment, recursive freezing, aggregate bounds, and corrupt stored
  frame rejection.

### Remaining PGlite coordinator evidence

PGlite is the functional lane only. The additive metadata slice proves its
migration, injected-fault rollback/retry, representative root invariants, and
root-row preservation across close/reopen. Topological rehydration and the
first target/collision, assignment, plan aggregate, and plan-admission
aggregate repository families are complete. The admission family takes
explicit restored current and nullable previous-plan handles, fully
reconstructs its stored dependency graph, and rejects corrupt or conflicting
replay without healing. Later slices must cover fresh synthetic installation,
interrupted
progress,
corrupt-ledger rejection, validation refusal, readiness, availability
transitions, then a separately admitted base-backed additive candidate that
retains the base structures. Unrelated catalog objects remain outside the
candidate projection; unregistered objects that conflict with a requested
assignment are rejected rather than adopted. PGlite makes no lock, concurrency,
lease-contention, PostgreSQL-catalog-plan, or production claim.

### Future genuine PostgreSQL evidence

Ordinary-role PostgreSQL is mandatory for:

- exact qualified object names and catalog projection;
- transaction behavior of every admitted DDL operation;
- two-scope uniqueness and foreign-key isolation;
- same-candidate convergence and different-candidate serialization on one
  collision domain;
- two logical locator aliases issued for one physical database/schema
  serializing on that same collision domain;
- independent collision domains proceeding without false blocking;
- lease expiry/takeover and stale-fence rejection;
- statement/lock timeout, interruption, cancellation, active-SQL drain,
  connection quarantine, and release;
- pre-/post-commit response loss and distinct-session authoritative recovery;
- rollback after every mutating phase;
- no readiness after validation, lease, fence, or settlement failure;
- target/control split cold recovery;
- installation/readiness/availability corruption rejection; and
- proof that platform/Application migration and activation paths remain
  unchanged.

Hosted Cloudflare, Hyperdrive, eviction, deployment, operator UX, scale, and
production routing remain later gates even after local PostgreSQL passes.

## Ordered Implementation Checkpoints

Each checkpoint requires a separate implementation approval:

1. **Pure physical and lifecycle values:** implement target-namespace,
   physical-name/layout, name-assignment, fresh structural plan,
   plan-admission, collision-head,
   attempt, step-receipt, terminal, event, installation, readiness,
   capability-evidence, availability-history, and per-installation
   availability-head frames with golden tests. Freeze their exact identities,
   bounds, canonical preimages, and digests. No SQL, repository, or target
   caller.
2. **Additive platform metadata DDL and private repositories:** the exact
   storage, cold-rehydration, and private-kernel contract is accepted in
   [`10-relational-coordinator-metadata-and-repositories.md`](./10-relational-coordinator-metadata-and-repositories.md).
   Implement its bounded slices through the checked-in Drizzle migration path.
   No relational target DDL yet.
3. **Target session and PGlite coordinator:** implement the opaque target,
   collision-domain claim, attempts, exact step receipts, structural runner,
   recovery, validation, readiness, and availability for one synthetic
   `system` artifact with no base.
4. **Base-backed additive PGlite candidate:** require the exact authenticated
   base receipts and matching target/owner/lineage/profile, re-observe the base
   under the collision head, retain its compatible structures, and reject
   mismatch, quarantine, unregistered conflict, or destructive change.
5. **Genuine PostgreSQL acceptance:** prove every DDL, contention, lease,
   timeout, interruption, uncertainty, recovery, catalog, and scope-isolation
   claim for both the fresh and base-backed profiles before the coordinator
   checkpoint completes.
6. **Application projection and binding preflight:** only then freeze and
   implement `DataBindingSet`, activation, and serving admission.
7. **Synthetic system selection preflight:** choose and prove one explicitly
   named system slot or one non-serving test-only accepting-transaction
   capability. Do not infer a generic slot or production fallback.
8. **Transaction and commit owners:** complete their mandatory preflights and
   synthetic reserved-relational data proof before any framework adapter.
9. **Framework consumers:** Payload preservation/proofs precede the first
   exact Medusa package promotion and Currency candidate.

Later checkpoints do not become authorized because this design record exists.

### Checkpoint 1 implementation receipt

Status on 2026-09-02: complete as a private, production-inert pure-value
checkpoint.

The implementation freezes:

- host-comparison target namespace values without logical locator aliases in
  their identity;
- deterministic 57-byte physical names, exact historical name assignments,
  scope-isolated physical layouts, and the full admitted relational lowering
  matrix;
- one fresh synthetic-system structural plan with typed inert operations,
  deterministic dependencies, preconditions, postconditions, and no
  installation-identity cycle;
- plan-admission, collision-head, attempt-start, step-receipt, terminal, and
  hash-chained event values;
- installation identity/receipt, physical-versus-residual capability evidence,
  readiness, append-only availability history, and per-installation heads; and
- bounded canonical frames, literal golden digests, caller detachment,
  recursive freezing, exact replay/collision classification, and fail-closed
  stored-byte verification.

The byte ceilings in this checkpoint bound accepted stored input; they do not
yet prove a Cloudflare Worker heap ceiling for `JSON.parse` representation
expansion. These decoders therefore remain production-inert. Any Worker caller
must first add and prove a pre-parse token/node budget or a lower host-specific
byte ceiling under the Worker memory limit. This is an activation gate, not
authority to weaken stored-shape or digest verification.

The code remains private under
`packages/persistence-postgres/src/relationalSchema/physical/`,
`packages/persistence-postgres/src/migrationCoordination/`, and
`packages/persistence-postgres/src/frameworkSchema/installation/`. It adds no
root export or package export-map entry. Focused proof lives in
`privateCanonicalValue.test.ts`, `relationalSchemaPhysical.test.ts`,
`migrationCoordinationValues.test.ts`, and
`frameworkSchemaInstallationValues.test.ts`.

This checkpoint-1 receipt did not itself authorize checkpoint 2. The separate
checkpoint-2 storage contract is now accepted in
[`10-relational-coordinator-metadata-and-repositories.md`](./10-relational-coordinator-metadata-and-repositories.md);
its first additive metadata DDL slice is now complete with focused PGlite
catalog, previous-head upgrade, atomic rollback/retry, representative root
constraint/foreign-key/uniqueness rejection, nullable discriminated-tuple
rejection, and root-row cold-reopen evidence. It still does not authorize a
relational SQL/DDL runner, opaque target session, lease orchestration, binding,
adapter, runtime caller, or production activation.

## Non-Goals And Stop Conditions

This umbrella preflight performs no code or database change by itself. The
accepted checkpoint-2 successor above is the only authority for its exact
metadata DDL and repository slices. Stop and open the owning gate before:

- adding any migration file, table declaration, or repository outside the
  exact checkpoint-2 successor contract, or adding a DDL runner, service,
  Layer, export, route, runtime caller, or production binding;
- splitting the common control/target platform migration tree;
- implementing `DataBindingSet`, Application projection, activation, serving,
  or a system binding slot;
- adding an owner-scoped relational store, transaction manager, mutation
  receipt, finalizer, change fact, feed, or outbox behavior;
- importing Payload or Medusa, promoting Currency, translating historical
  migrations, or executing seed data;
- routing Payload content through `RelationalSchema`;
- changing Platform or Application migration, readiness, activation, OCC, or
  commit ownership;
- accepting caller SQL, ORM objects, callbacks, raw connections, or authored
  physical identifiers;
- adding down migration, destructive contraction, nontransactional DDL,
  concurrent index creation, triggers, functions, extensions, or backfills;
- claiming that physical capability evidence proves query/store/framework
  compatibility;
- claiming database-enforced migration-role restriction before the dedicated
  PostgreSQL role/credential gate; or
- using PGlite as PostgreSQL concurrency or DDL acceptance.

## Exit Decision

The installation and structural migration authority has passed its private pure
value checkpoint and additive metadata-DDL slice. The plan/installation digest
cycle is removed, different candidates share one stable DDL collision domain,
semantic IDs no longer leak into PostgreSQL identifiers, scope isolation is a
physical invariant, coexisting additive candidates have an exact observed-
projection meaning, and physical evidence cannot masquerade as runtime
compatibility.

The explicit checkpoint-1 approval has now been exercised and its private
pure-value receipt is complete above. Checkpoint 2 is separately accepted, and
its additive private metadata DDL, stored restoration, and first
target/collision, physical-name assignment, migration-plan aggregate, and
plan-admission aggregate repository families are complete; later repository
kernels remain pending in that checkpoint. This
record still opens
no generated relational DDL, target execution, binding, adapter, runtime,
hosted, public, or production gate.
