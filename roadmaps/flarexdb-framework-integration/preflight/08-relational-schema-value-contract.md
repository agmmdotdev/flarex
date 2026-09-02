# Relational Schema Value Contract

Status: implemented privately and production-inert; installation, DDL,
migration execution, transaction/store behavior, adapters, and runtime callers
remain unauthorized

Last reviewed: 2026-09-02

## Decision

The first consumer-informed shared-core behavior slice is complete as a private
module under
[`packages/persistence-postgres/src/relationalSchema`](../../../packages/persistence-postgres/src/relationalSchema).
It admits and normalizes immutable relational schema values for trusted
planning without becoming a public developer schema API or a second semantic
grammar for Medusa.

The normalized schema is only the typed payload codec. The existing private
`FrameworkSchemaArtifact` remains the sole owner of canonical artifact bytes,
SHA-256 identity, replay policy, outer provenance, owner, lineage, and artifact
capabilities. `RelationalSchema` therefore does not introduce a parallel hash
or artifact authority.

## Private Contract

The concrete codec is `flarex.relational-schema`, version `1`. The admitted
value vocabulary is deliberately narrow:

| Area | Admitted values |
| --- | --- |
| Owners | `medusa`, `system`; Application and Payload content are rejected |
| Columns | `text`, `integer`, `numeric`, `jsonb`, `timestamptz` |
| Defaults | none, text literal, safe-integer literal, exact numeric literal, exact raw numeric literal with precision, current timestamp |
| Keys | primary and unique, including ordered composite members |
| Indexes | B-tree, optionally with a typed single-column `isNull` predicate |
| Constraints | restrict-only foreign key and bounded integer range |
| Relationships | foreign-key-backed `manyToOne` and `oneToOne` |
| Persistence capabilities | searchable text, exact-numeric companion, managed timestamps, and soft delete |

Tables, columns, keys, indexes, constraints, relationships, capabilities, and
definition sources use distinct branded identities. Every definition is
qualified by owner and lineage; the value model deliberately contains no SQL
identifier, ORM object, Drizzle object, DML closure, service instance, or raw
SQL.

Per-definition origin is separate from artifact provenance. Definitions record
whether they are `authored`, `derived`, `implicit`, or `synthetic` and identify
their exact source fact. The outer artifact independently records either a
pinned source snapshot or a synthetic fixture.

## Admission And Normalization

[`policy.ts`](../../../packages/persistence-postgres/src/relationalSchema/policy.ts)
owns the pure `Result` normalizer. It:

- rejects non-plain, accessor-backed, sparse, oversized, malformed, duplicate,
  and unsupported input before artifact hashing;
- enforces one aggregate decode budget derived from the existing framework-
  artifact JSON-node ceiling before owner-qualified identities can amplify a
  large candidate;
- validates owner/lineage qualification and every cross-reference;
- preserves ordered composite key, index, and foreign-key members while sorting
  definition sets deterministically;
- requires primary-key columns to be non-null, validates default/type
  compatibility, enforces PostgreSQL text and signed 32-bit integer literal
  limits, and requires foreign-key target columns to identify a key;
- admits only restrict actions and foreign-key-backed physical relationships;
- requires a unique source key for `oneToOne`;
- requires every derived and implicit column to be covered by an exact admitted
  persistence capability; and
- returns detached, recursively frozen runtime-owned values.

[`artifact.ts`](../../../packages/persistence-postgres/src/relationalSchema/artifact.ts)
owns the single named Effect boundary. It validates exact source or synthetic
provenance, normalizes path order, derives the admitted outer capability IDs,
and delegates capture to the existing framework artifact owner. Typed
relational input/unsupported-capability failures remain distinct from existing
framework artifact resource failures.

## Source-Backed Fixtures

The first real fixture preserves the exact Currency storage facts accepted in
[`06-medusa-package-capability-source-map.md`](./06-medusa-package-capability-source-map.md):

- text `code` as a non-`id` primary key;
- authored scalar columns and searchable `code`/`name` capability;
- BigNumber `rounding` plus derived `raw_rounding` exact-value storage;
- database-current `created_at` and `updated_at`, including the owned update
  behavior; and
- nullable `deleted_at` plus the active-row partial B-tree index.

Separate `system` fixtures exercise the complete first-slice key, index, check,
foreign-key, `manyToOne`, and composite `oneToOne` vocabulary without importing
or compiling live Medusa source. Together those fixtures and the Currency
fixture exercise all four admitted persistence capabilities.

## Implementation Receipt

The slice is private and has no package-root export, package export-map entry,
Payload dependency, Medusa dependency, Drizzle schema input, database caller,
or runtime caller. Focused evidence on 2026-09-01 proves:

- 15 relational-schema tests pass, including exact Currency and synthetic
  fixtures, multi-definition/provenance permutation invariance, composite-key
  cardinality, companion nullability, PostgreSQL scalar boundaries, exact
  aggregate-budget acceptance/rejection, a changing-length Proxy, a fixed
  canonical frame and SHA-256 vector, detachment/freezing, malformed/accessor
  input, dangling and duplicate references, unsupported vocabulary, and
  delegated framework-hash failure;
- `pnpm --filter @flarex/persistence-postgres typecheck` passes;
- `pnpm --filter @flarex/persistence-postgres exec vitest run test/relationalSchema.test.ts --no-file-parallelism`
  passes; and
- `pnpm lint:core` and `pnpm lint:diff` pass for the changed source scope.

These are value-contract tests. They make no PostgreSQL, PGlite, DDL,
installation, migration, transaction, adapter, Worker, hosted, or production
claim.

## Closed Boundaries

This checkpoint does not authorize:

- physical table/catalog naming or SQL lowering;
- artifact installation, readiness, availability, binding, or activation;
- migration plan compilation, leases, ledgers, runners, or startup auto-apply;
- an owner-scoped relational transaction/store or mutation receipts;
- live DML compilation or any import from the Medusa source island;
- Payload content compilation through `RelationalSchema`;
- a Payload or Medusa adapter, developer relational API, public API, runtime
  route, hosted path, or production binding.

## Next Authorized Gate

The design-only reconciliation is complete in
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md).
It freezes the cycle-free plan/installation identity graph, stable physical
collision domain, scope-isolated PostgreSQL lowering, migration authority,
ledger/fencing/recovery model, readiness/availability cutline, and database
evidence split while deferring binding and activation.

Its first separately reviewable implementation checkpoint is pure physical-
layout, plan, installation, readiness, capability-evidence, and availability
values with golden tests. It authorizes no SQL, DDL, repository, target
transaction, migration execution, binding, adapter, or runtime behavior.

Transaction/store and commit/finalization owners remain later mandatory
preflights. Medusa package promotion and both framework adapters remain blocked
by the complete sequence in
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).
