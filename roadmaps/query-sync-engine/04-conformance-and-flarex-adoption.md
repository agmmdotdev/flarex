# Conformance And Flarex Adoption

## Status And Proof Principle

The [accepted live-query redesign](../../design-notes/runtime-agnostic-query-sync-engine.md)
is documentation only. Existing private kernel/adapter tests prove their current
contracts, not the new service. This file replaces the former adoption sequence;
[the roadmap](./README.md) owns the current gates.

Standalone means the complete query/session service and its real local state
adapter can be tested without FlarexDB, Postgres, Cloudflare or credentials.
It does not mean postponing a narrow real-source feasibility check until the
engine is finished. Both tracks use the same source contract.

## Permanent Independent Test Composition

```text
small synthetic transactional source with tracked queries
                      |
             portable query-sync service
                      |
        actual local sync-state persistence
                      |
       loopback session/client protocol adapter
```

The synthetic source supplies immutable versioned records, target snapshots,
complete commit history, empty/absence/range reads and controlled authority/code
changes. It runs small actual queries rather than merely returning scripted
correct answers. It is not a second production database or an alternate engine.
An additional small model fixture may check that contracts are not Flarex-shaped;
that is not a commitment to a universal source-adapter product.

Expected-result assertions independently recompute the required queries against
the chosen snapshot. A reference reducer that calls the production planners is
useful for adapter agreement but is not an independent correctness oracle.
Retain existing conformance tests; add independent safety and progress checks.

## Conformance Matrix

| Lane | Required evidence |
| --- | --- |
| Pure policies | Canonical identities, epoch/ordering, no false-negative invalidation, generation fencing, fixed-target progress, bounded result validity/retention |
| Independent source/oracle | Actual query values match claimed snapshots; absence/range/dependency changes; sustained relevant and unrelated writes; no source-state mutation |
| Local real state adapter | Same SQL/schema operations used by the host; rollback, crash-point settlement, reopen, selective reads, limits, migration/refusal and reset |
| Loopback sessions/client | Automatic interest lifetime, sharing isolation, membership changes, atomic query-set application, mutation visibility, duplicate/reverse/missing frames, reset and expiry |
| Source adapter | Selected-target feasibility, exact snapshot/feed correlation, retained-floor/epoch refusal, dependency and authorization completeness; no fabricated evidence |
| Real Flarex bridge | One real query plus mutation through the same contract, including actual execution cost and dependency capture; no parallel registry |
| Real Postgres | Target history, transaction/source ordering, retention, authority and uncertain-commit boundaries under ordinary admitted roles |
| Workerd/Cloudflare | Actual SQLite transaction bridge, private service binding, bounded scheduling, lost-wake recovery, accurately labeled restart/eviction/hibernation and resource costs |

Local proofs do not claim production durability, throughput or Cloudflare
behavior. A second real durable host passing the applicable contract is required
before broad production-portability claims; it does not block the independent
local correctness suite or first Flarex proof.

## Required Race And Recovery Scenarios

- Initial evaluation overlaps committed changes; dependency installation retains
  every relevant post-target change and old completion cannot clear future work.
- Continuous relevant writes do not force the chosen target to chase latest
  forever. With admitted fair capacity, sessions advance without requiring quiet.
- A query changes its dependency set; missing points, empty ranges, insertions,
  deletions, key moves and supported relation reads remain correctly observed.
- Two queries finish at different times; a session never publishes mixed target
  snapshots. Membership changes fence in-flight query-set work.
- Two sessions share an instance; one release/expiry/slow consumer does not remove
  the other's interest or prevent its progress.
- Revocation or credential expiry occurs with evaluation or buffered delivery in
  flight; old access is fenced after detection and reconnect reauthorizes.
- A mutation commits while transport fails; visibility waits/reset do not imply
  rollback or unsafe write replay. Test concurrent mutations and query-set changes.
- Direct wake is lost before results exist; lost send/ack on a live connection is
  reconciled, not left stale until an unrelated future write happens.
- Engine, gateway or client restarts; leases/material recover or an explicit reset
  re-registers current interest. Stale responses cannot cross reset generations.
- Target or resume history expires; the reset/error is explicit and storage/work
  remains bounded. Corruption is not treated as fresh initialization.
- One query/source/session exceeds a budget; named failure policy and fair work
  protect unrelated sessions/scopes without bypassing configured limits.

Each scenario states whether it retries, completes at a fixed target, produces
an explicit error or resets. "Try again" without identity and state effects is
not a recovery contract.

## Performance Evidence

Separate engine overhead from query execution and transport. Use one shared
query with many subscribers, many distinct personalized queries, mostly
unaffected dependency populations, a hot shared dependency, large results,
slow consumers, rapid interest churn and restart with backlog.

Record CPU, allocations/peak memory, affected-key work, reevaluations and unchanged
results, state rows/instructions read/written, retained versions/bytes, session
latency, lag and recovery cost. Fix affected work while growing unrelated state
to detect full scans. A `LIMIT` bounds rows returned, not necessarily scan work.

The existing whole-dependency role audit and coarse table invalidation are
measurement targets, not claims of measured gains from this docs PR. No table
count, passing fixture or higher limit substitutes for a workload measurement.

## Retain, Replace And Remove

| Current owner | Disposition / retirement gate |
| --- | --- |
| Portable canonicalization, sequence and pure planner foundations | Retain where correct; adapt to fixed targets and session semantics with decisive tests |
| Nine-operation `QuerySyncTransitionState` and moving-latest completion | Replace affected contracts with consumers; do not preserve method count or replay shapes for their own sake |
| Exact per-scope publication attempt/settlement machinery | Retain for current baseline until target recovery passes; remove from default UI path in the coherent cutover |
| `deploymentSync/Store.ts`, codecs and storage generations | Extract generic state implementation from Flarex binding; inventory actual stored state before conversion/reset or dropping unused generations |
| `deploymentSync/Binding.ts`, Flarex query/change mappings | Keep authentication/mapping in the bridge, not the portable SQL adapter |
| Postgres source feed, snapshots, outcomes and transaction outboxes | Preserve producer authority; no subscriber registry belongs to the core |
| Prototype `live_query_subscriptions`, `live_query_deliveries` and connection registry callers | Retire with named consumers after target-only reset/reconnect/visibility proof; no immediate destructive DDL |
| ConnectionDO and client prototype | Reuse suitable transport code; replace duplicated session algorithms with the portable protocol |
| Historical preflights 00-14 | Retain baseline evidence; conflicting unfinished implementation authorization is held |

## Cutover And Relation Gate

Inspect concrete exports, callers, stored formats and named environments before
changing them. State exactly which identity, completion, state, protocol or
adapter contracts break and how readers/clients cut over. No compatibility
wrapper, dual registry, dual writer, shadow engine or fallback is introduced to
avoid migrating current consumers. A discovered real compatibility obligation
requires an explicit bounded plan, not silent data deletion.

`R03-B` remains a consumer of the common engine: prove relation-query identity,
complete relation dependency capture, target snapshots, authority, session
transitions, reset/reconnect and target-only recovery. Do not add relation-local
sync state. Non-reactive relation/core work remains independently gated.

Implementation slices follow the repository's review, Effect, lint and real-
platform evidence rules. Documentation changes do not authorize TypeScript,
SQL, routes, live traffic, database resets or transport selection.
