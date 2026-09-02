# Relational Coordinator Metadata And Repositories Preflight

Status: accepted checkpoint-2 storage contract; additive private metadata DDL,
focused PGlite DDL/catalog evidence, and source-private topological stored-value
restoration implemented; the private target/collision, physical-name
assignment, and migration-plan aggregate repository families are implemented,
and the remaining repository families are pending; no target session, generated
relational DDL, coordinator runtime, binding, adapter, or production activation
is authorized

Last reviewed: 2026-09-02

## Decision

Implement checkpoint 2 from
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md)
as target-local platform metadata with exact canonical bytes, normalized
constraint sidecars, cold-rehydration codecs, and transaction-parameterized
private repository kernels.

The static Flarex migration tree creates only the coordinator's metadata. It
does not contain a framework migration plan or any table, index, key, foreign
key, or check requested by a relational artifact. Those target structures
remain typed plan operations for checkpoint 3.

Checkpoint 2 is intentionally divided into complete bounded slices:

1. freeze this exact storage and repository contract;
2. add the private Drizzle declarations and one additive platform migration;
3. add source-private topological stored-value restoration;
4. add transaction-parameterized exact-write, exact-read, and CAS kernels; and
5. complete PGlite storage/repository evidence and record the receipt.

Slices 1 through 3 are complete. Slice 4 is in progress: its target/collision,
physical-name assignment, and migration-plan aggregate families are complete
and the remaining transaction-parameterized private repository families are
pending.

No slice may construct a live coordinator or widen the public package surface.

## Why Canonical Bytes And Relational Sidecars Both Exist

Canonical UTF-8 bytes and their SHA-256 digest remain the semantic authority.
PostgreSQL columns do not reinterpret a frame and JSONB is not a second source
of truth. Normalized rows exist only where PostgreSQL must efficiently enforce
or locate:

- the physical target and stable collision coordinate;
- historical generated-name collisions;
- plan-step and dependency membership;
- plan-admission assignment membership;
- attempt, receipt, terminal, event-chain, and head references;
- installation/readiness lineage; and
- availability history and its mutable head.

Every repository read authenticates the full canonical bytes, then compares
all normalized projections and sidecar rows with the decoded frame. Matching
sidecars cannot make malformed, oversized, noncanonical, or digest-mismatched
bytes valid. Matching bytes cannot excuse missing, extra, reordered, or
cross-coordinate sidecars.

The plan may contain up to 66,000 steps and 8 MiB of canonical bytes. Loading
and parsing the entire plan to locate every step or dependency inside a DDL
transaction would be an avoidable scaling and memory hazard. Plan-step and
dependency sidecars therefore make bounded indexed lookups possible while the
plan bytes remain authoritative.

## Storage Authority And Construction Boundary

The tables use the common checked-in platform migration tree and consequently
exist wherever that tree is installed. Physical presence grants no read or
write authority.

- The control artifact repository cannot construct or use this repository.
- A locator, decoded target namespace, raw Drizzle database, raw connection, or
  raw transaction cannot mint target authority.
- Checkpoint 2 exposes no production repository factory. Its pending SQL
  kernels must take the package-owned transaction capability so PGlite can
  prove storage behavior and checkpoint 3 can later enclose them.
- Checkpoint 3 must be the first live composition root. It will authenticate a
  host-issued opaque target, open the exact target transaction, and keep the
  raw transaction inside its closure.
- No `Context` singleton, `Layer`, runtime startup hook, or automatic migration
  belongs in checkpoint 2.

All declarations and operations remain source-private under:

```text
packages/persistence-postgres/src/migrationCoordination/
packages/persistence-postgres/src/frameworkSchema/installation/
packages/persistence-postgres/src/relationalSchema/physical/
```

The Drizzle declarations are re-exported only from `src/drizzleSchema.ts` for
Drizzle Kit. They are absent from `src/index.ts`, the package export map, the
root `flarexSchema`, and every public application, CMS, and commerce API.

## Exact Catalog

The accepted catalog has eighteen unversioned tables. Version belongs to the
stored frame, not to the current table name.

| Table | Mutability | Purpose |
| --- | --- | --- |
| `fx_system_framework_schema_target_namespace` | immutable | Exact host-comparison target namespace bytes and physical coordinate. |
| `fx_system_framework_migration_collision_domain` | immutable | Stable owner/lineage collision coordinate beneath one target namespace. |
| `fx_system_relational_physical_name_assignment` | immutable | Historical physical spelling, name digest, assignment digest, and bytes. |
| `fx_system_framework_migration_plan` | immutable | Exact captured plan, artifact/layout/step-set projections, and locator evidence. |
| `fx_system_framework_migration_plan_step` | immutable sidecar | Ordered plan-step identity, phase, operation kind, and condition digests. |
| `fx_system_framework_migration_plan_step_dependency` | immutable sidecar | Ordered same-plan dependency edges. |
| `fx_system_framework_migration_plan_admission` | immutable | Exact admitted plan and assignment set. |
| `fx_system_framework_migration_admission_assignment` | immutable sidecar | Ordered same-collision assignment membership. |
| `fx_system_framework_migration_attempt_start` | immutable | Attempt/fence/lease-start evidence. |
| `fx_system_framework_migration_step_receipt` | immutable | One exact committed receipt per attempt and plan step. |
| `fx_system_framework_migration_step_receipt_dependency` | immutable sidecar | Exact same-attempt dependency receipt tokens. |
| `fx_system_framework_migration_attempt_terminal` | immutable | One exact terminal outcome per attempt. |
| `fx_system_framework_migration_event` | immutable | Per-collision authenticated hash-chain event history. |
| `fx_system_framework_migration_collision_head` | mutable CAS head | Current plan, attempt fence/lease, and last event for one collision lane. |
| `fx_system_framework_schema_installation` | immutable | Published physical-installation identity and receipt. |
| `fx_system_framework_schema_readiness` | immutable | Exact structural validation/readiness receipt. |
| `fx_system_framework_schema_availability_history` | immutable | Per-installation availability transition history. |
| `fx_system_framework_schema_availability_head` | mutable CAS head | Current exact availability history token. |

Only the collision head and availability head may be updated. No checkpoint-2
operation deletes a row.

## Common Column And Constraint Contract

Every independently addressed immutable canonical value has a generated-always
positive `bigint` storage ID with an explicitly named owned sequence. Sidecars
use their parent identity plus a bounded ordinal. The two mutable heads use
their immutable authority key as the primary key and have no sequence.

Every canonical-value row stores:

```text
<kind>_sha256          bytea, exactly 32 bytes
frame_format           text COLLATE "C", exact literal
frame_version          integer, exact supported version
canonical_byte_length  integer, positive and within the kind ceiling
canonical_bytes        bytea, octet length exactly canonical_byte_length
```

The target namespace uses its 4 KiB ceiling; a physical-name assignment uses
20 KiB; a migration plan uses 8 MiB; every other migration ledger value uses
1 MiB; installation/readiness values use 4 MiB; availability history/head
values use 1 MiB. The DDL checks enforce these ceilings for stored rows. Pending
repository kernels must also enforce the pre-transfer write and length-first
read gates below.

All identity, discriminant, format, locator, spelling, status, and reason text
used in comparison, ordering, a key, or a foreign key uses explicit `C`
collation. Text bounds are UTF-8 byte bounds and physical nonblank checks use
the same complete ECMAScript trim-character set as the artifact registry.
Every digest projection is exactly 32 bytes. All foreign keys are immediate,
nondeferrable, and `ON DELETE RESTRICT`; no cascade is authorized.

Canonical nonnegative and positive int64 strings project to SQL `bigint` only
after exact decimal decoding. They never pass through a JavaScript `number`.
The database checks the corresponding nonnegative or positive range.

## Target Namespace And Collision Tables

`fx_system_framework_schema_target_namespace` stores:

- `target_namespace_storage_id`;
- `deployment_id`, maximum 512 UTF-8 bytes;
- `physical_database_identity`, maximum 512 UTF-8 bytes;
- `schema_name`, maximum 63 UTF-8 bytes;
- `target_namespace_sha256`; and
- the common target-namespace frame columns and bytes.

It has unique keys on the natural triple
`(deployment_id, physical_database_identity, schema_name)`, on the digest, and
on `(target_namespace_storage_id, physical_database_identity, schema_name)`
for exact child references. It deliberately has no foreign key to the control
artifact registry or a routing/connection table.

`fx_system_framework_migration_collision_domain` stores:

- `collision_storage_id`;
- `target_namespace_storage_id` plus repeated physical database and schema;
- `owner`, exactly `medusa | system`;
- `lineage_id`, maximum 512 UTF-8 bytes; and
- `physical_namespace_profile`, exactly
  `relational-postgres-scope-isolated-stable-names`.

Its parent foreign key includes the repeated physical database and schema, so
they cannot diverge from the target namespace. The stable collision key is
`(target_namespace_storage_id, owner, lineage_id,
physical_namespace_profile)`. Supporting unique keys include the collision ID
plus target coordinate for exact descendants. Artifact, plan, installation,
scope, locator kind, and logical database key are absent from the collision
key.

## Physical Name Assignment

`fx_system_relational_physical_name_assignment` stores:

- `assignment_storage_id` and `collision_storage_id`;
- repeated `physical_database_identity` and `schema_name`;
- `spelling`, exactly `^fxr[tcikfh]_[0-9a-v]{52}$` and 57 ASCII bytes;
- `name_sha256` and `assignment_sha256`; and
- the common assignment frame columns and bytes.

The exact collision/physical-coordinate foreign key prevents an assignment
from being attached to a different lineage lane. The global physical collision
key is exactly
`(physical_database_identity, schema_name, spelling)` and deliberately omits
deployment, owner, lineage, profile, artifact, and plan. Assignment digest and
`(assignment_storage_id, collision_storage_id, spelling,
assignment_sha256)` are supporting unique keys.

There is no separate physical-name or physical-layout table. Assignment bytes
already retain the exact name frame/preimage/digest, and plan bytes retain the
complete physical layout. Adding another canonical copy would introduce
competing semantic authority.

## Plan And Plan Sidecars

`fx_system_framework_migration_plan` stores:

- `plan_storage_id` and `collision_storage_id`;
- `artifact_sha256`, `migration_plan_sha256`, `required_step_set_sha256`, and
  `physical_layout_sha256`;
- `locator_kind`, exactly `shared_database | schema_per_scope |
  database_per_scope`;
- `locator_database_key` and `locator_schema_name`, each maximum 512 UTF-8
  bytes, with the schema spelling additionally bounded to 63 bytes; and
- the common plan frame columns and bytes.

The plan digest is globally unique. Supporting exact keys bind storage ID,
collision ID, and plan digest. There is no plan-to-installation reference and
no target-side foreign key to the physically present control artifact table.

`fx_system_framework_migration_plan_step` stores:

- `plan_storage_id`, `collision_storage_id`, and `step_ordinal` in
  `0..65,999`;
- `step_id`, exactly `step_[0-9a-f]{32}`;
- `step_sha256`, `precondition_sha256`, and `postcondition_sha256`;
- `phase`, exactly `expansion | validation`;
- `operation_format`, exactly one of
  `flarex.relational-create-table`, `flarex.relational-create-index`,
  `flarex.relational-add-foreign-key`, or
  `flarex.relational-validate-structure`;
- `operation_version`, exactly `1`; and
- `dependency_count` in `0..65,999`.

The primary key is `(plan_storage_id, step_ordinal)`. Step ID and step digest
are separately unique within a plan. An exact composite foreign key binds the
step to its plan and collision.

`fx_system_framework_migration_plan_step_dependency` stores parent plan,
source step, `dependency_ordinal`, dependency step ID, and dependency step
digest. Its primary key preserves canonical dependency order. Same-plan exact
foreign keys authenticate both source and dependency step; a step cannot
depend on itself. Repository comparison rejects gaps, duplicates, wrong
counts, and ordering differences.

## Admission And Assignment Membership

`fx_system_framework_migration_plan_admission` stores:

- `admission_storage_id`, `collision_storage_id`, and `plan_storage_id`;
- `admission_sha256` and exact `migration_plan_sha256`;
- nullable `previous_plan_storage_id` plus `previous_plan_sha256` as an
  all-or-none exact same-collision tuple;
- `admission_profile`, exactly `synthetic-system-fresh`;
- `assignment_count`, bounded to the physical-layout maximum of 131,328; and
- the common admission frame columns and bytes.

The admission digest is globally unique. Exact composite foreign keys bind its
plan and optional previous plan to the same collision. Admission time remains
inside canonical bytes because it is immutable evidence, not a query clock.

`fx_system_framework_migration_admission_assignment` stores admission,
collision, membership ordinal in `0..131,327`, assignment storage ID, spelling,
and assignment digest. Its primary key preserves canonical membership order; assignment is
unique within the admission. Composite foreign keys prove the admission and
assignment share one collision and exact assignment token. Repository
comparison enforces `assignment_count`, order, and complete equality.

## Attempts, Step Receipts, And Terminal Evidence

`fx_system_framework_migration_attempt_start` stores:

- `attempt_storage_id`, collision, plan, and admission storage IDs;
- `attempt_id`, `attempt_fence`, and `lease_owner_id`;
- `lease_expires_at` as the operational database-time projection;
- nullable `previous_attempt_id`; and
- `attempt_start_sha256` plus the common attempt frame columns and bytes.

Attempt ID and fence are independently unique within one collision. Plan and
admission composite foreign keys must name that same collision and exact plan.
The optional previous attempt foreign key is collision-local and cannot point
to the current attempt.

`fx_system_framework_migration_step_receipt` stores:

- receipt, collision, plan, and attempt storage IDs;
- exact attempt ID/fence and step ID/digest;
- receipt, precondition, postcondition, and observed-postcondition digests;
- `dependency_count`; and
- the common receipt frame columns and bytes.

There is one receipt per `(attempt_storage_id, step_id)`. Exact composite
foreign keys bind the plan step and the attempt. A retry in the same attempt
accepts the exact existing receipt. A later fenced attempt may re-observe an
already exact structural postcondition and record its own receipt chain; this
matches the checkpoint-1 requirement that dependency receipts belong to the
same attempt. Receipt digest is globally unique.

`fx_system_framework_migration_step_receipt_dependency` stores source receipt
storage ID, the shared attempt storage ID, `dependency_ordinal`, dependency
receipt storage ID, dependency step ID, and dependency receipt digest. The
source foreign key binds `(receipt_storage_id, attempt_storage_id)`; the target
foreign key binds the dependency receipt, that same globally unique attempt
storage ID, step ID, and digest. This normalized shape physically prevents
cross-attempt evidence without repeating collision, plan, attempt ID, and fence
on every dependency row. Repository comparison rejects gaps, duplicates, wrong
counts, or order mismatches.

`fx_system_framework_migration_attempt_terminal` stores:

- terminal, collision, plan, and attempt storage IDs plus attempt ID/fence;
- the attempt's exact admission storage ID and digest projection;
- `attempt_terminal_sha256`;
- `outcome_kind`, exactly `succeeded | failed | decisionUncertain`;
- success-only `required_step_set_sha256`;
- failure-only `failure_reason`, exactly `operationFailed |
  validationFailed | leaseLost | superseded`;
- failure/uncertain-only `evidence_sha256`;
- exact last-step receipt storage ID and digest, nullable only for a
  failed/uncertain attempt with no completed prefix; and
- the common terminal frame columns and bytes.

The outcome columns satisfy the exact discriminated union. There is at most
one terminal row per attempt. The terminal-to-attempt foreign key includes the
admission projection, so a terminal cannot be detached from the admission that
started its attempt. Every admitted plan has at least one step, so a succeeded
terminal requires the non-null last-receipt pair. A failed or uncertain attempt
may have no completed prefix; when present, its last-receipt pair is all-or-none
and references the same exact attempt.

Canonical completion/start/terminal timestamps remain inside canonical bytes;
they are not widened into an alternate database-time authority.

## Migration Event History And Collision Head

`fx_system_framework_migration_event` stores:

- `event_storage_id`, collision, nonnegative `event_sequence`, and
  `event_sha256`;
- the nullable exact previous event storage ID/sequence/digest tuple;
- `event_kind`, exactly `planAdmitted | attemptStarted | leaseRenewed |
  stepCompleted | attemptTerminated | installationPublished |
  readinessPublished`;
- a nullable `subject_sha256` for every non-lease event;
- lease-renewal-only attempt ID/fence/owner and operational expiry; and
- the common event frame columns and bytes.

The previous-token fields are all null or all non-null. When present, they
reference the exact earlier row through a self foreign key and the previous
sequence is less than the new sequence. Checkpoint 1 permits an initial event
whose nonnegative sequence is already aligned with a positive head revision,
so the schema does not falsely require the first event to use sequence zero.
The event kind's canonical subject belongs to several different tables, so the
schema does not invent an unsafe polymorphic foreign key. The exact repository
insert resolves and authenticates the kind-specific subject before inserting
the event.

`fx_system_framework_migration_collision_head` stores:

- its collision ID primary key;
- `head_revision`, `collision_head_sha256`, exact current plan and admission
  tokens;
- `attempt_fence`;
- an all-or-none current attempt storage ID/ID/fence/owner/operational expiry
  tuple;
- an all-or-none last event storage ID/sequence/digest tuple; and
- the common collision-head frame columns and bytes.

It references exact immutable plan, admission, attempt, and event rows. The
current-attempt foreign key includes the head's current admission identity, so
the two cannot be composed from different admissions of one plan. If a current
attempt exists, its fence equals the head's attempt fence. The only update is
exact compare-and-swap on `(collision_storage_id, old_head_revision,
old_collision_head_sha256)` to an already-captured next head. The later
coordinator owns the additional policy
that revision advances by exactly one, fences never decrease, and lease state
matches database time; the checkpoint-2 kernel only applies a prevalidated
transition and reports a stale CAS without retry.

## Installation, Readiness, And Availability

`fx_system_framework_schema_installation` stores:

- `installation_storage_id`, collision, plan, admission, and terminal storage
  IDs;
- `installation_sha256`, `installation_receipt_sha256`, and
  `installed_structure_sha256`; and
- the common installation frame columns and bytes.

Installation identity and receipt digest are independently unique. Exact
composite foreign keys bind admission and terminal evidence to the same plan,
collision, and admission-backed attempt lineage. The plan never points back to
installation.

`fx_system_framework_schema_readiness` stores:

- `readiness_storage_id` and exact installation token;
- `readiness_sha256`, `installation_receipt_sha256`, `validation_sha256`, and
  `validated_structure_sha256`; and
- the common readiness frame columns and bytes.

There is at most one readiness receipt per installation. Full capability and
residual-requirement arrays remain in canonical bytes and are revalidated on
read.

`fx_system_framework_schema_availability_history` stores:

- `availability_history_storage_id`, installation, and readiness IDs;
- positive `availability_sequence`, `history_sha256`, and `status`, exactly
  `ready | withdrawn | superseded | quarantined`;
- nullable `reason_sha256`;
- the nullable exact previous history storage ID/sequence/digest/status tuple;
  and
- the common availability-history frame columns and bytes.

Sequence one has no previous row; every later sequence requires the exact
immediately previous token through a self foreign key. Readiness must belong to
the same installation. History is append-only.

`fx_system_framework_schema_availability_head` stores:

- its installation ID primary key and exact readiness ID;
- exact history storage ID/sequence/digest/status;
- `availability_head_sha256`; and
- the common availability-head frame columns and bytes.

Its composite foreign key names the exact history token. The only update is an
exact compare-and-swap on
`(installation_storage_id, old_availability_sequence,
old_availability_head_sha256)` to an already-captured next head. Sequence and
transition policy remains with the later availability coordinator.

## Timestamp Mapping

Canonical timestamps use the complete ECMAScript `toISOString()` spelling.
PostgreSQL timestamp input, range, output spelling, and precision are not an
equivalent canonical codec. Immutable evidence timestamps therefore remain
only in authenticated bytes.

Lease expiry is different: claim/takeover must compare it with database time.
The attempt, lease-renewal event, and collision head project it to
`timestamp(3) with time zone`, require it to be finite, and compare it only as
an operational projection. Before SQL, the storage preparer accepts only the
four-digit UTC-millisecond subset
`YYYY-MM-DDTHH:mm:ss.sssZ`, years `0001..9999`, whose JavaScript parse and
`toISOString()` round trip is exact. It converts that spelling once to an owned
`Date`. Reads compare the projected database timestamp back to the canonical
lease spelling after normalizing to the same millisecond UTC representation.

There is no `default now()` for a canonical timestamp and no repository method
computes a canonical time. Checkpoint 3 will capture database time and construct
the value before invoking an exact storage kernel.

## Cold Rehydration Contract

Checkpoint-1 runtime authority is intentionally tracked with module-owned
`WeakSet` and `WeakMap` state. The current stored verifiers authenticate bytes
and return a `JsonObject`; they do not recreate the authority graph needed by
downstream capture operations. A cast of that object is not rehydration.

Source-private restore operations must therefore rebuild values in dependency
order without rerunning the relational lowerer and without requiring a live
control artifact:

```text
target namespace
  -> name assignments -> physical layout -> plan -> plan steps
  -> plan admission -> attempt start -> step receipts -> terminal
  -> installation -> readiness -> availability history/head
```

Each restore operation:

1. size-gates, hashes, canonically decodes, and validates the stored frame;
2. accepts only already-restored exact dependencies;
3. compares every projected column and complete ordered sidecar set;
4. creates a recursively frozen, detached value;
5. registers that value in the same private authority graph used by fresh
   captures; and
6. returns a typed stored-restoration failure without exposing raw bytes or
   SQL.

Restoration does not mint target authority. Checkpoint 3 must additionally
compare the restored target namespace and locator with the live opaque target
before any claim or DDL.

## Private Repository Kernel

The checkpoint-2 repository slice implements operation-specific
named Effects over the package's existing `FlarexMetadataTransaction`
capability. It must not redeclare a structural transaction interface or open,
commit, roll back, retry, or retain a transaction.

The accepted kernel families are:

- target/collision: ensure exact target namespace and collision coordinate;
- plans: put/read exact plan with step/dependency sidecars;
- assignments/admission: put/read exact assignments and plan admission;
- attempts: put/read exact attempt start, step receipt, and terminal evidence;
- event history: append/read an exact event and its previous token;
- collision head: initialize/read and exact CAS;
- installation/readiness: put/read exact immutable receipts; and
- availability: append/read history, initialize/read head, and exact CAS.

These are aggregate operations, not a generic table CRUD surface. Public
method names are not introduced. Internally, each operation has one named
`Effect.fn`, one Promise-to-Effect statement boundary, and one projection from
foreign driver failure into its repository-owned typed failure. Expected
absence may use `Option`; `busy`, `pending`, policy refusal, and availability
transition decisions do not belong to this checkpoint.

Exact immutable replay decodes the complete existing aggregate and returns it.
Different authentic bytes under the same semantic identity return an immutable
conflict; a reused physical spelling returns a physical-name collision;
malformed stored evidence returns stored corruption; a missing or cross-owner
reference returns reference refusal; and an unmatched head compare-and-swap
returns stale head. Unexpected defects are not collapsed into those expected
failures.

Large canonical reads must first select byte length and return bytes only within
the ceiling. Driver rows must be detached before decoding and before the
transaction is released by its later owner. All writes must be exact inserts
except the two CAS heads. No raw connection, callback SQL, authored SQL text,
arbitrary scan, generic upsert, update-by-object, or delete operation may be
introduced.

The checkpoint-2 kernel does not expose `FOR UPDATE`, `claim`, `renewLease`,
`executeStep`, `recover`, `validate`, `publishReadiness`,
`transitionAvailability`, `withTransaction`, timeout/retry policy, or a
repository factory. Those operations require the checkpoint-3 opaque target
session and coordinator policy.

## Static Platform Migration Contract

At implementation time the migration head must be rechecked; this record does
not reserve a number. The implementation must:

1. add domain-local private Drizzle declarations;
2. re-export them only from `src/drizzleSchema.ts`;
3. run `db:check` before generation;
4. run the package `db:generate` command once;
5. inspect SQL, journal, and snapshot together;
6. create all tables before applying dependency-safe exact foreign keys from
   target namespace through availability head;
7. keep every explicit identifier below PostgreSQL's 63-byte limit; and
8. rerun `db:check`.

The migration is additive. All eighteen tables start empty. It performs no
backfill, rewrite, DML, trigger, function, extension, grant, role change,
Application mutation, head activation, generated relational DDL, or target
schema adoption.

### Additive metadata DDL implementation receipt

Status on 2026-09-02: complete as a private, production-inert DDL slice.

The checked-in `0080_nosy_marvel_zombies.sql` migration creates exactly the
eighteen tables above, twelve generated-always identity sequences, 18 primary
keys, 48 unique constraints, 31 checks, and 33 immediate restrictive foreign
keys. Its 66 indexes are only the primary-key and unique-constraint backing
indexes; it creates no speculative standalone index. Foreign-key references are
unqualified so the common migration tree remains search-path portable.

Focused PGlite evidence proves fresh and idempotent migration, exact table,
column/type/nullability/identity/collation, constraint, foreign-key order/action,
sequence ownership/options, and index catalogs; upgrade from 0079 with a real
0079 framework-artifact row preserved; complete rollback of tables, sequences,
and migration receipt after an injected final-statement failure; successful
retry with every new table empty; representative target/collision/name check,
foreign-key, and uniqueness rejection; rejection of incomplete nullable
terminal/event/head/availability tuples; restrictive deletes; and preservation
of one target, two collision domains, and one assignment across cold
close/reopen.
This is functional storage evidence, not genuine-PostgreSQL DDL acceptance.

This DDL receipt adds no repository kernel, live target, framework-owned target
DDL, binding, or runtime caller.

### Source-private restoration implementation receipt

Status on 2026-09-02: complete as a production-inert value-restoration slice.

Stored target, collision, physical-name assignment, embedded physical layout,
plan and ordered step/dependency sidecars, admission and ordered assignment
sidecars, attempt, ordered receipt graph, terminal, installation, readiness,
availability history/head, migration event chain, and collision head are now
restored in dependency order. Every canonical row checks its selected byte
length, format/version, digest, canonical bytes, complete normalized
projections, and ordered sidecars before returning a detached frozen value.
Database IDs remain only on source-private restoration handles.

Fresh capture and restoration now register with the same module-owned authority
graphs. Focused tests prove that newly reconstructed values are distinct object
identities, reject altered bytes, reordered sidecars, and forged dependencies,
same-cardinality plan-assignment and receipt-dependency substitution, and a
non-increasing event chain, and are accepted by the existing downstream capture
operations. The event proof includes exact predecessor tokens, a lease
projection, and a readiness-published cross-domain subject. Package-boundary
checks keep all restoration operations absent from the root and export map.

This started as in-process stored-row restoration evidence. The implemented
target, collision, assignment, and plan repository families now add actual
transaction reads, length-first SQL byte gates, and immutable replay/conflict
classification. Plan-aggregate reconstruction across PGlite close/reopen, the
later repository families, and head CAS remain pending. No live target authority
is minted.

### Current target/collision, assignment, and plan repository boundary

The current production-inert repository families consist of source-private,
transaction-parameterized Effects that ensure and exactly read target
namespaces and their collision domains. They accept the existing
`FlarexMetadataTransaction` capability directly and never open, commit, roll
back, retry, lock, or retain a transaction. Immutable insertion uses
`ON CONFLICT DO NOTHING` followed by a complete bounded read and stored-value
restoration, so exact replay converges on the existing storage identity.

Collision operations first corroborate the restored target against the same
transaction, including its storage ID, before inserting or reading a child.
This rejects forged handles, cross-target dependencies, and a parent absent
from the current database without turning a foreign-key failure into reference
policy. It does not prove live database-instance provenance: an identical
target identity and storage ID in another database is indistinguishable until
checkpoint 3 binds the restored namespace to the opaque live target. Target
reads project byte length and use a SQL `CASE` gate so over-limit canonical
bytes are not returned to the application decoder. Repository failures
distinguish immutable conflict, reference refusal, stored corruption, and
foreign resource failure.

Physical-name assignment operations accept exact canonical assignment evidence,
not plan authority, so stored assignments can be loaded before reconstructing
the physical layout and plan. The kernel corroborates the expected collision in
the same transaction, authenticates the complete assignment, inserts without a
conflict target, and resolves the global assignment digest before the global
physical spelling. An exact digest occupant replays; a non-exact authentic
occupant under the expected digest is an immutable conflict; a non-exact
authentic occupant of the physical spelling is a physical-name collision. Every
occupant is restored against its actual stored target/collision chain before
classification, and assignment bytes use the same length-first SQL gate as
target bytes.

Migration-plan operations persist one immutable aggregate root together with
the complete ordered step and dependency sidecars. Before insertion they
corroborate every referenced physical-name assignment through bounded reads;
step and dependency insertion is also bounded so the 66,000-step contract does
not become one unbounded bind set. An untargeted `ON CONFLICT DO NOTHING ...
RETURNING` distinguishes a newly inserted root from an exact replay: only a new
root receives sidecars, while an existing root is fully restored and
authenticated and is never repaired or healed implicitly. Digest occupants are
resolved through their actual stored target, collision, assignment, and
sidecar chain before replay or immutable-conflict classification. Root bytes
use the length-first SQL gate, and dependency reads order by source-step ordinal
then dependency ordinal rather than lexical step ID.

The remaining admission, attempt, receipt, terminal, event,
collision-head, installation, readiness, and availability repository families
remain pending. These kernels add no CAS, coordinator policy, or live target.

## Checkpoint-2 Evidence

PGlite is the functional lane for this checkpoint. Completion requires:

- fresh migration plus idempotent second migration and exact table inventory;
- upgrade from the immediately preceding migration with representative old
  state unchanged and all new tables empty;
- injected final-migration failure rolling back every new table, sequence, and
  migration receipt before successful retry;
- exact columns, identity sequences, collations, PKs, unique keys, checks,
  foreign-key column order/actions, and index inventory;
- database rejection for malformed digest/length/format/version, invalid enum,
  invalid range, incoherent nullable tuple, physical-name collision,
  cross-collision/cross-plan/cross-attempt reference, duplicate immutable
  receipt, missing history predecessor, and stale CAS;
- exact write/read/replay for every canonical aggregate;
- extra/missing/reordered sidecar and corrupted-byte rejection;
- cold close/reopen and topological rehydration; and
- a package-boundary proof that no declaration, codec, or kernel is publicly
  reachable.

PGlite does not prove genuine PostgreSQL DDL acceptance, lock behavior,
database-time lease contention, driver cancellation, transaction uncertainty,
or production operation. Those remain checkpoint 5 after the checkpoint-3 and
checkpoint-4 coordinator profiles exist. A small URL-gated native catalog test
may be added later, but it cannot promote the coordinator early.

## Non-Goals And Stop Conditions

Stop and open the owning checkpoint before:

- constructing an opaque live target or exposing a repository constructor;
- opening or controlling a transaction in this domain;
- adding `FOR UPDATE`, lease claim/takeover/renewal, coordinator state-machine
  policy, target catalog observation, or generated DDL execution;
- adding any framework-owned target table to the checked-in Drizzle history;
- introducing a plan-to-installation cycle or target-to-control artifact FK;
- implementing base-backed planning, contraction, rename, cast, data migration,
  seed execution, nontransactional DDL, or concurrent index creation;
- adding binding, Application projection, activation, serving, a synthetic
  system slot, relational data stores, commit receipts, feed facts, or outbox
  behavior;
- importing or activating Payload or Medusa code; or
- exposing relational, CMS, commerce, SQL, migration, or repository APIs.

## Exit Decision

The exact target-local metadata and repository seam is frozen; its additive
platform metadata catalog, source-private topological restoration, and private
target/collision, physical-name assignment, and migration-plan aggregate
repository families are implemented. The remaining transaction-parameterized
repository families are the next checkpoint-2 work. The opaque target and
coordinator remain
checkpoint 3.
