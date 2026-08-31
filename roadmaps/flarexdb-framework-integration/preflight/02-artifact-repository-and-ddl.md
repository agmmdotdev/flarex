# Framework Schema Artifact Repository And DDL Preflight

## Status And Authorization

Status: accepted on 2026-08-30; additive DDL, runtime-authenticated admission
preparation, stored reconstruction, opaque repository identity/control-
database composition, runtime-authenticated starter composition, deterministic
control-session lifecycle, and the artifact-private PostgreSQL control-session
adapter, exact point-read repository operation, private locked admission,
bounded identity listing, and focused PGlite repository evidence implemented;
focused ordinary-role PostgreSQL 18 migration/catalog, control-session, point-
read, exact-admission convergence, and deployment-row blocking evidence
implemented, together with collision contention, both dependency-lock orders,
cross-deployment non-blocking, owner/lineage coordinate isolation under
contention, native post-write rollback, and driver-edge pre-/post-`COMMIT`
settlement recovery after discarding the uncertain backend and using a
distinct recovery backend, plus advisory-lock-backed callback-SQL and server-
blocked-`COMMIT` interruption settlement, native queued-acquisition expiry,
server-enforced lock and statement timeouts, and detached optimistic and post-
resolution reconstruction deadlines, plus deployment-first cross-owner lock
ordering with both the framework and Application schema-version artifact writer
as the initial holder; active-SQL and recovery-work deadline quarantine is now
implemented under the separately accepted `FSA-PG-DRAIN-01` correction, while
wider genuine PostgreSQL acceptance remains incomplete

The private owner-qualified artifact value checkpoint is implemented and
production-inert. This preflight freezes the next additive boundary only:

- control-authority storage for immutable framework schema artifacts;
- physical dependency evidence and dependency-existence admission;
- exact replay, digest-collision, point-read, and bounded-list semantics;
- stored-row decoding and corruption classification;
- transaction and lock ownership;
- static Flarex platform migration compatibility; and
- separate PGlite and genuine-PostgreSQL acceptance evidence.

Acceptance authorizes only the private files and evidence listed under
Implementation Checkpoint. It does **not** authorize:

- a package-root export or runtime caller;
- an Application artifact writer or any change to the Application schema,
  readiness, activation, or commit authorities;
- installation, readiness, availability, binding, or `DataBindingSet`
  persistence;
- relational schema interpretation or framework migration execution;
- a Payload or Medusa adapter, owner codec, module compiler, or request path;
- a public relational, CMS, commerce, or raw SQL API; or
- production activation.

## Accepted Decision

Add two private, unversioned control tables through the ordinary static Flarex
platform migration ledger:

```text
fx_control_framework_schema_artifact
  one immutable canonical artifact

fx_control_framework_schema_artifact_dependency
  the exact ordered dependency identities carried by that artifact
```

The artifact table retains the exact canonical UTF-8 bytes and their SHA-256.
It does not store a second JSONB interpretation. The dependency table gives
PostgreSQL exact same-deployment/same-owner foreign keys and lets admission
prove that every dependency already exists. Canonical bytes remain the semantic
source of truth; dependency rows are corroborating relational evidence and
must match the canonical dependency array exactly.

The private repository accepts only a runtime-authenticated artifact prepared
before SQL, locks the owning deployment row, admits one complete artifact and
all of its dependency rows atomically, and exposes no update or delete
operation. Exact canonical replay is idempotent. Equal full identity with
different canonical bytes in an independently valid stored artifact is a
digest collision; invalid stored evidence is corruption. A different digest
under the same lineage is a distinct immutable artifact, not an overwrite or
an implicit new active version.

Point reads perform full bounded reconstruction and integrity checking.
Listing is bounded, identity-only, and scoped to one exact deployment, owner,
and lineage. Neither operation chooses a latest artifact, proves readiness, or
selects runtime state.

## Existing Authority Audit

The current Application schema-version artifact repository is useful evidence,
but it is not the new owner:

- [`schemaVersionArtifacts.ts`](../../../packages/persistence-postgres/src/schemaVersionArtifacts.ts)
  prepares canonical evidence before SQL, authenticates a prepared value with
  a module-owned `WeakMap`, locks the deployment row, and accepts only exact
  replay;
- [`schema.ts`](../../../packages/persistence-postgres/src/schema.ts) defines
  `fx_control_schema_version` with deployment ownership, immutable identity,
  nonempty canonical evidence and database time, while its repository
  size-gates canonical reads; and
- focused PGlite and PostgreSQL tests distinguish constraint, corruption,
  rollback, and concurrency evidence.

Those mechanics are precedent, not permission to reuse the Application table.
The Application artifact has a different identity, manifest codec, version
stream, reader surface, readiness graph, and activation owner. This preflight
does not alter or dual-write it.

The implemented framework value contract already establishes:

- the exact identity `(deploymentId, owner, lineageId, artifactSha256)`;
- admitted owners `payload | medusa | system`;
- the common frame format `flarex.framework-schema-artifact` and version `1`;
- a 1,048,576-byte inclusive canonical-frame ceiling;
- at most 256 sorted unique same-deployment/same-owner dependencies;
- rejection of a dependency from the containing lineage; and
- exact replay versus digest-collision policy.

Capture intentionally makes no dependency-existence claim. This repository is
the first owner allowed to make that claim.

## Storage Authority And Placement

The registry belongs to the control authority for the deployment named by the
artifact. It is desired-state evidence, not target-local installation evidence
and not scope-local active state.

The current persistence bundle installs the same static Flarex migration tree
in control and located target schemas. Therefore table presence alone is not
authority. The first repository may be constructed only by the private
control-side composition root over the control metadata database. A located
target, framework adapter, or user transaction receives no constructor or raw
table capability.

That containment is runtime-bound, not a structural naming convention. A
package-private factory returns a frozen opaque
`FrameworkSchemaArtifactRepository`, and a module `WeakMap` binds that exact
instance to its control database and private control-session starter. The
starter must own exclusive connection acquisition, transaction phases,
bounded autocommit reads, deadline enforcement, and quarantine/discard;
passing a raw query database or `db.transaction` does not satisfy this
capability. A package-private
`hasFrameworkSchemaArtifactRepositoryComposition(repository, controlDb)` check
lets the trusted composition root prove that the repository is bound to the
expected control database before it is retained. Point reads, lists, and writes
accept the repository instance, never a plain `FlarexMetadataDatabase`.

The factory validates its four timeout-policy values with pure `Result`
before allocating the repository. Invalid policy produces the private
`FrameworkSchemaArtifactRepositoryConfigurationError` with
`reason: "invalidTimeoutPolicy"`, message
`Framework schema artifact repository timeout policy is invalid`, and no
foreign cause. This construction error is not a member of the per-artifact
operation error union.

Only after timeout validation succeeds, the factory snapshots `controlDb` and
`controlSessionStarter` once and authenticates the exact starter/database pair
through module-owned runtime state. A forged, cloned, proxied, or cross-
database starter produces the same configuration error with
`reason: "invalidControlSessionComposition"`, message
`Framework schema artifact control session composition is invalid`, and no
foreign cause. Invalid timeout policy retains precedence and reads neither
dependency property.

For the locked phase, the authenticated control-session facade issues and
revokes an opaque `FrameworkSchemaArtifactControlSessionTransaction` around
the starter's raw `FlarexMetadataTransaction` callback. Repository code must
authenticate that active session capability and its exact issuing starter
before immediately issuing its narrower opaque
`FrameworkSchemaArtifactControlTransaction`. A second
`WeakMap` binds the repository token to both the repository instance and the
underlying raw transaction; the locked primitive rejects a raw, target,
independently wrapped, cross-repository, forged, or expired transaction before
SQL. The raw transaction never leaves the repository-owned closure.

Changing to separate control and target platform migration trees would be a
larger persistence-owner change and is outside this checkpoint.

The future code remains private under the existing owner:

```text
packages/persistence-postgres/src/frameworkSchema/artifact/
  canonical.ts
  controlSession.ts
  errors.ts
  model.ts
  policy.ts
  postgresControlSession.ts
  repository.ts
  schema.ts
  storedCodec.ts
```

The table declarations are re-exported only from `src/drizzleSchema.ts` so
Drizzle Kit can generate the platform migration. They are not added to
`src/index.ts`, the package export map, or the historical root `flarexSchema`
surface. The repository imports its private table declarations directly.

The control-session adapter remains artifact-private for this checkpoint. It
does not retrofit the existing located-target transaction contract or claim a
generic framework transaction abstraction. A later installation or migration
owner may propose extraction only after proving the same authority, lifecycle,
deadline, quarantine, error, and evidence contract.

## Physical Artifact Table

### Table name

`fx_control_framework_schema_artifact`

### Columns

| Column | PostgreSQL type | Contract |
| --- | --- | --- |
| `artifact_storage_id` | `bigint GENERATED ALWAYS AS IDENTITY` | Positive signed database-only surrogate row identity represented as JavaScript `bigint`, backed by `fx_framework_artifact_storage_id_seq`; never leaves the repository as domain identity |
| `deployment_id` | `text` | Existing deployment identity; 1 through 1,024 UTF-8 bytes and physically nonblank under the exact ECMAScript `trim` character set |
| `owner` | `text COLLATE "C"` | Exactly `payload`, `medusa`, or `system` under deterministic bytewise equality |
| `lineage_id` | `text COLLATE "C"` | Preserved owner-local lineage; 1 through 1,024 UTF-8 bytes, physically nonblank under the exact ECMAScript `trim` character set, and compared under deterministic bytewise equality |
| `artifact_sha256` | `bytea` | Exactly 32 bytes decoded from the lowercase hexadecimal domain digest |
| `frame_format` | `text COLLATE "C"` | Exactly `flarex.framework-schema-artifact` under deterministic bytewise equality |
| `frame_version` | `integer` | Exactly `1` |
| `canonical_byte_length` | `integer` | Exact canonical length, `1..1,048,576` |
| `canonical_bytes` | `bytea` | Exact canonical UTF-8 frame bytes; 1 through 1,048,576 bytes |
| `admitted_at` | `timestamptz` | Database-owned finite audit time, default `now()`; excluded from artifact identity |

Every column is `NOT NULL`. `artifact_storage_id` is generated always, starts
at `1`, increments by `1`, does not cycle, and its exact sequence is owned by
that column. The other columns have no default except `admitted_at`. Storage-ID
gaps after a rolled-back insert are valid: the surrogate is neither a count,
commit order, cursor, nor domain-visible artifact version.

The payload codec format and version remain inside `canonical_bytes`. They are
not duplicated into SQL columns. In particular, the current value contract
admits every positive JavaScript safe integer as a payload codec version; an
ordinary PostgreSQL `integer` column would silently narrow that contract.

Canonical bytes, not JSONB, are retained because JSONB does not preserve exact
canonical number spelling or byte identity. The point reader reconstructs the
branded canonical JSON string from these bytes.

### Keys And Constraints

`artifact_storage_id` is the primary key. The exact domain-identity uniqueness
rule remains:

```text
(deployment_id, owner, lineage_id, artifact_sha256)
```

One supporting unique key binds a compact row ID back to its complete locality
for dependency foreign keys:

```text
(artifact_storage_id, deployment_id, owner, lineage_id)
```

The accepted explicit constraint names are:

| Name | Rule |
| --- | --- |
| `fx_framework_artifact_storage_pk` | Primary key over `artifact_storage_id` |
| `fx_framework_artifact_identity_unique` | Unique full owner-qualified domain identity |
| `fx_framework_artifact_storage_identity_unique` | Unique storage ID plus deployment, owner, and lineage for sidecar foreign keys |
| `fx_framework_artifact_deployment_fk` | `deployment_id` references `deployments(deployment_id)` with `ON DELETE RESTRICT` |
| `fx_framework_artifact_owner_check` | Owner is exactly one of the three admitted framework owners |
| `fx_framework_artifact_identity_check` | Storage ID is positive; deployment and lineage are each 1 through 1,024 UTF-8 bytes and nonblank under the exact ECMAScript trim set; digest is exactly 32 bytes |
| `fx_framework_artifact_frame_check` | Fixed common format/version, inclusive canonical-byte bounds, and exact stored length |
| `fx_framework_artifact_time_check` | `admitted_at` is finite |

No uniqueness rule exists on lineage alone. Multiple immutable artifact
digests under one lineage are valid history. There is no mutable head, sequence,
or active marker in this table.

The natural unique-key order also supports the only initial listing query: one
exact deployment, owner, and lineage ordered by `artifact_sha256` bytes. No
extra index is needed for that page.

The identity check does not delegate nonblank semantics to PostgreSQL's locale
or generic whitespace classes. Its `btrim` character argument is built from
exactly these Unicode code points:

```text
U+0009 U+000A U+000B U+000C U+000D U+0020 U+00A0 U+1680
U+2000..U+200A U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
```

That set is the current ECMAScript `trim` set used by the implemented value
contract. The generated check constructs it with explicit `chr(...)` members
and requires `btrim(value, exact_set) <> ''` for both deployment and lineage.
It must not use locale-sensitive `\s`, PostgreSQL's default one-argument
`btrim`, or a visually copied Unicode literal. Repository validation still
runs first, but privileged whitespace-only SQL is also rejected physically.

The surrogate is physical compression, not another coordinate or authority.
It prevents dependency primary and uniqueness indexes from repeating multiple
maximum-size text identities. The remaining natural unique key is intentionally
retained and must be tested at the exact 1,024-byte deployment and lineage
ceilings on genuine PostgreSQL; PGlite does not prove PostgreSQL B-tree tuple
limits.

The accepted production database prerequisite for this schema is
`block_size >= 8192`. The maximum natural and supporting keys are designed for
the ordinary 8 KiB-or-larger PostgreSQL B-tree tuple limit, not a custom 4 KiB
build. This additive migration does not install a host prerequisite hook; a
later production-readiness gate must reject a smaller build. This private
checkpoint remains incomplete unless its genuine-PostgreSQL lane observes the
prerequisite and proves the keys with incompressible, well-formed maximum-byte
identities rather than highly compressible repeated text.

The implementation uses Drizzle `bigint(..., { mode: "bigint" })` for every
storage-ID column and a private schema-local custom text type for the explicit
`COLLATE "C"` declarations. Stored codecs accept only JavaScript `bigint`
values from `1n` through `9223372036854775807n`; number coercion is forbidden.
The generated SQL and Drizzle snapshot must retain the collation rather than
depending on the database's default ICU collation.

## Physical Dependency Table

### Table name

`fx_control_framework_schema_artifact_dependency`

### Columns

| Column | PostgreSQL type | Contract |
| --- | --- | --- |
| `artifact_storage_id` | `bigint` | Containing artifact's positive storage identity, represented as JavaScript `bigint` |
| `dependency_storage_id` | `bigint` | Referenced artifact's positive storage identity, represented as JavaScript `bigint` |
| `deployment_id` | `text` | Shared by containing and dependency artifact |
| `owner` | `text COLLATE "C"` | Shared by containing and dependency artifact under deterministic bytewise equality |
| `artifact_lineage_id` | `text COLLATE "C"` | Containing artifact lineage, corroborated by its storage-ID foreign key |
| `dependency_ordinal` | `integer` | Canonical zero-based position, `0..255` |
| `dependency_lineage_id` | `text COLLATE "C"` | Referenced lineage, corroborated by its storage-ID foreign key and different from `artifact_lineage_id` |

Every dependency column is `NOT NULL` and has no default.

There are deliberately no separate dependency deployment or owner columns.
Both foreign keys reuse the row's one `deployment_id` and `owner`, making a
cross-deployment or cross-owner edge physically unrepresentable.

### Keys And Constraints

The exact primary key is:

```text
(artifact_storage_id, dependency_ordinal)
```

The exact additional uniqueness rule is:

```text
(artifact_storage_id, dependency_storage_id)
```

The accepted explicit constraint and index names are:

| Name | Rule |
| --- | --- |
| `fx_framework_artifact_dependency_pk` | One row per canonical dependency position |
| `fx_framework_artifact_dependency_target_unique` | A referenced storage identity occurs at most once per containing artifact |
| `fx_framework_artifact_dependency_parent_fk` | `(artifact_storage_id, deployment_id, owner, artifact_lineage_id)` references the artifact supporting key with immediate, nondeferrable `ON DELETE RESTRICT` |
| `fx_framework_artifact_dependency_target_fk` | `(dependency_storage_id, deployment_id, owner, dependency_lineage_id)` references the same artifact supporting key with immediate, nondeferrable `ON DELETE RESTRICT` |
| `fx_framework_artifact_dependency_identity_check` | Ordinal bounds, distinct storage IDs, and distinct containing/dependency lineages |
| `fx_framework_artifact_dependency_reverse_idx` | Reverse lookup on `(dependency_storage_id, artifact_storage_id)` for FK checks and later dependency inspection |

The shared deployment and owner columns participate in both foreign keys, so a
cross-deployment or cross-owner edge remains physically unrepresentable. The
lineage members are likewise bound to each referenced storage row. A dependency
digest is obtained by joining the referenced immutable artifact row; it is not
duplicated into the sidecar.

The database cannot express “child rows equal the dependency array encoded in
canonical bytes” as an ordinary check constraint. The repository verifies that
equality on insert, exact replay, and full point read.

No update, delete, edge-replacement, or dependency-append API exists. The
tables do not add a trigger that blocks privileged SQL; immutability is the
exclusive repository write policy plus relational constraints and fail-closed
read verification. Raw maintenance that bypasses the repository is outside the
ordinary semantic write authority and may deliberately create corruption that
readers must detect.

## Runtime Authenticity And Preparation

TypeScript brands and a frozen structural object are not runtime authority.
Before persistence exists, the artifact capture owner must retain private
issuance state for every successfully captured artifact. The future
implementation adds a module-owned `WeakMap` keyed by the returned
`FrameworkSchemaArtifact`; its state contains an owned canonical-byte snapshot.
The map is not exported outside the private artifact folder.

The repository exposes a private preparation operation:

```ts
prepareFrameworkSchemaArtifactAdmission(
  artifact: FrameworkSchemaArtifact,
): Result.Result<
  PreparedFrameworkSchemaArtifactAdmission,
  FrameworkSchemaArtifactError
>;
```

Preparation:

1. proves the artifact came from the current capture owner;
2. snapshots its identity, ordered dependencies, canonical byte length and
   bytes, format, and version into repository-owned state;
3. returns a frozen opaque token authenticated through a second private
   `WeakMap`; and
4. performs no SQL and no owner-payload interpretation.

A cast-forged, cloned, or independently reconstructed token fails with
`operation: "admit"` and `reason: "invalidInput"` before query construction.
Cold callers recapture their source artifact; they do not deserialize or mint a
prepared token.

The stored decoder reconstructs values through the same canonical capture
owner, so a successfully read artifact is also an owned authentic value. None
of these runtime markers proves installation, readiness, binding, or mutation
authority.

## Admission Operation

The only admission entry point is the transaction-owning private repository:

```ts
interface FrameworkSchemaArtifactAdmissionResult {
  readonly status: "created" | "existing";
  readonly artifact: FrameworkSchemaArtifact;
}

admitFrameworkSchemaArtifactEffect(
  repository: FrameworkSchemaArtifactRepository,
  prepared: PreparedFrameworkSchemaArtifactAdmission,
): Effect.Effect<
  FrameworkSchemaArtifactAdmissionResult,
  FrameworkSchemaArtifactError,
  never
>;
```

`FrameworkSchemaArtifactRepository` and the prepared token are opaque private
values authenticated before query construction. The repository owns a private
control-session starter plus begin, explicit `READ COMMITTED` isolation,
commit, rollback, quarantine/release, and settlement. It never accepts a caller
transaction or top-level database. `REPEATABLE READ` and `SERIALIZABLE` are not
accepted substitutions for this checkpoint: a contender that waits on the
deployment row must take later statement snapshots that can observe the winner
before it performs the natural-identity read.

Repository construction captures positive safe-integer
`readTimeoutMilliseconds`, `attemptTimeoutMilliseconds`,
`recoveryTimeoutMilliseconds`, and `lockTimeoutMilliseconds` policy values.
Each is at most `60_000`, and the lock timeout cannot exceed either enclosing
transaction deadline. These are trusted composition-time values, not per-call
or framework-controlled input. Public point reads and lists use the read
deadline. The initial admission deadline starts before its optimistic
reconstruction and covers that read, session acquisition, transaction work,
settlement, release, and any initial `resolveExisting` reconstruction. The
recovery deadline starts as soon as initial settlement becomes uncertain and
covers quarantine of that session, acquisition of a distinct session,
transaction work, settlement, and any recovery reconstruction. The connection
owner contract applies the remaining budget to acquisition, bounded autocommit
reads, host callback interruption, `lock_timeout`, and `statement_timeout`.
Expiration must request destruction of the owned session, drain tracked native
work before returning or report bounded cleanup failure, and never make that
session reusable. Cleanup may outlive the operation or recovery deadline only
within the adapter's separate bounded drain window. The private adapter defaults
that window to 5,000 ms and
accepts only trusted construction values from 1 through 60,000 ms. It snapshots
and freezes adapter options once during construction, so later caller mutation
or changing getters cannot weaken the bound. Failure to destroy or settle
within that window is explicit quarantine failure, stops recovery, and never
makes the connection reusable.

Admission first performs a full point read outside a write transaction through
an admission-owned projection of the shared reconstruction mechanics. An
absent identity proceeds to the locked phase. A valid exact artifact returns
`existing`; a valid artifact with the same full identity and different
canonical bytes is `digestCollision`; invalid stored evidence is
`storedStateCorrupt`. Because supported rows are immutable, this fast path
does not need a write lock. It never calls the public read facade and therefore
never leaks an `operation: "read"` error.

For each attempt the starter acquires one exclusive control connection, begins
the transaction, makes isolation configuration its first statement, and
installs the remaining local lock/statement budgets. The facade wraps the
driver callback's raw transaction in one active session capability; repository
code authenticates that capability and immediately replaces it with an opaque
`FrameworkSchemaArtifactControlTransaction`. The package-private locked
primitive authenticates the repository token before any artifact-table query
and executes this order:

1. lock `deployments(deployment_id)` for update;
2. fail with `deploymentMissing` if that row does not exist;
3. read the artifact row by the full identity;
4. if it now exists, compare its fixed columns, exact byte length and byte
   equality, finite audit time, and complete ordered dependency rows without
   transferring, decoding, or hashing the stored canonical frame;
5. return internal `existing` only when that bounded evidence exactly matches
   the prepared artifact; otherwise return an internal `resolveExisting`
   marker after performing no write;
6. if the artifact is absent, resolve every dependency in one bounded
   ordinal-bearing `VALUES` join by full natural identity, retain its
   database-only storage ID, and fail on the first missing canonical ordinal
   with `dependencyMissing` unless the exact set already exists;
7. insert the artifact row without `ON CONFLICT DO NOTHING` and retain its
   returned storage ID;
8. insert all dependency rows in one bounded statement with those storage IDs
   and canonical ordinals;
   and
9. return internal `created` with the already owned artifact.

The internal decision is not a repository result type and never leaves the
artifact package. After a `resolveExisting` marker, the read-only locked phase
ends and the repository invokes the admission-owned full reconstruction outside
the deployment lock. Only that validated reconstruction may allocate a new
admission `digestCollision`; malformed, noncanonical, or contradictory stored
evidence becomes an admission `storedStateCorrupt`. A row that disappears after
the locked phase was observed is likewise admission corruption; the repository
does not convert that contradiction into a fresh insert. This prevents
privileged corruption from being mislabeled as a cryptographic collision and
prevents the public `read` or `classifyReplay` operation labels from escaping
the admission boundary.

Artifact admission performs no canonical encoding, hashing, JSON parsing,
owner-codec validation, compiler work, user code, DDL, installation, or
activation while the deployment lock is held.

The transaction bridge records its lifecycle phase and the full callback
`Exit`; it does not flatten every callback rejection into a resource error:

- a typed callback failure such as `deploymentMissing`, `dependencyMissing`,
  stored corruption, or SQL resource failure is re-emitted with its original
  Effect `Cause` after confirmed rollback;
- callback interruption or defect likewise remains authoritative after
  confirmed rollback;
- rollback or cleanup failure combines the original callback `Cause` with a
  cleanup defect and quarantines the connection; and
- an acquisition, begin, isolation, or transaction infrastructure failure
  before a successful `created` callback is an admission `resourceFailure`
  only when no commit could have started. Cleanup evidence is preserved rather
  than discarded.

After callback success, the starter drains commit/rollback settlement before
returning. A rejection or unsafe release after a `created` decision is an
uncertain commit settlement. The connection is quarantined and discarded
before recovery; it is never returned to the pool. Only after confirmed
quarantine does the repository perform exactly one recovery attempt with the
same authenticated input, exact `READ COMMITTED` semantics, and a distinct
usable control session. The deployment lock then forces any surviving earlier
backend work to settle before recovery can observe exact replay or insert.

A confirmed recovery returns its own `created` or `existing` result. A
recovery `resolveExisting` marker is classified by the same admission-owned
out-of-lock reconstruction. Failure to quarantine the first session yields
`decisionUncertain` at stage `settle`; failure, timeout, or uncertain settlement
after recovery begins yields `decisionUncertain` at stage `recover`. Both the
initial settlement cause and the later resolution cause are retained. The
repository never guesses, exceeds the recovery deadline, or starts a second
recovery. A settlement rejection after an initial internal `existing` or
`resolveExisting` decision made no write; after quarantine it is resolved by
the out-of-lock reader and ordinary admission failure mapping rather than
reported as mutation uncertainty. Callers must not blindly retry
`decisionUncertain`; a later operator/recovery preflight must own authoritative
resolution.

After an uncertain first settlement, the returned status is the recovery
decision, not a claim about which physical attempt first inserted the row. For
example, a committed first insert followed by exact recovery returns
`existing`; the durable artifact is the contract, not historical winner
attribution.

Preparation and the optimistic read remain interruptible. Once a transaction
starts, its callback is interruptible but rollback/commit drainage,
quarantine/release, and any required recovery run in an uninterruptible
finalization region. An interrupt before callback success is re-emitted with
its original interruptor set after confirmed rollback. An interrupt arriving
after `created` is held until durable recovery converges, then re-emitted. If
the recovery ends in `decisionUncertain`, that typed failure is combined with
the pending interruption Cause so neither operational fact is erased.

The deployment row is a deliberately coarse control-plane serialization
point. It already precedes Application schema-version artifact work and gives
one unambiguous lock order. Same-deployment admissions serialize, while
different deployments retain independent row locks. It is the first and only
control-plane write-lock family entered by this repository-owned transaction.
A future composite transaction may not call the facade recursively or reuse
its locked primitive without a separate lock-order preflight.

Artifact and dependency rows need no additional `FOR UPDATE` lock in this
checkpoint. They have no supported mutation or deletion, the deployment lock
serializes their sole writer, and both dependency foreign keys are immediate
and nondeferrable. A future delete, repair, or finer-grained admission owner
would require a new lock and concurrency preflight.

### Replay And Conflict Semantics

| Stored state | Admission result |
| --- | --- |
| No row and every dependency exists | Insert parent and dependency rows; `created` |
| Equal full identity, canonical bytes, and dependency rows | No write; `existing` |
| Equal full identity and different canonical bytes in a fully valid stored artifact | `digestCollision` |
| Malformed or contradictory stored frame, fixed columns, digest, audit time, or dependency rows | `storedStateCorrupt` |
| Different digest under the same deployment/owner/lineage | Distinct artifact; eligible for `created` |
| Any missing dependency identity | `dependencyMissing`; insert nothing |
| Missing deployment | `deploymentMissing`; insert nothing |

There is no “latest wins,” lineage overwrite, fallback, merge, or partial edge
repair.

### Dependency Acyclicity

For supported writes, every new edge points to an artifact that existed before
the containing artifact row was inserted. Existing artifacts and dependency
rows cannot be changed later. Together with same-lineage rejection, that makes
the admitted graph acyclic by construction. Back-to-back admissions still use
separate repository-owned transactions, so a dependency must be durably
admitted before the dependent admission can observe it.

Immediate foreign keys alone do not prove this against privileged raw SQL that
inserts parent rows first and edges later. The acyclicity claim therefore
depends on the private repository remaining the sole ordinary write owner. A
future bulk-admission API would need its own topological-order and concurrency
preflight.

Dependency admission proves exact identity existence, not owner-payload
semantics, installation, readiness, or recursive closure validity. A consumer
must point-read and decode every dependency it intends to interpret.

## Point Read Contract

The first point reader is:

```ts
getFrameworkSchemaArtifactEffect(
  repository: FrameworkSchemaArtifactRepository,
  identity: FrameworkSchemaArtifactIdentity,
): Effect.Effect<
  FrameworkSchemaArtifact | null,
  FrameworkSchemaArtifactError,
  never
>;
```

It authenticates the exact repository and validates the complete identity
before query construction. An absent row is `null`; absence is not corruption
and this repository does not convert it to an installation-level
`artifactMissing` error.

The repository's read deadline starts before connection acquisition and spans
both queries plus reconstruction and hashing. Detached rows are retained and a
healthy session is released before CPU/crypto reconstruction. The timeout
contract must drain or cancel active database work, discard an active session
when necessary, and only then return a read `resourceFailure` at the active
persistence stage. Deterministic adapter evidence covers that contract, and
native detached-reconstruction evidence covers the healthy-release path. Native
active-SQL drain-before-return is now covered by the accepted correction in
[`03-postgres-active-work-quarantine.md`](./03-postgres-active-work-quarantine.md).

For a present row, the reader:

1. computes canonical byte length in SQL and substitutes `NULL` for oversized
   bytes before transferring a corrupt payload to the worker;
2. detaches driver rows and byte arrays before asynchronous work;
3. validates the storage ID, natural key, fixed format/version, stored and
   observed byte lengths, digest length, and finite audit time;
4. fatally decodes UTF-8 and parses JSON;
5. validates the exact ten-field persisted frame and projects the eight-field
   capture input without trusting computed identity fields;
6. reruns common capture to establish the exact canonical text, SHA-256,
   brands, deep ownership, and runtime authenticity;
7. compares reconstructed identity and canonical bytes with every stored
   column;
8. reads at most 256 dependency rows in one joined query, orders them by
   ordinal, and compares the complete dense natural-identity sequence with the
   reconstructed canonical dependencies; and
9. returns the reconstructed immutable artifact only after all checks pass.

Malformed UTF-8, invalid JSON, extra or missing frame fields, noncanonical JSON,
identity drift, digest drift, invalid time, oversized evidence, missing or
extra dependency rows, ordinal gaps, and dependency-order drift are
`storedStateCorrupt` under `operation: "read"`.

A stored frame that common capture rejects is corruption, not caller
`invalidInput`. A platform hashing failure is a read `resourceFailure` with its
cause preserved. Canonical encoder or digest-output invariants remain defects.

The two tables expose no supported mutation, so the parent and dependency
queries need no long-lived transaction for ordinary reads. This does not claim
a coherent view against concurrent privileged corruption or ad hoc SQL repair.
If such maintenance becomes supported, it needs an explicit snapshot and
repair protocol.

## Bounded Identity Listing

The list operation is deliberately narrower than point read:

```ts
interface ListFrameworkSchemaArtifactIdentitiesInput
  extends FrameworkSchemaArtifactCoordinate {
  readonly afterArtifactSha256: FrameworkSchemaArtifactSha256 | null;
  readonly limit: number;
}

interface FrameworkSchemaArtifactIdentityPage {
  readonly items: readonly FrameworkSchemaArtifactIdentity[];
  readonly nextAfterArtifactSha256:
    | FrameworkSchemaArtifactSha256
    | null;
}

listFrameworkSchemaArtifactIdentitiesEffect(
  repository: FrameworkSchemaArtifactRepository,
  input: ListFrameworkSchemaArtifactIdentitiesInput,
): Effect.Effect<
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactError,
  never
>;
```

Rules:

- the exact repository is authenticated before input validation or query
  construction;
- the repository read deadline spans acquisition, the bounded query, row
  decoding, and page construction; timeout is a list `resourceFailure`;
- `limit` is required and must be a safe integer from `1` through `100`;
- `afterArtifactSha256` is an explicit nullable exclusive keyset cursor;
- the query fixes deployment, owner, and lineage, orders
  `artifact_sha256 ASC`, and reads at most `limit + 1` rows;
- PostgreSQL `bytea` ordering matches the lowercase hexadecimal digest order
  for this fixed-length identity;
- when an extra row exists, `nextAfterArtifactSha256` is the digest of the last
  returned item; otherwise it is `null`;
- returned arrays, identity objects, and the page are fresh and frozen;
- invalid stored identity columns are `storedStateCorrupt`; and
- the list never transfers canonical bytes or dependency rows.

The page is discovery evidence only. It does not prove that each listed row's
canonical payload is valid. A caller must use the point reader before
interpreting an artifact. There is no unbounded list, cross-owner list,
cross-lineage list, creation-time order, or `latest` helper in this checkpoint.
Because deployment, owner, and lineage are fixed filters, this query makes no
claim that locale-sensitive PostgreSQL text order matches the artifact value
comparator; only fixed-length digest bytes are ordered in SQL.

## Typed Failure Contract

This preflight completes the first repository portion of
`FrameworkSchemaArtifactError`.

Operations become:

```text
capture | classifyReplay | admit | read | list
```

This checkpoint adds `deploymentMissing`, `dependencyMissing`,
`storedStateCorrupt`, and `decisionUncertain` to the existing artifact
vocabulary. Exact operation/reason ownership is:

| Operation | Reasons admitted by this checkpoint |
| --- | --- |
| `capture` | `invalidInput`, `ownerNotAdmitted`, `resourceFailure` |
| `classifyReplay` | `digestCollision` |
| `admit` | `invalidInput`, `deploymentMissing`, `dependencyMissing`, `digestCollision`, `storedStateCorrupt`, `resourceFailure`, `decisionUncertain` |
| `read` | `invalidInput`, `storedStateCorrupt`, `resourceFailure` |
| `list` | `invalidInput`, `storedStateCorrupt`, `resourceFailure` |

`unsupportedCodec` remains reserved for a later owner-payload consumer. The
common repository understands only the fixed common frame; it does not reject
or interpret a syntactically valid Payload, Medusa, or system payload codec.

The implemented capture and replay messages remain unchanged. New repository
factories use these exact stable messages:

| Operation and reason | Message |
| --- | --- |
| `admit / invalidInput` | `Framework schema artifact admission input is invalid` |
| `admit / deploymentMissing` | `Framework schema artifact deployment is missing` |
| `admit / dependencyMissing` | `Framework schema artifact dependency is missing` |
| `admit / digestCollision` | `Framework schema artifact digest collision` |
| `admit / storedStateCorrupt` | `Stored framework schema artifact state is corrupt` |
| `admit / resourceFailure` | `Framework schema artifact admission persistence failed` |
| `admit / decisionUncertain` | `Framework schema artifact admission decision is uncertain` |
| `read / invalidInput` | `Framework schema artifact identity is invalid` |
| `read / storedStateCorrupt` | `Stored framework schema artifact state is corrupt` |
| `read / resourceFailure` | `Framework schema artifact read failed` |
| `list / invalidInput` | `Framework schema artifact list input is invalid` |
| `list / storedStateCorrupt` | `Stored framework schema artifact state is corrupt` |
| `list / resourceFailure` | `Framework schema artifact list failed` |

Every error keeps the implemented `operation`, `reason`, `message`, and
`retryable: false` fields. Repository errors add only these optional diagnostic
facets, with every non-applicable facet absent rather than present as
`undefined`:

- `deploymentMissing` carries the exact `deploymentId` spelling;
- admission `digestCollision` carries a detached frozen `identity`;
- `dependencyMissing` carries the containing `identity`, the missing frozen
  `dependencyIdentity`, and its `dependencyOrdinal`;
- admission/read `storedStateCorrupt` carries the requested `identity` and a
  `storedStage` of `artifactRow`, `canonicalFrame`, or `dependencyRows`;
- list `storedStateCorrupt` carries the requested frozen `coordinate` and
  `storedStage: "artifactRow"`;
- admission/read `resourceFailure` carries the requested `identity`, a
  persistence `stage`, and the original `cause`; list `resourceFailure` carries
  the requested `coordinate`, stage, and cause; and
- `decisionUncertain` carries the requested `identity`, a stage of `settle` or
  `recover`, the original `initialSettlementCause`, and the later
  `resolutionCause`. Both cause facets preserve their foreign object identity;
  the ordinary optional `cause` facet is absent for this reason.

The complete persistence-stage vocabulary is `transaction`,
`lockDeployment`, `readArtifact`, `readDependencies`, `insertArtifact`,
`insertDependencies`, `reconstructArtifact`, `listArtifacts`, `settle`, and
`recover`. Identity and coordinate facets are fresh detached frozen values;
foreign causes retain their original identity. The existing capture hash
failure remains the only capture error with a cause, and the implemented
`classifyReplay` collision shape remains unchanged.

Shared stored reconstruction returns package-private neutral issues rather
than an operation-tagged public error. The read facade projects those issues to
`operation: "read"`; admission projects them to `operation: "admit"`, retaining
the identity, stored stage, persistence stage, and foreign cause. Admission
also allocates its own collision error after replay classification. It never
leaks a read or `classifyReplay` error object.

All failures remain non-retryable at the artifact-operation level. The
repository itself performs only the one whole-admission settlement recovery
defined above; it never retries one statement, reuses a failed transaction, or
performs an unbounded recovery loop. `decisionUncertain` is an explicit stop
condition, not permission for a caller retry.

Only a foreign SQL, transaction, or hashing boundary attaches a cause. Query
construction, impossible decoder states, runtime intrinsic failures not owned
by the mapped resource boundary, and invariant violations remain defects.
Stored corruption is never relabeled as caller input, a missing dependency, a
digest collision, or an exact replay.

## Effect And Transaction Boundary

- Pure input, stored-row, identity, cursor, and dependency comparisons use
  `Result`.
- SQL and Web Crypto remain `Effect` boundaries with typed failures.
- Every started SQL Promise settles before healthy connection reuse or commit.
  The adapter tracks native and supported foreign Promise-like query results;
  a settled rejection is retained through the drain and prevents commit even
  when callback code detached or caught that query. A rejection already
  observed before another operation exhausts the drain deadline remains in the
  final operational `Cause`; destruction-induced rejections remain quarantine
  settlement evidence rather than quarantine failure by themselves.
  After quarantine requests client destruction, the adapter waits only through
  its separate bounded drain window; timeout is cleanup failure and the client
  remains permanently non-reusable.
- The transaction callback is interruptible. Once started, its Promise is
  settled before healthy commit/rollback/release. Connection quarantine and
  the single recovery remain uninterruptible finalization, subject to the
  bounded post-destroy drain rule above.
- The Promise transaction adapter preserves the callback's full `Exit` and
  enclosing Effect context and bridges only foreign lifecycle failures. No
  broad `tryPromise` remaps typed callback failure, interruption, or defect
  into an ordinary resource error.
- The opaque repository owns the transaction. Its authenticated locked
  primitive receives only the repository-issued control-transaction token;
  neither a raw top-level database nor a caller transaction can satisfy it.
- Exactly one whole-admission recovery is allowed after an uncertain `created`
  settlement, and it runs on a distinct usable session within the captured
  recovery deadline; there is no statement retry or recursive facade call.
- There is no service, Layer, Context tag, singleton transaction, or product
  runtime composition in this checkpoint. Explicit values are the clearer
  private boundary.
- The Promise-driver compatibility bridge lives only in the private
  control-session adapter and preserves one `Effect.runPromiseExit` result;
  there is no `Effect.runPromise` inside the domain repository.

The deployment row lock is this operation's only fence. Artifact admission is
not scope-local serving or mutation work, so it does not lock the scope clock,
resolve storage generation, allocate commit order, or publish feed/outbox
facts. Installation and binding operations will have separate target and scope
fences in their later preflights.

## Static Platform Migration Contract

These two control tables are Flarex platform storage. Their creation uses the
existing checked-in Drizzle migration runner, not the future framework
migration coordinator described in
[`../03-relational-schema-and-migrations.md`](../03-relational-schema-and-migrations.md).
The coordinator will install framework-owned relational structures; it does
not install its own control ledger or artifact registry.

At the time of this preflight, the Drizzle ledger ends at
`0078_workable_the_captain`. The implementation must recheck the current head
and use the next free ledger slot; this record does not reserve the literal
number `0079` against concurrent work.

The implementation sequence is:

1. add the two tables in the private `schema.ts` module;
2. re-export them only from `src/drizzleSchema.ts`;
3. run the package `db:check` before generation;
4. generate one migration through the package `db:generate` script;
5. inspect the generated SQL, journal entry, and snapshot together;
6. create the artifact table and its named identity sequence before the
   dependency table, then add only the constraints and reverse index in this
   record; and
7. rerun `db:check` after generation.

The migration is additive and starts both tables empty. It performs no
backfill, table rewrite, DML against existing rows, Application-table lock,
trigger installation, active-head update, or framework schema DDL. Existing
deployment, Application artifact, readiness, and activation rows remain
unchanged.

Constraint names are explicit and below PostgreSQL's 63-byte identifier limit;
generated long names for the dependency table must not be accepted silently.

## Evidence Matrix

### Pure And Package-Boundary Evidence

- prepared admission rejects a cast-forged artifact or token before SQL;
- canonical bytes retained by preparation are detached from caller state;
- repository construction rejects invalid timeout policy before issuing a
  repository, and operations expose no per-call timeout override;
- repository operations reject a cast-forged repository, a raw database, a
  located target database, and an independently composed or cross-repository
  control-transaction token before SQL;
- the composition check succeeds only for the exact repository/control-database
  pair retained by the trusted control composition root;
- no new root export, export-map entry, Payload import, Medusa import, route,
  service, Layer, or runtime caller appears; and
- existing artifact-value and Application-authority tests remain unchanged.

### Deterministic Control-Session Evidence

Package-local model tests prove:

- one opaque starter authenticates only its exact control database; forged,
  cloned, proxied, and cross-database compositions fail closed;
- one absolute Effect-clock deadline supplies only positive whole-millisecond
  budgets and treats sub-millisecond residue as expired;
- initial and recovery decisions retain exact phase order, callback `Cause`,
  cleanup defects, quarantine-before-recovery, the distinct-session
  requirement, and a one-recovery ceiling;
- post-settlement `resolveExisting` work runs outside the transaction and
  remains mandatory finalization before a pending interrupt is re-emitted;
- both `decisionUncertain` stages retain the initial settlement cause and the
  later resolution cause without demoting recovery defects or interruption to
  inert data; and
- repository-issued control-transaction tokens authenticate their exact
  repository, issuing starter, and raw transaction only inside an
  authenticated active session callback, then both capability levels are
  revoked.

These deterministic receipts prove the lifecycle policy and authority
boundary. They do not prove PostgreSQL pool checkout, native timeout,
quarantine/discard, backend-session distinction, locking, or concurrency.

### Deterministic PostgreSQL Adapter Evidence

Package-local fake-pool/client tests prove only the private adapter's
orchestration:

- callback execution retains the enclosing Effect context, including an
  injected Effect clock;
- callback-started native and foreign Promise-like SQL operations drain before
  `COMMIT`; a retained rejection prevents commit, exact `COMMIT` command tags
  are required, and healthy release occurs only after settlement;
- exact `ROLLBACK` command tags are required before rollback is considered
  confirmed; mismatch retains the primary callback or resource `Cause`, adds
  rollback-cleanup evidence where applicable, and quarantines the client;
- transaction preparation retains `BEGIN`, `READ COMMITTED`, and parameterized
  positive transaction-local lock/statement budget order on one acquired
  client;
- Effect-clock acquisition expiry requests destruction of a client delivered
  after abandonment, while active-work expiry requests destruction and drains
  the already-started work before returning;
- deadline-exhausted initial and recovery callbacks proceed to destruction and
  bounded cleanup even when their tracked SQL cannot settle;
- session-construction failure and failed ordinary release both request client
  destruction, while a failed destroy plus non-settling work stops at the
  bounded quarantine-drain limit with explicit cleanup failure, using the
  construction-snapshotted timeout despite changing option getters;
- post-commit uncertainty quarantines the initial client, rejects the same
  physical client when reacquired, and permits only one distinct recovery
  session; and
- read interruption and initial/recovery deadline cancellation retain nested
  finalizer defects through cleanup, while an ordinary transaction-callback
  interruption rolls back and releases before the complete `Cause` is
  re-emitted.

These receipts use deterministic `pg` pool/client doubles. They do not prove
native pool discard, backend-session identity, timeout enforcement,
transaction outcome, locking, or concurrency. A URL-gated server probe exists
for one backend, `READ COMMITTED`, positive local budgets, and exact read
`statement_timeout` restoration. The focused ordinary-role PostgreSQL 18 lane
now runs that probe, proves the two native interruption scenarios, and supplies
the seven completed native deadline receipts recorded under Genuine PostgreSQL
Evidence below. Deterministic doubles remain the only passing evidence for
cleanup failures and wider fault combinations not explicitly recorded as
native evidence.

### PGlite Migration Evidence

PGlite must prove:

- fresh migration and a second idempotent migration;
- both table names in the exact table inventory;
- catalog evidence that `artifact_storage_id` is generated always from the
  exact named sequence, and rejection of a caller-supplied storage ID;
- catalog evidence for the explicit `C` collation on every owner, lineage, and
  frame-format column;
- upgrade from the immediately previous migration head with representative
  deployment and Application artifact state unchanged;
- both new tables start empty;
- injected migration failure rolls back both tables, the named identity
  sequence, and the migration receipt;
- primary, unique, and check constraints, all three foreign keys with their
  immediate nondeferrable behavior and `ON DELETE RESTRICT` actions, and the
  reverse index;
- physical rejection of each exact ECMAScript trim character alone and in a
  mixed whitespace string for both deployment and lineage, while a non-trim
  character such as `U+200B` remains admissible; and
- cold close/reopen retains the same rows and constraints.

### PGlite Repository Evidence

The private point-read foundation provides strict detached identity decoding,
repository authentication before identity access, absent and dependency-bearing
reads, release before reconstruction and hashing, exact query-stage failures,
stored-corruption projection, hash-cause preservation, and one absolute
deadline through post-release hashing. Stored-codec coverage retains the
exhaustive row, frame, and dependency corruption matrix.

Private locked admission provides a transaction-owning facade, one initial
deadline spanning optimistic read and the control-session lifecycle, compact
in-lock replay comparison, one bounded ordinal dependency-resolution join,
atomic parent and edge insertion, and admission-owned out-of-lock
reconstruction. PGlite coverage includes created and optimistic-existing
outcomes, immutable lineage history, missing deployment, missing-dependency
ordinals, canonical dependency-edge order, the 256-dependency boundary,
compact locked exact replay without hashing, authentic collision versus stored
corruption, a raced compact mismatch that hashes only after the transaction,
parent rollback after dependency-insert failure, and exact
`decisionUncertain / settle` projection. It does not establish native
row-locking, concurrency, quarantine, distinct-session recovery, or deadline
behavior.

Private bounded identity listing authenticates the repository before strict
five-field request decoding, requires an explicit `1..100` limit and nullable
exclusive digest cursor, fixes the complete coordinate, and reads only the four
identity columns in byte order with one lookahead row. Focused PGlite coverage
proves null and non-existent gap cursors, digest-boundary ordering, empty and
terminal pages, the exact 100/101 boundary, last-returned cursors, deployment/
owner/lineage isolation, fresh frozen identity-only pages, success without the
canonical-bytes column or dependency table, corrupt lookahead projection, and
ordinary SQL-rejection mapping. Every lookahead row is decoded before slicing.
This evidence does not claim snapshot pagination or genuine PostgreSQL index,
driver, collation, cancellation, or pool behavior.

Remaining PGlite repository evidence must prove:

- same-deployment/same-owner dependency admission and physical rejection of
  cross-owner, cross-deployment, duplicate-target, or same-lineage rows;
- raw ordinal reordering is admitted only as deliberate corruption and is
  rejected by exact replay and full point read;
- full read, absent read, bounded size gate, invalid UTF-8, invalid JSON,
  noncanonical frame, identity/digest/frame drift, invalid audit time, and every
  dependency mismatch;
- interruption settlement;
- no owner-codec work while the lock is held.

PGlite does not prove row-lock blocking, concurrent claim convergence,
connection quarantine, distinct-session recovery, deadline enforcement,
deadlock behavior, or genuine PostgreSQL migration semantics.

### Genuine PostgreSQL Evidence

Before the private repository checkpoint is complete, genuine PostgreSQL must
prove:

- the additive migration applies atomically in a temporary schema, rolls back
  on injected failure, records one receipt, and replays idempotently;
- native constraint, collation, identity-sequence, and index definitions match
  this preflight;
- a caller-supplied `artifact_storage_id` is rejected by native
  `GENERATED ALWAYS` behavior;
- `SHOW block_size` is at least 8 KiB, and incompressible exact maximum-size
  deployment and lineage identities fit the natural and supporting B-tree keys
  while compact dependency indexes remain valid;
- concurrent exact admission converges to one `created` result and the rest
  `existing` with one parent and one exact edge set;
- concurrent equal-identity/different-canonical claims produce one winner and
  typed digest collisions, never two semantic rows;
- a dependency-admission race follows deployment-lock order: the dependent
  either observes the already committed dependency or fails cleanly before any
  parent row;
- `pg_blocking_pids` proves same-deployment contenders wait on the deployment
  row, different deployments do not block each other, and `READ COMMITTED`
  observes the winner after lock acquisition;
- deployment, owner, and lineage identities remain logically isolated under
  contention;
- rollback releases the deployment lock and leaves no partial parent or edge;
- interruption during callback work rolls back before the interrupt Cause is
  re-emitted, while interruption during `COMMIT` drains settlement and required
  recovery first;
- driver-level pre-commit and post-commit settlement fault injection proves
  the uncertain connection is discarded, recovery uses a distinct backend
  session, and convergence reaches `created` or `existing` without duplicate
  rows;
- acquisition, lock, statement, and recovery-deadline faults are bounded; a
  timed-out recovery must discard its session and yield one non-retryable
  `decisionUncertain` with both original causes and no second attempt;
- the optimistic query phase and post-`resolveExisting` work obey the initial
  attempt deadline. Timed-out active SQL must drain after its checked-out
  backend is destroyed and before admission returns. Detached optimistic
  reconstruction keeps the same deadline after its healthy read backend has
  already been released, while post-resolution reconstruction must discard its
  still-owned read backend on timeout; and
- the deployment-first lock order introduces no deadlock in the supported
  operation sequence.

Focused ordinary-role PostgreSQL 18 evidence now proves the additive migration
rollback, receipt and idempotent replay; native catalog, collation, identity,
constraint and index shapes; 8 KiB block-size/key-fit assumptions; native
`GENERATED ALWAYS` rejection; one-backend `READ COMMITTED` control-session
budgets and read reset; present and absent point read; concurrent exact
admission converging to one `created` result and one physical dependency-edge
set; and `pg_blocking_pids` observation of contenders queued behind the
deployment row before the later contender observes the committed winner. The
same waiter graph proves equal-identity/different-canonical contention stores
exactly one canonical winner and returns one typed `digestCollision`; parent-
first dependency admission fails with exact `dependencyMissing` evidence,
leaves no parent or edge, and releases the queued dependency; dependency-first
admission commits before the already-started parent reads under `READ
COMMITTED`, producing one exact edge; and an independent deployment commits
and becomes externally visible while the first deployment remains blocked.
Same-deployment contenders carrying one forced digest now prove that distinct
owner and lineage coordinates create three exact physical rows while an exact
duplicate converges to `existing`. An ordinary-role test trigger observes the
new parent inside the admission transaction before rejecting dependency-edge
insertion; the typed `insertDependencies` resource failure leaves the existing
dependency intact, rolls back the parent and all edges, releases the lock, and
permits a clean retry. The catalog assertion reads nullability from
`information_schema.columns` and excludes PostgreSQL 18's duplicate
`pg_constraint` `contype = 'n'` entries from the separately asserted named-
constraint inventory.

Two cross-owner ordinary-role scenarios now prove the supported deployment-
first sequence against the existing Application schema-version artifact writer.
All artifact preparation completes before either transaction starts. A targeted
`BEFORE INSERT` trigger blocks the first writer on an external advisory
transaction lock only after that writer owns the deployment row; native
`pg_stat_activity` and `pg_blocking_pids()` then prove the second writer is
waiting on its own `deployments ... FOR UPDATE` behind that exact backend. The
test runs once with the dependency-bearing framework admission first and once
with the Application writer first, producing the acyclic wait graph external
blocker -> holder -> deployment waiter in both directions. After release, both
first attempts return `created`, both exact replays return `existing`, and one
Application row, one framework dependency, one parent, and one edge remain.
This is supported cross-owner lock-order evidence, not universal PostgreSQL
deadlock freedom, forced-`40P01` recovery, composite-transaction reuse, or a
new retry policy.

Driver-edge fault injection immediately before native `COMMIT` now proves that
the uncommitted backend is removed and absent from `pg_stat_activity`, one
distinct recovery backend creates the dependency-bearing parent, and the final
result is `created`. Injection immediately after PostgreSQL acknowledges
`COMMIT` proves the same quarantine and distinct-backend recovery observes the
durable parent and returns `existing`. Both paths retain exactly one parent and
one dependency edge and replay as `existing`. This is deterministic driver-edge
settlement evidence, not evidence for a TCP partition, server crash, lost
acknowledgement in transit, or interruption while PostgreSQL is executing a
statement.

Separate ordinary-role tests now use PostgreSQL advisory-lock barriers plus
`pg_stat_activity` and `pg_blocking_pids`, rather than a timing-only callback,
to prove both interruption paths. During callback work, a `BEFORE INSERT`
dependency-edge trigger first observes the already-inserted parent and then
blocks that edge statement. An Effect interruption remains unsettled until the
barrier is released and the statement drains; native rollback and healthy
release finish before an `Exit` containing exactly one interrupt and no typed
failure or defect is re-emitted. The pre-existing dependency remains, no parent
or edge survives, and a clean retry creates once and then replays as `existing`.
No `COMMIT`, quarantine, or recovery begins. This proves statement drainage and
transaction rollback, not driver query cancellation.

During native `COMMIT`, a targeted `DEFERRABLE INITIALLY DEFERRED` constraint
trigger blocks the initial backend, and the server activity row proves that
exact backend is active on `COMMIT` while waiting for the advisory-lock holder.
The Effect interruption remains unsettled through that server-side `COMMIT`;
after release, a test-only post-acknowledgement driver-edge fault makes the
result uncertain. That synthetic fault, not the interruption, causes the
initial backend to be quarantined and removed; exactly one distinct recovery
backend observes the durable parent and edge before an `Exit` with one interrupt
reason and no typed failure or defect is re-emitted. The stored artifact then
replays as `existing`. This composes native `COMMIT`-in-flight interruption with
deterministic driver-edge acknowledgement uncertainty. It does not simulate
query or `COMMIT` cancellation, a TCP partition, socket reset, server crash or
failover, backend termination, or lost acknowledgement in transit, and it does
not add a combined `decisionUncertain`/interruption failure claim.

The focused deadline lane now supplies five independent ordinary-role
PostgreSQL 18 receipts. A dedicated one-connection pool proves that an initial
deadline can expire while native node-postgres acquisition is queued, that the
late-delivered backend is destroyed and disappears from `pg_stat_activity`,
that no transaction or artifact write starts, and that a clean retry creates
and replays the artifact. A held deployment row plus a frozen Effect test clock
lets PostgreSQL's real clock enforce `lock_timeout`; SQLSTATE `55P03` maps to
`lockDeployment`, rolls back, releases the healthy backend without removal,
leaves no artifact state, and permits a clean retry. A parent-insert trigger
sets a transaction-local two-second statement budget before a dependency-edge
trigger sleeps; PostgreSQL returns SQLSTATE `57014` at `insertDependencies`,
rolls back the parent and edge while retaining the dependency, and releases the
healthy backend before retry succeeds.

The same lane proves the reconstruction lifetime distinction. When optimistic
queries find an already stored artifact, the native read backend is healthy,
idle, and released before controlled hashing stalls; advancing the original
initial deadline returns `resourceFailure / reconstructArtifact` without pool
removal or stored-state change, and restored hashing replays as `existing`. In
an absent-then-collision race, the first waiter commits the authentic winner,
the second commits a read-only `resolveExisting` decision, and its subsequent
native read backend is idle but still checked out while controlled hashing
stalls. Expiry returns the same reconstruct stage, removes that owned backend,
preserves the single winner byte-for-byte, and an ordinary retry returns the
expected typed digest collision. These are native storage and session-lifetime
receipts combined with controlled WebCrypto suspension; they are not claims of
PostgreSQL query cancellation.

#### FSA-PG-DRAIN-01: active SQL is not drained before deadline return

Status: corrected under the separately accepted owner record in
[`03-postgres-active-work-quarantine.md`](./03-postgres-active-work-quarantine.md);
production and hosted activation remain unauthorized.

Reproduction: an ordinary-role `BEFORE INSERT` trigger blocks the admission
backend on a held advisory transaction lock. `pg_stat_activity` and
`pg_blocking_pids()` first prove the exact artifact INSERT is active and blocked;
the frozen Effect clock is then advanced so the host deadline wins long before
PostgreSQL's 30-second lock and statement budgets. The same mechanism is
repeated on the second, distinct recovery backend after a test-only pre-
`COMMIT` uncertainty makes the initial transaction roll back.

Expected: deadline settlement requests backend destruction, waits for the
tracked native statement to reject and drain, proves the backend absent from
`pg_stat_activity`, and only then returns the initial `resourceFailure` or the
recovery `decisionUncertain`.

Observed before correction: admission returns and the node-postgres pool emits
`remove`, but the same backend PID remains `active`, waiting on the advisory
lock, until the test
releases that external blocker. In the recovery scenario the initial uncertain
backend is gone, while the second recovery backend remains active after the
final `decisionUncertain` has returned. This contradicts the accepted tracked-
query/drain-before-return contract. It does not prove query cancellation or a
safe discard merely because the pool emitted `remove`.

Affected owner: the artifact-private PostgreSQL control-session adapter's
Drizzle/native-query tracking and quarantine-drain boundary. The correction
uses a bounded PostgreSQL PID-plus-secret CancelRequest, then drains tracked
work before destroying the original client and observing transport end. Both desired
acceptances now run without skips, including a one-connection control pool and
the distinct recovery backend. Native identity-list/index behavior remains
unproved.

This focused evidence does not complete the private repository checkpoint or
open a downstream gate.

## Accepted Implementation Checkpoint

The bounded implementation checkpoint may change only:

- private artifact capture authenticity state;
- private opaque repository/control-transaction composition plus
  model/error/codec/admission/read/list files;
- private control-session lifecycle adapters and fault seams for PostgreSQL and
  test-only PGlite evidence, without changing the existing located-transaction
  contracts;
- the two private Drizzle table declarations;
- the next generated additive migration, journal, and snapshot;
- focused PGlite and genuine-PostgreSQL artifact repository, settlement, and
  authority-boundary tests;
- the PGlite migration inventory and one additive-upgrade test; and
- roadmap receipts for that exact checkpoint.

It must stop with no package-root export, framework adapter, Application
writer, installation, readiness, binding, migration coordinator, runtime
caller, or production activation.

If genuine PostgreSQL is unavailable, the code may remain an explicitly
incomplete private checkpoint after PGlite evidence, but it cannot be marked
complete and no downstream installation or adapter gate may rely on its lock
or concurrency claims.

## Exit Decision

This record accepts a repository boundary that keeps canonical artifact
meaning in the common value owner, physical identity and dependency existence
in PostgreSQL, and framework interpretation in its lane adapter. It introduces
no second Application authority and no generic relational developer API.

The next independently authorized acceptance step is native identity-list/index
evidence. The implemented DDL,
preparation capability, stored loader/reconstruction, point read, locked
admission, bounded identity list, repository
identity, authenticated starter, deterministic control-session lifecycle, and
artifact-private PostgreSQL control-session adapter do not open any
installation, framework-adapter, runtime, public, or production gate.
