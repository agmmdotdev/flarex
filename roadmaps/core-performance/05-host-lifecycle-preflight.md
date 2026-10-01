# Host Lifecycle: Conditional Component Preflight

Status: **conditional; host runtime changes and activation are unapproved.**
This document prepares the final group in the
[component sequence](./README.md). It does not activate the older conditional
[host slice](../mixed-mutation-core/18-host-lifecycle-preflight.md), approve host
reuse or attribute the remaining latency gap to startup.

## Conditional Outcome And Scope

If evidence after core component work establishes a material host-owned cost,
investigate one bounded lifecycle/transport improvement in its existing owner.
Preserve sandbox isolation, genuine runtime/source identity, exact claim and
capability lifetime, cleanup, cancellation and the one trusted settlement owner.
Runtime implementation requires a focused host contract decision first.

New developer APIs, hosted activation, unrelated compute routing, durable data
deletion and arbitrary framework expansion are excluded. A local Node/Worker
component result is not Cloudflare performance, isolation or capacity proof.

## Evidence And Responsible Owners

The complete private benchmark uses a fresh single-use Worker per mixed request.
There is no new CPU diagnostic or demonstrated host cause in the aggregate-entry
measurement. Driver await, idle/generated frames and a large end-to-end interval
cannot assign CPU or startup cost. The prior incomplete initial-authentication
fixture is not a matched host comparison.

| Owner | Attribution and contract to inspect |
| --- | --- |
| Backend `artifactRuntime/ApplicationExecutionHost.ts`, `ApplicationPointMutationRunner.ts`, `ApplicationRuntimeMaterializer.ts`, `ApplicationRuntimeSourceAuthority.ts` | Trusted host construction, exact artifact/source/runtime projection and creation/close cost |
| `ApplicationWorkerDefinition.ts`, `ApplicationWorkerRuntime.ts`, Worker core/source owners | Sandbox instance identity, per-request state, bindings, serialization and cleanup |
| Executor `pointMutationExactRuntimeBinding.ts`, `pointMutationExactRuntimeRunner.ts` and runtime-neutral runner model | Canonical authenticated runner input, exact journal/capability binding and no host authority transfer |
| Executor claim-liveness and journal RPC owners | Genuine renewal/supervision, deadlines, consumed capabilities and request/response boundaries |
| Existing backend/Worker test bridge and real Workerd tests | Local versus hosted transport, error/interruption/close behavior and actual isolation evidence |
| Native framework adapters | Framework callbacks, transaction-manager lifetime and business effects; host changes cannot move their semantics into executor core |

Verify exact production/private routing before touching a host. Record which
mechanics, startup, serialization, queue/connection wait and cleanup costs are
actually observed; keep unattributed intervals explicit. Current construction
lifetimes and separate execution profiles are authoritative until changed by
the accepted host decision.

## Baseline And Challenged Alternatives

Use the complete genuine initial authentication/renewal path and the same
business graph. Observe host creation, actual invocation, transport, teardown
and total work separately. Declare process/runtime version, lifecycle reset,
cache rules, instance concurrency, database/pool and byte settings, timer/sample
policy and cold/warm definitions. Retain all outliers, failures and retries.
Component setup reporting must not silently amortize a single-use host or create
an equivalent-profile claim for reused state.

Do not select pooling, persistent isolates, long-lived prepared graphs, RPC
rewrites or alternative compute from an unassigned latency gap. Each would need
its own identity/isolation/lifetime/concurrency/cleanup contract. Existing hosts
translate runtime inputs and outputs; they cannot repair a core owner by keeping
a transaction open, bypassing admission or copying authority/settlement logic.

## Activation, Breaking Changes And Cleanup

The gate requires concrete host-attributed cost, a matched native/runtime
baseline, the exact proposed host lifecycle and capability contract, isolation
and failure proofs, numeric budgets and explicit local/hosted claim limits.
Materially changed routing, activation, public API, identity or lifetime must be
discussed and accepted before runtime implementation. Earlier component approval
does not grant that host decision.

If approved, inventory all backend/executor/Worker/framework callers and update
the exact source/compatibility guards. Replace displaced private host mechanics
and remove duplicate adapters/exports/fixtures in the same slice. Preserve real
production/private/compatibility hosts only for named supported obligations;
avoid a fallback engine or opportunistic compute switch. No durable format or
data disposition is selected here.

## Validation And Completion Gates

Prove exact source/runtime/artifact identity, no cross-request state or authority
leak, same-scope and different-scope concurrency, consumed/foreign/serialized
capability refusal, cancellation/deadline/heartbeat, host failure, poison/close,
cleanup and repeated creation. Native callbacks must run without an open database
transaction. Durable outcomes and uncertain COMMIT recover through the existing
owner with no duplicate callbacks/events. Use focused Workerd/real-host proofs
for any host claim; PGlite and ordinary-role PostgreSQL still prove changed
persistence/transaction behavior.

Run affected type/build/source guards, lint and both final reviews, migrate
callers, clean up and commit only the approved bounded host slice. Matched full
mixed integration measurements are required for a host lifecycle cutover and
before whole-goal acceptance. Core stage improvements and local host timings do
not independently close the unchanged mixed latency or production gates.
