# Managed Schema Deployment And Migrationless DX

Status: Accepted deferred foundation contract with the first app-document
schema-evolution preflight complete. No protocol, DDL, repository, commit-hook,
readiness, activation, CLI, backfill-runner, or destructive-cleanup
implementation is authorized by this record. The first implementation slice
still requires explicit approval. `M01-A` is deliberately pure and
storage-free; the later `M03-A` through `M03-C` slices separately introduce
target-local validation state, point-commit integration, and readiness and
activation consumption.

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

## Current Implementation Gap

The current private Flarex lifecycle already publishes immutable schema
artifacts, keeps stable table and logical-index identities across versions,
builds required physical indexes and unique sets, settles readiness, and
atomically activates one complete application revision. C03-V validates new
insert/patch/replace values against the active activation-fenced schema.

It does **not** yet prove that every existing live application row satisfies a
candidate schema. `applicationRevisionReadinessV1` currently folds physical
index builds, unique-set eligibility, runtime publication, and cold
materialization into readiness, but has no candidate-schema row-validation
receipt. The reusable system-test environment likewise prepares and activates
exactly one relation-free revision.

Therefore the next cooking tests cannot honestly activate a narrowed or
required-field schema merely by registering a second revision. A test-owned
scan, direct readiness row, seeded activation, or second validator would create
false authority and is forbidden.

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
  -> superseded
```

The exact persisted contract and DDL remain an implementation preflight, but
the following transaction semantics are fixed:

1. Installing a validation head locks the scope clock, authenticates the exact
   immutable candidate schema artifact, records the current commit frontier,
   and makes all later material commits observe that head.
2. A bounded scanner validates every live row at that exact frontier in stable
   `(table_id, row_id)` order. It reads authoritative row revisions rather than
   treating mutable current pointers as a historical snapshot.
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

## Ordered Turn Sequence

These are separate later goals, not one giant deployment goal:

1. `M01-A` - freeze a pure conservative app-document schema diff and
   compatibility-classification contract over two authenticated immutable
   schema artifacts. It creates no storage and cannot declare an unknown
   validator transformation universally compatible.
2. `M01-B` - freeze the candidate row-validation progress, failure evidence,
   and final receipt contracts plus count/byte/page/time ceilings. Settle exact
   corruption, supersession, interruption, rollback, and uncertainty errors
   before DDL.
3. `M02` - implement read-only planning with explicit rename maps, bounded
   non-sensitive incompatibility evidence, remediation actions, active-schema
   and data-frontier pins, and stale-plan identity.
4. `M03-A` - add the guarded target-local single non-active schema-validation
   head and bounded exact-frontier scanner. This is one new schema/migration
   owner and requires PGlite plus genuine-PostgreSQL fresh/upgrade/replay/
   refusal/rollback/concurrency evidence.
5. `M03-B` - integrate one authenticated candidate-validation capability into
   the existing point-commit transaction. It validates only final material
   rows, marks an incompatible candidate failed without rejecting an
   active-valid write, preserves the current transaction/OCC/commit owners,
   and proves same-table/cross-table multi-row rollback and bounded work.
6. `M03-C` - make application readiness require the exact schema-validation
   receipt and let the existing activation CAS consume it. Reprove index,
   unique, runtime, cold-load, activation, stale-attempt, replay, rollback, and
   uncertainty behavior without a second active-schema authority.
7. `M03-D` - extend `@flarex/system-test` with a separate multi-revision
   cooking scenario. The existing single-revision runner remains unchanged
   until the lifecycle owner exists.
8. `M04` - expose plan/apply through developer CLI and AI tooling with
   non-interactive machine-readable output.
9. `M05` - add explicit retirement/purge policy after rollback, snapshot,
   reconnect, and adapter retention gates pass.

The current FlarexDB foundation continues in its existing narrow order. These
goals do not authorize public CLI work, cloud deployment, or destructive schema
changes during current codec/catalog slices.

The first implementation-bearing request should authorize only `M01-A`. It
must not opportunistically add DDL, scan rows, alter readiness, or touch point
commit. Each later turn stops if it discovers another authority, migration,
transaction, activation, or production-routing change beyond the named gate.

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
