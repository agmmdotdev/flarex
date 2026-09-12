# Native Singular-Link Storage: Preflight

Status: implemented for fresh private scalar-Link schemas. Native batch cardinality in
preflight 61 is implemented. This foundation does not activate Fulfillment,
ProductShippingProfile or another Product workflow branch.

## Outcome And Recommendation

Establish one reusable stored-Link contract: the native definition determines
cardinality, PostgreSQL enforces it for active rows, and native tuple endpoints
cannot be replaced through extra data. Prove it through native services and
existing Flarex storage before admitting ShippingProfile.

Recommended scope combines native structural generation and endpoint protection
with the narrow shared Link schema/repository mechanics needed for a neutral
stored-service proof. It is not a general Link registry, universal CRUD layer or
full Medusa bootstrap. ProductSalesChannel keeps its existing construction API,
grants, identity and behavior. ShippingProfile remains the next module decision.

No Flarex core capability changed. Existing partial unique indexes,
scope prefixing, active-row upsert, lifecycle writes, rollback-only failure and
outer settlement are the required mechanisms. If their connected proof exposes
a shared-owner defect, retain the failing witness and stop at that boundary.

## Authority And Baseline Evidence

- Accepted design `design-notes/flarex-db-accepted-design.md` and package roadmap
  16 retain Medusa-owned relationship semantics and Flarex-owned database
  authority. Adoption roadmap 06 and preflights 56/57/59/61 own the current
  many-to-many contract and pending singular storage gate.
- Pinned fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4,
  remains the comparison source. Runtime code is the promoted `packages/medusa-*`
  implementation, not `third_party/medusa/upstream/`.
- The pre-correction native `generateEntityDefinition` declared composite
  endpoint primary keys and four indexes. Endpoint indexes were nonunique and
  filtered by `deleted_at IS NULL`, regardless of cardinality. The promoted
  generator now derives active endpoint uniqueness from the opposite `hasMany`.
- `Link.create` now checks conflicting incoming partners and existing active
  rows. Direct `LinkModuleService.create` and restore do not run that router
  check. Consequently router validation is not a database invariant.
- Native `LinkModuleService.buildData` previously spread extra data after
  endpoint keys without protecting them. A caller could supply `(p, a)` but
  replace an endpoint through `data`. The current
  ProductSalesChannel adapter admits only `data.id`, so this is not currently
  an admitted adapter bypass. It must not become the contract for future Links.
- The pinned native Link repository creates IDs, clears deletion and upserts
  the endpoint pair. The admitted ProductSalesChannel repository preserves that
  behavior through the existing active-row upsert. Pair identity is not `id`.
- `medusa-adapter/src/schema/lower.ts` already lowers active unique indexes to
  `uniqueBtree` with an `isNull` predicate. Core
  `relationalSchema/physical/canonical.ts` prefixes physical index columns with
  `scope_uuid`; `migrationCoordination/relationalStructuralRunner.ts` emits
  `CREATE UNIQUE INDEX ... WHERE ... IS NULL`.
- Commerce storage already uses the complete declared pair for upsert/lifecycle
  and maps failed database statements to `statementFailure`. This proposal does
  not promise a new core uniqueness-specific error or retry contract.

These baseline gaps are corrected in the promoted native owners. The original
comparison sources are retained; changed native files are explicit `linkFork`
adaptations. Generated-index and stored lifecycle witnesses replace the prior
missing-uniqueness characterization.

## Cardinality And Lifecycle Decision

Retain composite pair identity across active and deleted rows. Add active-row
uniqueness to the existing endpoint index only where the opposite native
relationship has `hasMany` false or absent:

| First relationship | Second relationship | Additional active uniqueness |
| --- | --- | --- |
| true | true | None; preserve current many-to-many metadata |
| true | false/absent | First endpoint |
| false/absent | true | Second endpoint |
| false/absent | false/absent | Both endpoints independently |

For ProductShippingProfile this means one active profile per Product, while one
profile may serve many Products. Physical uniqueness is scope-local, not global.
The native generator supplies the unique flag and matching expression; the
adapter checks and lowers it rather than inferring its own cardinality rule.
Keep existing index identities for unchanged many-to-many definitions and avoid
retaining a redundant nonunique index beside a replacement unique index.

The implemented lifecycle is explicit:

1. Active `(p, a)` prevents active `(p, b)`.
2. Soft-delete `(p, a)`; attaching `(p, b)` may now succeed. The old pair remains
   a tombstone, not another active association.
3. Restoring or reattaching `(p, a)` while `(p, b)` is active fails. No implicit
   dismissal, reassignment, last-write winner or retry converts the conflict.
4. After deleting `(p, b)`, restoring `(p, a)` may succeed. Restoring multiple
   conflicting tombstones in one root fails atomically, not partially.
5. Repeated-pair identity/event behavior and duplicate-batch refusal remain the
   existing native/service and core contracts. One-to-one router refusal of an
   already stored exact pair is not redesigned as idempotent success.

An unconditional endpoint unique constraint is rejected: it would prevent step
2 while a tombstone exists. A new generated-ID primary key is also unnecessary
and would change pair upsert, fact identity and lifecycle semantics.

## Native Endpoint Protection

At native `LinkModuleService.buildData`, reject extra data containing an endpoint
field, even when the supplied value matches the tuple. Use native invalid-data
failure before persistence/event construction. Preserve ordinary non-endpoint
extra data and caller-provided `id`; do not silently spread one value over another.
Test both endpoints, bulk input and no downstream create/event on rejection.

Do not use this correction to admit arbitrary extra fields in the adapter.
The selected storage contract remains two distinct scalar text endpoints,
standard lifecycle columns and optional `data.id`, with no endpoint existence
check, outgoing endpoint FK, custom field, cascade or graph hydration grant.
Declared extra fields that collide with structural columns remain unadmitted.
Native compound endpoint storage has additional mapping/expression issues and
is not claimed by preflight 61's compound router tests. Keep it refused at
storage admission rather than silently broadening this slice.

## Shared Mechanics And Construction Boundary

Extend the existing non-DML Link schema capture and repository owners, not DML
entity dispatch. Factor only actual repeated endpoint-column, id-prefix,
projection, query and lifecycle mechanics needed by the current many-to-many
binding and a neutral singular fixture. Derive these from checked native Link
metadata; do not add a second descriptor language or parallel cardinality table.

The named ProductSalesChannel entry point keeps selecting the real native
definition and its admitted commands. It continues to hide repository,
manager, service and router construction from callers. Any internal shared
preparation is confined to this supported Link shape, not arbitrary CRUD or
runtime registration. The neutral fixture must use the same mechanics and
actual native services; it may not fabricate a ShippingProfile implementation
or reproduce repository/storage algorithms in the test package.

Both partial-index metadata and its exact supported expression must agree.
Do not parse arbitrary SQL, generate adapter-only unique indexes, infer grants
from every definition in the fork, or grant additional tables to construct a
native service. Existing schema lowering and core installation remain owners.

## Compatibility, Cleanup And Activation

- **Extend:** native structural generator and native endpoint-extra validation.
  These are deliberate fork corrections, not unchanged upstream parity.
- **Extend/replace:** current Link metadata/repository mechanics only where
  neutral reuse requires it; migrate the ProductSalesChannel binding and delete
  displaced copies in the same slice. Preserve its API and original tests.
- **Retain:** composite pair identity, non-key ID behavior, native events,
  many-to-many schema, profiles, workflow proofs, limits and transaction owner.
- **Replace:** missing-uniqueness characterization with generated-index and
  stored enforcement witnesses. Retain source provenance and original native
  test bodies; do not edit comparison sources to manufacture parity.
- **Defer:** ShippingProfile/Fulfillment promotion, live singular-Link activation,
  arbitrary module sets/extra fields, compound stored endpoints and migration
  of existing singular deployments.

Use a fresh private neutral schema candidate for the new storage proof. No
supported installed singular-Link schema or production data obligation has been
established. Do not rewrite current installation artifacts, silently reuse an
old index under `IF NOT EXISTS`, or add compatibility tables/version suffixes.
Verify unchanged ProductSalesChannel metadata/identity explicitly. Refresh only
owned promotion source/build receipts and any narrowly necessary fork guard.

## Validation And Completion Gates

- Native metadata tests cover all four cardinalities, omitted flags, neutral
  names, matching unique flag/expression and unchanged many-to-many output.
- Native service tests prove endpoint-extra refusal before repository/event
  work while `data.id` and admitted non-endpoint behavior remain intact.
- On fresh generated/lowered/installed schemas, run actual native create,
  dismiss and restore through the existing Flarex host/repository path. Prove
  active conflicts, tombstone replacement, reattach/restore collision, bulk
  rollback, independent scopes, unchanged timestamps/IDs where promised, and
  zero committed facts/events from a rejected root, including caught refusal.
- Run PGlite and ordinary-role PostgreSQL separately. In PostgreSQL, distinguish
  same-scope host serialization from database unique-index contention. A focused
  physical-constraint witness may use test-owned sessions against the installed
  layout, observing actual backend blocking and final rows; it is not a new
  runtime SQL capability. Exercise winner commit and rollback. Do not claim
  index contention merely because two serialized hosts were launched together.
- Retain native batch/routing tests, stored ProductSalesChannel and connected
  workflow regressions, affected builds/typechecks, source/portability guards,
  core/diff/staged lint and both required final reviews. Keep deadlines unchanged
  and stop owned database resources afterward.

Completion is a tested native singular storage contract plus unchanged existing
integration, reconciled roadmaps and one scoped implementation commit. Then
return to preflight 59 B's Fulfillment construction/source-closure and connected
ShippingProfile activation decision; this slice alone does not admit that module.

## Implemented Boundary

`link-schema`, `link-repository`, `link-service` and `link-events` hold the shared
non-DML mechanics. Named ProductSalesChannel construction still selects its
definition, commands, profile and workflow grants; its borrowed API and canonical
metadata identity are unchanged. The displaced named repository/event copies
are removed. No entity registry, alternate persistence path or core transaction
contract was introduced.

The neutral two-scalar-endpoint fixture uses actual native services and these
same mechanics through the existing commerce host. It covers both unique
directions, tombstone replacement, failed reattach/restore and bulk restore,
pair upsert/replay, caught failure rollback and scope-local lifecycle. Native
unit witnesses separately prove endpoint-extra refusal before writes/events
and preservation of ordinary extras; arbitrary extras remain unadmitted by the
storage adapter. The service boundary reports the existing `rollbackOnly`
state after a failed statement; this is not a new conflict-error contract.

PGlite and ordinary-role PostgreSQL prove the stored contract. PostgreSQL also
uses test-owned sessions against the installed layout to observe the exact
blocked backend at a unique-index transaction lock, with winner commit yielding
`23505` and winner rollback allowing the waiter. This physical probe is distinct
from host serialization and grants no runtime raw-SQL capability.

Unchanged ProductSalesChannel and its connected native workflow retain their
existing gates. Compound stored endpoints, custom fields, migrations of installed
singular schemas and Fulfillment/ShippingProfile activation remain deferred.
