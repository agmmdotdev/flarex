# Indexed timestamp less-than comparison

## Status And Scope

Status: implemented timestamp-only less-than support through the existing
shared owners. Native API Key revocation requires the strict predicate described
below. API Key creation is independent of this capability. The existing
greater-than profile remains supported.

This correction belongs to existing shared query compilation, indexed selection,
predicate evaluation and physical compatibility. It does not add an adapter-local
scan/filter fallback, raw SQL escape, another query engine or a new resource limit.

## Current Sources Of Truth

- Accepted shared logical storage and the existing relational query owners.
- `packages/persistence-postgres/src/frameworks/commerceTransaction/store.ts`.
- `packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery.ts`.
- `packages/persistence-postgres/src/storage/documents/logicalDocuments/postgresRelationalPredicate.ts`.
- `packages/persistence-postgres/test/storage/documents/logicalTimestampComparison.test.ts`.
- The [API Key preflight](../flarexdb-framework-integration/preflight/api-key-workflows.md).

## Current Architecture

Native `ApiKeyModuleService.validateRevokeApiKeys_` lists selected secret keys
whose `revoked_at` is strictly earlier than its native current Date. This call
also occurs when revoking publishable keys. Skipping it because the expected
result is empty would duplicate native policy and bypass the real owner.

The original physical Commerce predicate owner accepted `greaterThan` on
timestamp columns. Its logical query decoder and indexed scalar selection
accepted the corresponding greater-than contract, but neither admitted a
timestamp `lessThan` node. The shared owners now admit timestamp-only less-than
through their existing scalar validation, index and SQL paths. Text-specific
PostgreSQL operators do not authorize timestamp comparisons.

The neutral witness supplies a nullable timestamp column with an ordinary
btree index and unchanged primary-ID ordering. Greater-than compilation
succeeded; original less-than compilation returned `invalidInput` before
execution. The corrected native consumer uses an indexed strict less-than
selection.

## Invariants And Trust Boundaries

The same authenticated schema, table, column, index, scope and request owners
must serve this predicate. Existing node, operand, byte, page and deadline
bounds remain unchanged. Logical unindexed selection retains its current refusal;
physical compatibility retains its existing bounded read profile.
The new predicate cannot authorize a wider body scan or relation traversal.

Validate timestamp operands using the existing scalar owner. Strict comparison
excludes equality and NULL; nullable columns do not broaden operand validity.
The indexed range excludes NULL before candidate limits using the existing
strict lower bound at NULL, alongside the strict upper timestamp bound. A
residual NULL check alone is insufficient for a bounded indexed query.
Physical SQL, indexed boundaries, overlay evaluation and authenticated predicate
evidence must agree. Existing greater-than behavior and durable query evidence
remain supported. Unsupported column/operator combinations still fail closed.

## Compatibility And Admission Boundaries

1. Keep timestamp-only operand validation and existing greater-than behavior.
   Additional comparison profiles require their own owner decision.
2. Preserve agreement between indexed range bounds, residual evaluation,
   same-root overlays, physical SQL and persisted predicate evidence.
3. Retain cross-driver past/equal/future/NULL, index-refusal and scope controls,
   including NULL cohorts larger than the unchanged candidate budget.
4. Native API Key revocation translates its Dates through the existing typed
   value boundary. Its module and workflow admission remains with the API Key
   preflight; this predicate grants no storefront authentication capability.
