# Framework Storage System Boundaries

## Status And Scope

Status: accepted boundary contract; implementation pending

This plan owns the shared vocabulary, semantic ownership, trust separation,
dependency direction, and capability admission rules for Application, Payload,
and Medusa on one FlarexDB data plane.

It does not own the detailed application OCC system, Payload behavior, Medusa
commerce behavior, physical migration DDL, or public API syntax.

## Current Sources Of Truth

- [`../../design-notes/flarexdb-framework-storage-architecture.md`](../../design-notes/flarexdb-framework-storage-architecture.md)
- [`README.md`](./README.md)
- [`../flarexdb-foundation/README.md`](../flarexdb-foundation/README.md)
- [`../../design-notes/flarexdb-payload-relational-adapter.md`](../../design-notes/flarexdb-payload-relational-adapter.md)
- [`../../design-notes/flarexdb-medusa-commerce-adapter.md`](../../design-notes/flarexdb-medusa-commerce-adapter.md)
- [`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
- [`../16-package-boundaries.md`](../16-package-boundaries.md)

## Accepted System Shape

The system has one Flarex-managed committed-data authority, potentially spread
across explicitly bound physical installations, two primary storage profiles,
and three semantic lanes.

| Lane | Schema interpretation | Query/write surface | Storage |
| --- | --- | --- | --- |
| Application | Standard/Application | `ctx.db` | document rows and derived sidecars |
| Payload | Payload config bound to application content plus lifecycle requirements | planned `ctx.cms` and Payload-compatible surfaces | document rows plus reserved lifecycle state |
| Medusa | DML, complete configured supported module/link set for the candidate, Joiner/Links, migrations, capabilities | planned `ctx.commerce`, repositories, Query, workflows | reserved relational tables and authoritative link entities |

Shared storage does not make the semantic APIs interchangeable.

## Write-Policy Ownership

Each table has exactly one ordinary write-policy owner:

- an Application-owned table is mutated through its admitted `ctx.db` lane or
  application-domain commands;
- a read-only CMS view does not change that owner;
- an editable Payload-managed collection is mutated through the Payload
  command pipeline;
- an app-command-managed CMS view delegates actions to its application owner;
- a Medusa table or link is mutated only through Medusa services, repositories,
  Link, or workflows; and
- system tables are mutated only by trusted platform operations.

Generated capabilities and runtime authorization both enforce this rule. Type
exclusion alone is not a trust boundary.

## Capability Classes

Keep these contracts separate:

- **Control:** deployment, placement, scope, generation, and binding authority.
- **Schema and migration:** artifacts, installations, plans, receipts,
  readiness, activation, and operator recovery.
- **Application data:** document reads, logical journals, OCC, and application
  commit behavior.
- **Payload adapter:** CMS queries, commands, request transactions, and
  lifecycle behavior.
- **Medusa adapter:** repository operations, transaction-manager propagation,
  commerce links, Query translation, workflows, and locks.
- **Operator:** import, repair, inspection, backup, and recovery.
- **Private kernel:** physical transactions, catalogs, locks, commit order,
  typed facts, outbox, and persistence.

Do not combine these into a parameterized universal database interface.

## Dependency Direction

```text
protocol/value contracts
  <- pure schema domains
  <- framework adapter contracts
  <- Postgres persistence and framework live adapters
  <- host composition
```

The Flarex kernel never imports Medusa or Payload. A framework adapter may
import the framework's contracts plus narrow private Flarex host contracts.
Public application code imports neither adapter.

The admitted inert `third_party/medusa` fork island is evidence and promotion
input, not an import surface. Only a later source-map-admitted package promoted
into the active root workspace after the core-first three-lane gates pass may
enter the Medusa adapter dependency graph. Source presence does not establish a
reusable package owner or authorize runtime composition.

Do not export Drizzle transactions, `pg` clients, Hyperdrive bindings,
physical locators, raw commit stores, or migration-role capabilities from the
adapter contract.

## Cross-Lane Operations

A command involving several semantic owners must choose one explicit owner:

- commerce-affecting atomic behavior belongs behind a Medusa command/workflow;
- Payload-managed content behavior belongs behind a Payload request command;
- admitted `ctx.db` operations and application-domain commands may refer to
  committed framework identities but cannot mutate framework-owned state; and
- asynchronous coordination uses committed facts and outbox delivery.

There is no generic developer transaction spanning arbitrary `ctx.db`,
`ctx.cms`, and `ctx.commerce` calls.

## Implementation Organization

Use domain-first modules with separate models, policies, errors, services, live
Layers, and host composition. Pure total helpers and deterministic compilers do
not become services. Transaction-specific capabilities are scoped values, not
global singleton Context tags.

Avoid speculative extraction. A repeated mechanism becomes a portable package
only after independent owners prove identical semantics, failure behavior, and
lifecycle.

Every promoted Medusa closure requires an explicit target owner, bounded
dependency graph, fork provenance, reuse classification, and retained tests.
The whole fork never enters the active root workspace implicitly.

## Exit Criteria

This boundary gate is ready for implementation planning only when:

- every existing and proposed operation has one semantic owner;
- trust-specific capability surfaces are named without raw persistence escape
  hatches;
- current application owners that must remain unchanged are linked;
- package dependency direction is cycle-free;
- framework adapters cannot mint scope, generation, commit, or outbox
  authority; and
- public and production activation remain separate explicit gates.
