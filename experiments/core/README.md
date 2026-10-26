# Experimental Flarex core

Status: design and implementation brief. No experimental runtime exists yet.

This is a separate core experiment requested by the owner on 2026-10-26. Build
and evaluate a different execution design here while current Medusa integration
continues against the active core. This folder is outside the existing
`packages/*` and `apps/*` workspace membership. It is not a production package.

## Read in this order

1. [AGENTS.md](./AGENTS.md): scope, isolation and implementation rules.
2. [DESIGN.md](./DESIGN.md): required behavior and proposed execution lifecycle.
3. [MODULES.md](./MODULES.md): replaceable owners, contracts and dependency rules.
4. [IMPLEMENTATION.md](./IMPLEMENTATION.md): connected implementation stages.
5. [VALIDATION.md](./VALIDATION.md): correctness, comparison and promotion gates.
6. [REFERENCES.md](./REFERENCES.md): exact Convex sources and Flarex evidence.

## Objective

Reduce the complete cost of real Payload, Medusa and mixed Application operations
by changing execution granularity and ownership. Do not start by copying the
current core into another directory and renaming its helpers. Existing contracts
and implementations are evidence to inspect, not a mandatory internal design.

Modularity is part of the outcome: changing readiness policy, query execution,
storage layout or commit planning should have a small, explicit dependency
surface and independently runnable behavioral tests. Shared invariants must
remain coherent when modules change.

## Permission and boundaries

The owner authorizes a separate experimental implementation and permits changes
to its PostgreSQL tables, indexes, SQL functions, permissions and coordination
structures when the design warrants them. Existing physical storage families
are reuse candidates. Schema replacement is permitted, not required or proven
necessary. Design behavior first, execution lifecycle second, storage third.

All experimental database work uses explicitly owned disposable resources.
Current runtime packages, active Medusa integration, existing schemas and named
durable data are outside this experiment's mutation scope. No production routing,
data deletion or migration is authorized. Promotion needs a separate connected
cutover decision, including the actual consumers and durable-data disposition.

The experiment temporarily coexists with the active core for comparison. It is
not a runtime fallback or a permanent second engine. If it fails, retain useful
evidence and retire the candidate. If it succeeds, plan one replacement with
consumer migration and removal of displaced internals.

## Starting point

The recommended first hypothesis is **complete bounded storage operations under
one root execution owner**, with immutable preparation and fresh database gates
separated. It is a hypothesis, not a measured performance result. The existing
core already has working sets, metadata reuse and combined authority/data SQL;
their mere presence in a new implementation would not establish a new design.

Start with one genuine Payload create, one Medusa Product scalar update, then
one explicitly atomic Application + Product + Payload mutation. Preserve native
framework behavior and report unsupported capabilities. These are construction
milestones; acceptance also requires the complete existing business graphs.

Architecture obligations remain in the [accepted design](../../design-notes/flarex-db-accepted-design.md).
The [performance roadmap](../../roadmaps/core-performance/README.md) links this
separate lane. These documents authorize experimental mechanisms within the
recorded boundaries; they do not declare a production architecture cutover.
