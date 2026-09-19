# Product, Authority, And Package Boundary

## Status And Product

Accepted target under the
[live-query design](../../design-notes/runtime-agnostic-query-sync-engine.md);
implementation pending the [roadmap](./README.md). This replaces the former
product boundary that excluded portable client-session semantics.

The framework maintains a consistent reactive view of ordinary server queries.
The developer declares each query once against the application schema. Existing
reactive client usage automatically creates/releases subscription interest;
one-shot use stays one-shot. No sync manifest, second schema, `defineSync()`,
`liveQuery()` registration or explicit sync flag is required.

This is not a row/Shape replication product, offline database, workflow engine,
SQL planner, schema compiler or lossless application-event system. Existing
public/internal function visibility and authorization remain mandatory.

## Vocabulary

| Concept | Meaning |
| --- | --- |
| Source namespace | One authenticated transactional snapshot/ordering domain, not an arbitrary client-chosen tenant string |
| Source epoch and position | Source-issued fencing and precision-safe committed progress; positions do not mean wall-clock freshness |
| Query definition | Existing deployed read-only function plus code/schema/runtime-policy revision |
| Query instance | Canonical arguments and effective execution authority bound to a definition and namespace |
| Subscriber interest | A bounded renewable claim that a session still needs an instance |
| Session query set | Versioned set of interests receiving atomic transitions at common snapshot targets |
| Connection | Host-owned transport carrying session messages; not query identity or recovery authority |
| Target | Fixed source snapshot chosen for one session advancement |
| Result version | Value, dependency and validity evidence usable at certified targets; not necessarily the newest evaluated result |
| Reset generation | Fence for a rebuilt session/host instance; not a source epoch or database-data reset |

A namespace coordinator and session are distinct multi-instance values. Identical
query text or arguments alone cannot authorize sharing. Code, schema, source
and effective access identity are part of sharing and invalidation decisions.
Clients do not author trusted dependency sets, source positions, result digests
or access fingerprints.

## Three API Audiences

**Application developer:** ordinary query/mutation definitions and generated
references with reactive hooks or imperative one-shot APIs. No engine planners,
storage generations, execution receipts or adapter wiring.

**Flarex integrator:** construct a scope-bound service with a compatible query
source/runtime, sync state and host/transport. The Flarex bridge authenticates
and translates; it does not implement missing engine or database guarantees.

**Adapter author:** implement narrow contracts for snapshot/change correlation,
semantic atomic storage, or platform I/O. Provide conformance evidence. Do not
expose a generic get/set repository and leave atomicity to every consumer.

Exact export names and signature counts remain implementation decisions. The
current internal entry points are not the target user-facing API. A small service
surface must cover attach/update/release interest, bounded progress, session
transitions and reset/recovery without exposing every transition planner.

## Source Contract

Initially admit one source category: deterministic tracked query execution over
a transactional source with coherent snapshots and replayable ordered changes.
The source must support a selected target or an equivalent certified coherent
query-set snapshot. Arbitrary callbacks, external APIs and best-effort change
notifications are insufficient.

Query evaluation and changes share one explicit epoch/position/dependency model.
The source adapter reports retention loss and authority drift; it cannot forge
validity or quietly evaluate each query at a different newer snapshot. Runtime
instrumentation captures point reads including absence, empty ranges and any
supported relation traversal. Conservative dependencies may over-invalidate;
false negatives are forbidden. All nested reads participate in the same snapshot.

The runtime may reuse core logical read observation. The sync boundary does not
receive locks, journals, mutable transaction handles or an independently copied
schema. Time/randomness/external reads require a defined deterministic policy.
Authorization changes must be observable and pending delivery fenced when they
are observed; comparing hashes during one evaluation is not continuous revocation.

## Package Direction

```text
Flarex runtime / SDK -> Flarex bridge -> source/executor contracts
                                    -> query-sync contracts
query-sync -> generic sync-state capability
host adapter -> query-sync + platform APIs
```

The engine may depend on Effect and exact dependency-leaf utilities. It must not
import Flarex protocol/database, framework models, Cloudflare, SQL drivers,
HTTP/WebSocket implementations or React. The database core must remain usable
without importing the engine or owning subscriber state.

Portable session/transition/reconnect decisions belong inside the framework.
The client-facing protocol implementation must also be testable over loopback;
framework-specific hooks and actual sockets remain adapters. Do not outsource
session consistency to a stream library or duplicate it in gateways.

Extract reusable SQLite schema/operations from `flarex-backend/deploymentSync`
into an appropriate query-sync-owned adapter boundary. Keep the Cloudflare
transaction bridge and Flarex scope authentication outside it. Prefer deliberate
subpaths in existing packages over package proliferation. Moving neutral runtime
contracts out of a backend host can correct an import cycle; adding wrappers
around the cycle is not the goal.

## Non-Negotiable Boundaries

The database owns authoritative business data and committed outcomes. Reliable
snapshot/feed capabilities stay with their producer; subscription registries do
not. The engine owns derived query/session coordination and bounded recovery.
The host owns placement, scheduling and transport resources. The bridge joins
these contracts without a second registry, reducer, cursor authority or fallback.

A second production database/host is not required to test the service. Conversely,
a synthetic source is not proof that every real database can implement its
contract, or that a deployed Cloudflare adapter is correct or economical.
