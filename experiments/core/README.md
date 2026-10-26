# Experimental Flarex core

Status: bounded Payload-create, standalone Application and native Product scalar
update slices implemented with Drizzle on shared persistence/materialization owners. This is
not an accepted replacement core, a complete Application profile or a completed
performance comparison. See [Payload](./PAYLOAD-CREATE.md) and
[Application](./APPLICATION.md) and [Product](./MEDUSA-PRODUCT.md) for the exact
contracts and remaining gates. The active experiment goal continues through
Payload CRUD, representative Product flows and an atomic mixed comparison.

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

Reduce the complete cost of standalone Flarex Application queries and mutations,
Payload, Medusa and mixed operations by changing execution granularity and
ownership. Application is a first-class consumer of the shared core. Do not start
by copying the current core into another directory and renaming its helpers.
Existing contracts and implementations are evidence to inspect, not a mandatory
internal design.

Starting from scratch means freedom to replace the core execution design while
carrying forward useful integration implementation. Existing integrations are
both requirements evidence and reusable code. Prefer native services/workflows
and sound translation code composed with revised core-facing bindings; neither
rewriting all integration behavior nor preserving every old adapter interface is
the objective. Apply the [reuse decisions](./MODULES.md#framework-reuse-and-integration-replacement)
to each connected operation before expanding the candidate.

Modularity is part of the outcome: changing readiness policy, query execution,
storage layout or commit planning should have a small, explicit dependency
surface and independently runnable behavioral tests. Shared invariants must
remain coherent when modules change.

The scope includes the working set, atomic execution boundary, repository bridge,
workflow execution bridge and their core-facing contracts, as well as PostgreSQL.
Reusing Medusa models, services and native workflow definitions is the objective;
minimal edits to existing integration plumbing are not a constraint. Adapter
changes may be substantial if retaining their current contracts would preserve
the expensive execution sequence. See the [reuse boundary](./MODULES.md#framework-reuse-and-integration-replacement).

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

The first candidate combines complete query operations, incrementally indexed
root state, compact identity with fresh mutable gates, redesigned framework
bridges and short database-local settlement. Preserve scalar per-scope commit
order initially and measure its occupancy under concurrent writes. Physical
storage remains open to replacement; this is not a requirement to preserve the
current layout or its internal validation sequence.

The brief now specifies [query/profile/authority contracts](./DESIGN.md),
[root structures and replacement rules](./MODULES.md#root-owned-indexed-state),
[before/after operation traces](./IMPLEMENTATION.md#initial-operation-trace-hypotheses)
and [early scaling witnesses](./VALIDATION.md#early-algorithm-and-concurrency-checks).
Concrete physical lock modes/writers and native compatibility evidence still
need proof for the wider core. The [first slice](./PAYLOAD-CREATE.md) binds its
create-only operation to actual rows, roles, lock order and native callbacks;
it removes no obligation from the active runtime.

Start with one genuine Payload create and an early standalone Application
query/mutation witness against the same core owners. Add one Medusa Product
scalar update, then one explicitly atomic Application + Product + Payload
mutation. Preserve the portable Application contract and native framework
behavior, and report unsupported capabilities. These are construction milestones;
acceptance requires standalone Application evidence as well as the complete
existing business graphs. Payload create or a mixed graph alone cannot establish
Application compatibility. See the [Application witness](./IMPLEMENTATION.md#early-standalone-application-witness).

Architecture obligations remain in the [accepted design](../../design-notes/flarex-db-accepted-design.md).
The [performance roadmap](../../roadmaps/core-performance/README.md) links this
separate lane. These documents authorize experimental mechanisms within the
recorded boundaries; they do not declare a production architecture cutover.
