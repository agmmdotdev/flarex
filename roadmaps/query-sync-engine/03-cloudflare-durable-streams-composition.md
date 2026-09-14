# Host And Delivery Composition

## Status And Decision

Accepted replacement direction under the
[live-query design](../../design-notes/runtime-agnostic-query-sync-engine.md).
The filename is retained for existing links. The former mandatory
Durable-Streams-oriented publication workflow is no longer the default target.
No production transport or replacement host is implemented by this decision.

The portable framework owns query/session semantics, including consistent
query-set transitions, reset and reconnect decisions. The host owns sockets,
platform scheduling and storage/transport adaptation. A delivery library may
supply transport mechanics, not redefine source positions, authority or session
consistency. Full Electric row/Shape replication is not the ordinary query path.

## Initial Flarex Placement

```text
Postgres + trusted executor
  source snapshots, tracked query execution, ordered committed changes
                   |
            Flarex sync bridge
                   |
    scope coordinator Durable Object
    portable query tracking + session coordination
    reusable sync-owned SQLite state adapter
                   |
      authenticated connection gateway(s)
                   |
            reactive Flarex SDK
```

One coordinator per authorized data scope is the first placement hypothesis.
The engine uses logical namespaces, not Durable Object names. Do not start with
an actor per query, collection, table or subscriber. Scope-level coordination
has finite hot-scope capacity; execution and delivery should not unnecessarily
serialize behind that actor's local state transaction.

The existing executor owns authoritative Postgres access. Preserve its private
service boundary and cache-disabled query path. The bridge supplies trusted
execution material, target and dependency/authority receipts; it does not grant
browser inputs database authority. Neutral runtime contracts belong below host
implementations rather than creating a backend/invocation import cycle.

## Default Delivery Contract

Deliver versioned atomic session transitions with bounded buffering and
recovery-to-snapshot. Intermediate UI states may be coalesced; business events
are not carried with lossless semantics by this service. A slow or blocked
session must not block unrelated sessions in the source scope.

The protocol must fence source epoch/position, session/reset generation,
query-set membership and authorization revision. A transport offset is not a
source snapshot. Apply the whole transition before checkpoint advancement.
Resume only when the required retained state exists; otherwise explicitly reset
and reconstruct an authorized snapshot. Missing frames and duplicate/reverse
frames must not produce a mixed or regressing view.

A post-send acknowledgement can be lost. The default UI contract may recover by
reconciliation or reset instead of resolving every historical send attempt.
There must still be an explicit recovery owner for lost notifications on live
connections. Queued bytes, resume age, target lifetime and resnapshot work are
bounded. Do not silently drop required current state and report the session fresh.

## Wakes, Restart And State Loss

Database commit writes authoritative change/recovery evidence and never waits
for query invalidation, session coordination or network fan-out. A direct wake
only reduces latency. Prove recovery if it is lost before any result is queued.

The host supplies demand-aware bounded scheduling and a recoverable wake/lag
check. A checkpoint mirror may be a source/host optimization but cannot own
queries or lead actual admitted progress. Its exact placement and fencing require
a named capability; do not create a database-core subscriber table by default.

Object reconstruction reopens state or triggers a generation-fenced reset.
Gateways must notice coordinator-generation loss and reattach active interest or
instruct clients to re-register. In-memory callbacks are not the only copy of
required execution material. Explicitly expired derived state can be rebuilt;
corruption or unexpected absence cannot silently authorize initialization.

The sync actor and a WebSocket gateway have different lifecycle proofs. Local
reopen, controlled deployed restart, observed platform eviction and WebSocket
hibernation must be labeled separately. No network call crosses a local SQLite
transaction. Do not retain empty-scope timers or indefinitely poll inactive
subscriptions.

## Authentication And Failure Isolation

Authenticate function visibility, namespace, execution identity and each session
attachment. Query/result sharing requires identical effective authorization,
not just equal arguments. Reconnect is reauthorization, not permanent reuse of an
old capability. On observed revocation/expiry, invalidate old work and buffered
frames, terminate or reset affected access, and forbid attachment to old shared
results. Define and measure revocation-detection delay.

Source failures, query errors, slow sessions and store corruption have different
policies. Isolate them at their legitimate boundary. Do not turn a committed
mutation into an apparent rollback because sync visibility failed. Do not reset
all sessions to work around one invalid query or one blocked delivery target.

## Optional Durable Streams Research

`QSYNC-CF01` is optional transport research, not a required successor gate. A
future proposal must show that a stream adapter preserves atomic session query
sets, access revocation, bounded retention/reset and independent failure domains.
It must justify stream cardinality and lifecycle cost against the simpler
existing connection-host composition.

Old exact producer tuple, immutable append payload and uncertainty rules remain
requirements of any retained adapter that actually uses that contract. They
are not silently weakened or attributed to the new UI protocol. Pin and verify
upstream versions before using old feasibility findings as current facts. No
private fork, stream adoption, external result store or new transport package is
authorized by this document.

## Host Exit Conditions

Prove source-to-engine isolation, authoritative mutation-to-session visibility,
continuous writes, lost wake before rerun, interrupted send, coordinator/gateway
restart, state-loss reset, active credential revocation, slow-consumer bounds and
fairness across two scopes. Measure requests, execution, memory, state I/O,
fan-out, idle scheduling and retained bytes. Real host evidence supplements,
never replaces, the permanent independent local suite.
