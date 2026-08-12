# Preflight 40: Standard Application Task Runtime Persistence

## Status

**Decision:** Complete (2026-08-12). SAP-TRP4 now supplies the canonical
Standard Application receipt, additive Drizzle schema and migration, private
transactional publication repository, and PGlite plus ordinary-role genuine
PostgreSQL proof. It remains production-inert and authorizes no readiness,
activation, located runtime reader, Worker Loader composition, or production
host.

SAP-TRP1 through SAP-TRP3 already provide the pure canonical task-runtime
formats, an owned publication plan, and private immutable-object storage. The
missing SAP-TRP4 owner is the authoritative PostgreSQL receipt that says which
already-published immutable objects belong to one existing inactive
Application revision.

## Repository-Grounded Decision

SAP-TRP4 extends the current Application publication chain. It does not create
a parallel task revision or task activation system.

The existing chain is:

```text
fx_system_application_revision_v2
  -> fx_system_application_publication_v1
  -> fx_system_application_task_catalog_v1
  -> fx_system_application_task_definition_v1
  -> fx_system_application_readiness_v1
  -> fx_system_application_activation_v1
  -> fx_system_application_active_revision_v1
```

The new runtime publication belongs between the task-catalog binding and
readiness:

```text
fx_system_application_task_catalog_v1
  -> fx_system_application_task_runtime_publication_v1
     -> fx_system_application_task_runtime_object_v1
  -> later SAP-TRP5 readiness correlation
```

The older `fx_system_application_revision_v1` and
`fx_system_durable_task_definition_revision_v1` are not SAP-TRP4 publication
owners. The latter captures a run-facing definition commitment; it must not be
used as the Application-revision publication receipt or changed incidentally.

## Authority And Package Ownership

The accepted owner split is:

| Concern | Owner |
| --- | --- |
| Receipt compatibility frame, canonical encoding, digest, and bounds | `@flarex/standard-application-definition` |
| Object bytes, no-replace put, collision detection, and read reconciliation | existing private backend immutable-object store |
| Tables, migration, transaction, replay, stored-row decoding, and corruption classification | `@flarex/persistence-postgres` |
| Scope/database location, credentials, pool, deadline, settlement, and connection disposition | existing trusted persistence composition |
| Cold object reads and readiness decision | SAP-TRP5 existing readiness owner |
| Launch-time located reads | SAP-TRP6 DTE06-D1 adapter |

The persistence repository accepts only an owned Standard Application receipt
and the exact confirmed SAP-TRP3 references. It does not accept caller-built
rows, arbitrary object keys, a raw database, a transaction, an R2 bucket, or a
generic immutable-store capability.

One composition-scoped receipt authority owns the opaque confirmation and
receipt tokens. The host constructs exactly one instance, gives only its
`confirmPublishedObject` projection to the SAP-TRP3 store so a token is minted
after the immutable put converges, and gives only its `captureReceipt`
projection to persistence. The same authority prepares the receipt from the
opaque SAP-TRP2 plan plus every returned confirmation. Different authority
instances cannot exchange tokens. Tests may simulate the store-success call
with genuine SAP-TRP2 objects; that simulation is not production publication
evidence. No production composition is admitted in SAP-TRP4.

During the SAP-TRP4 connected fixture, the existing
`ApplicationTaskCatalogSnapshotPort` classified every populated registered
catalog as corrupt because it passed stored canonical manifest bytes to the
decoded-object manifest API. The expected behavior is to decode the canonical
preimage or otherwise return the already authenticated catalog snapshot; the
actual behavior is a typed `storedState` failure at
`definitions[0].manifestBytes`. That defect belongs to the existing
application-task-binding snapshot owner and is not repaired by SAP-TRP4.
SAP-TRP4 instead locks and validates only the exact parent catalog header it
owns as a foreign-key prerequisite. A separate owner-approved correction may
repair and retest the shared snapshot port later.

## Required Receipt Contract Amendment

SAP-TRP2 currently produces an owned
`TaskRuntimePublicationReceiptPreimageV1`, not a canonical persisted receipt.
Before DDL, the Standard Application owner must add one concrete compatibility
contract with:

- a fixed task-runtime publication-receipt codec identity;
- strict canonical encode/decode and re-encoding agreement;
- an exact maximum canonical receipt byte length;
- a SHA-256 receipt identity;
- owned copies of every digest and object reference;
- exact ordinal ordering and role/codec/reference correlation; and
- empty-versus-populated catalog correlation.

The receipt frame retains the existing preimage fields: scope, candidate,
Application revision, candidate digest, Application-revision task-binding
digest, catalog and entry roots, nullable populated-only singleton roots,
package/artifact/source/semantic roots, and ordered runtime-object membership.

Persistence must not invent a second JSON representation or hash a database
row projection. The canonical Standard Application receipt bytes and digest
are the replay identity. Stored normalized columns and child rows are decoded
and compared back to that receipt.

## Minimum Additive Schema

### Publication header

Add the versioned persisted table
`fx_system_application_task_runtime_publication_v1`. One row exists for each
published task runtime under an existing `(scope_id, revision_id)` task
catalog, including an explicitly empty catalog.

The minimum columns are:

- `scope_id` and `revision_id` as the primary key;
- `candidate_id`;
- `task_catalog_sha256` and `task_catalog_binding_sha256`;
- `candidate_sha256`;
- `application_revision_task_binding_sha256`;
- `task_entry_root_sha256`;
- nullable `task_runtime_projection_sha256`,
  `task_runtime_group_manifest_sha256`, and
  `task_runtime_materialization_spec_sha256`;
- `package_sha256`, `artifact_sha256`, `source_root_sha256`, and
  `semantic_root_sha256`;
- `object_count`;
- `receipt_sha256` and canonical `receipt_bytes`; and
- database-owned finite `published_at`.

Add the minimum unique key to the existing task-catalog table needed for one
exact foreign key over scope, revision, candidate, catalog digest, and catalog
binding digest. The new header references that key with `ON DELETE RESTRICT`.
This proves the new receipt is a child of the already-authenticated
Application publication instead of relying on candidate fields repeated only
inside receipt bytes.

The header additionally has a scope-bound unique receipt identity and a
scope/revision/receipt unique key for child membership. All digests are exactly
32 bytes. Text identities use the existing UTF-8/identifier limits rather than
unbounded `text`. `object_count` is bounded by the protocol-owned maximum
publication-object count. `receipt_bytes` is bounded by the new
protocol-owned receipt limit.

For an empty catalog:

- the header is still required;
- `object_count = 0`;
- the three populated-only singleton roots are null; and
- no membership row exists.

For a populated catalog:

- `object_count > 0`;
- all three singleton roots are non-null; and
- the repository proves the exact object count and role cardinality before it
  returns a receipt.

### Ordered object membership

Add `fx_system_application_task_runtime_object_v1` with:

- `scope_id`, `revision_id`, and `receipt_sha256`;
- role-local zero-based `ordinal` bounded by the protocol
  publication-object maximum;
- exact `store_identity`, `role`, and role-owned `codec_identity`;
- canonical `object_key`;
- positive bounded `byte_length`; and
- exact 32-byte `sha256`.

The primary key is `(scope_id, revision_id, role, ordinal)`. A foreign key over
`(scope_id, revision_id, receipt_sha256)` targets the publication header with
`ON DELETE RESTRICT`. The schema rejects unknown stores, roles, codecs,
oversized lengths, and malformed keys. The key must have the fixed
task-runtime prefix, role segment, and lowercase digest suffix.

Partial unique indexes enforce at most one projection, group manifest, and
materialization spec per publication. Projection modules and task entries may
repeat. SQL constraints enforce facts local to one row; the repository owns
contiguous role-local ordinals, exact final count, role/codec mapping,
task-entry count,
and full receipt correlation across rows.

No R2 body is copied into PostgreSQL.

## Publication Transaction

The operation order is fixed:

1. capture and validate the complete caller input before opening a transaction;
2. require every planned object to have an exact confirmed SAP-TRP3 reference;
3. encode, decode, and hash the canonical Standard Application receipt;
4. enter the trusted located transaction with its existing scope fence,
   deadline, settlement, and connection-disposition policy;
5. verify the current scope authority and lock the exact existing task-catalog
   row so competing publications serialize;
6. load any existing header and all membership rows;
7. if absent, insert the header and complete ordered membership atomically;
8. if present, decode and compare the stored header, receipt bytes, digest, and
   every membership row to the requested receipt; and
9. return either a newly published receipt, an exact replay, or a typed failure
   only after the transaction boundary settles.

No object-store call occurs inside the database transaction. Immutable objects
are written and reconciled first. If the database transaction rolls back,
unreferenced immutable objects remain inert and eligible for later retention
policy; the repository does not delete or compensate them.

## Replay, Conflict, Corruption, And Uncertainty

The result vocabulary distinguishes:

- `published`: this transaction created the exact header and children;
- `replayed`: the complete stored publication exactly equals the requested
  canonical receipt;
- invalid input or changed scope authority;
- missing or mismatched parent task-catalog publication;
- conflicting replay: a different valid publication already won for the same
  Application revision;
- stored corruption: receipt digest/bytes, normalized columns, row count,
  ordinal, role, codec, key, length, or digest disagree; and
- resource, confirmed-rollback, settlement-uncertain, interruption, or defect
  according to the existing located transaction owner.

An identical concurrent publisher converges to one `published` result and one
`replayed` result. Different publishers for the same revision produce one
winner and one non-retryable conflict. A stored row that cannot reconstruct
the canonical receipt is corruption, never a replay and never a reason to
overwrite evidence.

A lost response after commit returns no authoritative local publication
receipt. The transaction owner must settle or quarantine the connection. The
caller may retry only the identical captured request; cold readback then
returns `replayed`. SAP-TRP4 does not guess the commit outcome, retry a
different plan, or manufacture success from object existence.

## Migration And Compatibility

The implementation migration is additive:

- add the exact task-catalog unique key;
- create the header and membership tables, checks, foreign keys, and indexes;
- add no backfill and mutate no existing Application, task-definition,
  readiness, activation, active-head, OCC, journal, outbox, or application-row
  data; and
- keep all production composition absent.

Existing inactive revisions remain valid but have no task-runtime publication.
The SAP-TRP5 proposal now requires an explicit runtime receipt for every newly
issued task-aware readiness result, including an empty catalog. It preserves an
already stored legacy readiness receipt but never synthesizes or upgrades one
in place. SAP-TRP4 itself still performs no synthesis.

The migration must use the persistence-owned bundled migration resolver. It
must work from an empty database and from the immediately prior committed
journal. The focused upgrade proof runs on PGlite; the same additive DDL and
full migration tree run on genuine PostgreSQL with an ordinary acceptance role.
Tests use temporary schemas/persistence helpers rather than requiring
`CREATEDB` or superuser privileges.

## Required Validation

### Standard Application contract

- canonical receipt golden vector and exact digest;
- strict decode/re-encode, excess-field, hostile accessor/proxy, detached-byte,
  ownership, maximum-size, and ordinal/role correlation tests;
- empty and maximum-shape bounds; and
- package typecheck and Trigger compatibility boundary checks.

### PGlite fast lane

- empty and immediately-prior-journal migration;
- exact schema, check, foreign-key, partial-unique, and delete-restrict proofs;
- empty and populated publication;
- exact replay and conflicting replay;
- malformed parent, receipt, count, ordinal, role, codec, key, length, and
  digest corruption;
- injected child failure proving full rollback; and
- cold repository reconstruction using a fresh repository instance.

### Genuine PostgreSQL admission lane

- ordinary-role full-tree migration;
- concurrent identical publication convergence;
- concurrent different-receipt winner/conflict serialization;
- rollback after a later membership insert;
- committed-but-response-hidden uncertainty followed by exact cold replay;
- confirmed rollback kept distinct from decision uncertainty; and
- subsequent cold replay after uncertainty, proving reusable settled access.

A test that throws before commit does not prove commit-response uncertainty.
The genuine-PostgreSQL lane must use a deterministic barrier or the existing
narrow transaction-result seam and inspect durable state from a fresh
connection.

Before commit, run both required significant-code reviewers against the final
staged diff. Schema and migration agreement, frozen lockfile/diff checks, and
focused package typechecks remain mandatory.

### Completed validation receipt

- `pnpm --filter @flarex/standard-application-definition typecheck`;
- `pnpm --filter @flarex/standard-application-definition test` — seven files,
  57 tests, including the pinned receipt digest
  `a2a93fed8daf1c523af653804ab33012ef9e7a4b44ff2145dcf9445a4df5455f`;
- `pnpm --filter @flarex/persistence-postgres typecheck`;
- `pnpm --filter @flarex/persistence-postgres db:check`;
- `pnpm --filter @flarex/persistence-postgres test:sap-trp4:pglite` — two
  files, 37 tests;
- focused backend immutable-object-store proof — two files, ten tests;
- `pnpm --filter @flarex/persistence-postgres test:sap-trp4:postgres` — one
  file, four tests on PostgreSQL 18 through a non-superuser role granted only
  database `CONNECT` and `CREATE`;
- `pnpm check:trigger-compatibility-boundary`; and
- `pnpm typecheck:scripts`.

## Explicit Non-Goals

SAP-TRP4 does not:

- publish or read arbitrary object keys;
- put, repair, delete, or garbage-collect R2 objects;
- modify task manifests or the existing task-catalog registration;
- write a run-facing durable-task definition revision;
- cold-read or role-decode object bodies for readiness;
- change the existing readiness receipt, activation history, or active head;
- add a task-specific active head, dual write, fallback, or legacy comparison;
- wire DTE06-D1/D2/D3, a provider, route, Queue, Cron, Worker, binding, or host;
- publish per-run task inputs; or
- activate or deploy anything.

## Implementation Order And Stop Boundary

SAP-TRP4 completed as one bounded implementation slice in this order:

1. Standard Application canonical receipt codec/digest/bounds;
2. Drizzle schema and generated additive migration;
3. private persistence repository and exact cold-read reconstruction;
4. PGlite validation;
5. ordinary-role genuine-PostgreSQL concurrency and uncertainty validation;
6. final TypeScript/Effect and code-quality reviewer passes; and
7. one production-inert commit.

Completion of SAP-TRP4 authorizes no readiness or runtime composition. The
implementation stops after the inert publication receipt. SAP-TRP5 is the next
separately approved checkpoint and owns extension of the single existing
readiness and active-selection evidence chain. Its proposed repository-grounded
contract is recorded in
[`41-standard-application-task-runtime-readiness.md`](./41-standard-application-task-runtime-readiness.md);
that proposal does not yet authorize implementation.
