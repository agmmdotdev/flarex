# Managed Schema Deployment And Migrationless DX

Status: Accepted deferred foundation contract. This document freezes the
developer experience and safety classes; it does not implement the public CLI,
backfill runner, activation service, or destructive cleanup.

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
must never reinterpret themselves through the new binding. M03 must explicitly
choose whether a compatible retained binding may finish or the attempt must
fail/retry after activation.

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

## Deferred Turn Sequence

These are separate later goals, not one giant deployment goal:

1. `M01` - freeze the canonical schema-diff and compatibility-classification
   protocol over immutable schema artifacts.
2. `M02` - implement read-only production planning with explicit rename maps,
   bounded incompatibility evidence, and stale-plan identity.
3. `M03` - compose existing physical build/backfill/validation state with one
   atomic semantic/physical active-schema transition, an explicit pinned-attempt
   overlap rule, and retained rollback definitions.
4. `M04` - expose plan/apply through developer CLI and AI tooling with
   non-interactive machine-readable output.
5. `M05` - add explicit retirement/purge policy after rollback, snapshot,
   reconnect, and adapter retention gates pass.

The current FlarexDB foundation continues in its existing narrow order. These
goals do not authorize public CLI work, cloud deployment, or destructive schema
changes during current codec/catalog slices.

## Known Limitations

- Exact public command names and schema-DSL rename syntax are not frozen.
- Arbitrary data transformations still require an ordinary bounded
  application/system backfill function; "no migration files" does not imply
  that Flarex can invent business transformations.
- Relation compatibility depends on `R01`/`R02`; Payload lifecycle parity and
  Medusa migration compilation remain separate source-driven plans.
- Real Postgres remains mandatory for DDL locks, concurrent builds,
  constraints, isolation, activation, and rollback proofs.

## Checkpoint Record

Previous completed checkpoint: `a4f3aec` -
`Freeze Payload relational compatibility contract`.

What changed: accepted desired-state schema deployment without developer SQL
migration files, classified changes as safe/build/blocked, required explicit
rename intent and stable identity preservation, separated app/Payload logical
changes from Medusa physical migrations, and defined AI-readable plan/apply
requirements plus narrow later turns.

Why: a Convex-like deploy experience is compatible with Postgres only when
internal migrations remain explicit, resumable, fenced, validated, and
rollback-aware. Hiding migration files must not hide destructive behavior.

Convex source files were not inspected for this docs-only UX checkpoint because
the current official schema and production deployment documentation is the
authoritative user-visible behavior being compared. Existing roadmap references
to `crates/application/src/deploy_config.rs` continue to govern the portable
implementation pattern.

Verification:

```sh
git diff --check
rg -n "migrationless|M01|explicit rename|schema-diff|InstantDB|Convex" \
  roadmaps/flarexdb-foundation
```
