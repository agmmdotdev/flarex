# Third slice: actual DO Application query composition

Status: **Bounded Application query DO composition implemented**.
The [goal](../GOAL.md) remains active. This extends the
[timestamped handoff](./02-timestamped-cache-transfer.md) into an actual local
workerd Durable Object. It does not establish the full durable app coordinator,
production routing, hosted Hyperdrive acceptance or native framework hosting.

Source baseline: Flarex `f1e073cb4`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. Preserve unrelated shared-worktree
changes. The supported consumer is a private, trusted authored Application query
dispatch for a declared deployment/scope/physical locator. No database schema or
durable-data reset is selected.

## Independent challenge and convergence

The current-core, pinned-Convex and authority-boundary agents formed independent
findings, then exchanged and challenged their conclusions. The coordinator
selects read-only DO composition before the broader pending/dependency replacement.

| Finding | Disposition |
| --- | --- |
| Current query tests execute the app Worker, but core/database callbacks execute in Node; the test loader rejects DO classes. | Run the genuine query core inside workerd DO, with a real nested WorkerLoader and PostgreSQL socket path. A cache-only workerd test does not close this gap. |
| Current production entrypoints do not compose the Standard query system. Old `PartitionDO` owns SQLite documents, indexes and commit data. | Add an unrouted private app-level composition adapter; do not relabel the old SQLite engine or claim production migration. |
| Convex `Database::load` already holds a persistence lease before safe bootstrap, snapshot manager and committer construction. Its PostgreSQL `Lease::transact` fences each write. | This read-only host retains all PostgreSQL admission/read gates and receives no commit/retention authority. DO identity does not replace fencing. Full owner placement remains a later slice. |
| Captured Standard query layers retain database-bound live ports. | Retain stable host runtime/configuration/source/WorkerLoader and pure handoff only. Construct fresh request serving ports inside the actual invocation scope. |
| Connected-client runtime persistence lacks the current Application serving graph; standalone read serving issues a different capability without `readActive`. | Add a persistence-owned connected-client construction using existing authentic located-target, readiness, serving and active-selection issuers. Never cast the standalone reader or copy fixture authority. |
| Authored function references and active selections carry private issuer identity. | Construct references in trusted DO code and issue selection through the actual `readActive` owner inside that isolate. Neither may be reconstructed from caller JSON. |
| A client acquired outside `runQuery` can fail cleanup after query completion already published its cache. | The stable factory-backed query service acquires resources inside public `runQuery`'s owned scope. Snapshot release stages first; client cleanup settles before the existing completion owner publishes. Add no competing completion queue. |
| Standard invocation already depends on backend execution owners. | Put the Cloudflare adapter above both in `apps/executor`; a backend-to-Standard import would create a dependency cycle. |

## Current owner to replacement

- Existing PostgreSQL connected-client read-committed runner and authentic
  serving construction: **reuse/adapt** at persistence; no SQL or Drizzle in
  the host adapter and no second transaction/recovery owner.
- Existing `makeApplicationQuerySystemLayer`, capture/selection port and invoke
  construction: **adapt** through one reusable API-construction owner. A stable
  factory-backed service lends the fresh graph per invocation; existing static
  consumers use that same construction.
- Existing public `runQuery`, Worker source/manifest checks, snapshot/cache,
  result validation and completion: **keep** and execute inside the DO.
- Existing private executor host/socket patterns: **adapt** for the bounded
  DO composition. New adapter code stays outside production bindings/routes.
- Displaced construction duplication: **remove** in the affected factory/layer
  callers. Existing Node conformance and old engine consumers retain named
  obligations; this slice does not pretend they have all migrated.

The [host adaptation](../divergences/application-query-do-host.md) records why
and how this differs from full Convex database ownership. Its bounded dispatch
is ordinary trusted application code, not a new engine function registry. The
[client-lifetime adaptation](../divergences/postgres-client-lifetime.md) records
the pinned connection poller, Node driver error observation and complete cleanup
outcome needed by this host.

## Selected implementation contract

1. Bind one exact trusted deployment, canonical replacement scope and physical
   locator in local host configuration. Resolve association and located authority
   through existing owners at admission. The request supplies no SQL, topology,
   selection, source, grant, budget, schema/index port or result validator.
2. Retain one stable Effect runtime and data-only handoff per DO instance.
   Source reader and execution-host bindings belong to that host lifetime.
   Each invocation acquires its database resources in the scope owned by public
   `runQuery`; reuse the existing request/runner quarantine and cleanup semantics.
   No transaction spans user Worker execution.
3. Trusted local dispatch uses genuine authored references and calls public
   `runQuery` inside the DO. Bound and decode its private request at that owner;
   expose no generic remote reconstruction of a trusted reference or capability.
4. Reuse actual guarded admission, snapshot, refresh, logical accounting and
   completion. Keep current serialized PostgreSQL publication and live checks.
   A physical DO instance does not become the logical commit owner in this slice.
5. Keep cache state in RAM. Restart discards it and freshly admits PostgreSQL
   reconstruction. Do not write authoritative app data or a claimed persisted
   query cache to DO SQLite.

The selected anonymous query profile authenticates the private executor hop;
it does not acquire a transaction grant or compare a pinned principal-revocation
epoch. Its real warm refusal gates are active target/function, scope placement,
history and index readiness. Grant-epoch enforcement and credential/principal
proof remain profile-specific wider-goal obligations, not tests supplied by
changing the query fixture's SQL. Structural fence injection tests only the
existing guard; it does not prove a production takeover/maintenance writer.

Request-scoped clients are the selected lifetime here. Cloudflare documents
[handler-scoped clients and DO connection allocation](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
and [TCP socket lifecycle](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
DOs can retain connections; this slice chooses scoped resources rather than
claiming that platform feature is unavailable. Hosted connection pooling and
cache-disabled configuration remain separately required proof.

## Coordinated ownership and required proof

Persistence worker owns connected-client Application serving construction and
its owner tests. Host worker owns Standard construction reuse and the executor
DO adapter. Host-test worker owns the actual workerd fixture/consumer cases.
The coordinator owns documentation, package/export integration and validation
resources. Workers exchange exact API contracts before dependent edits; no
worker may repair an owner defect in its consumer adapter.

Prove actual DO -> public query -> isolated Worker -> snapshot -> completion;
cold/warm reuse; same-key and key-changing genuine mutation refresh; concurrent
exclusive checkout; active-target/function withdrawal, index-readiness refusal and changed generation; wrong configured tuple
refusal; result failure and client-cleanup failure before cache publication;
two-scope isolation; and restart at the same DO identity with a new boot and cold
authoritative reconstruction. Require positive controls and owned cleanup.

Use current PGlite owner/consumer evidence for shared semantics, meaningful
affected owner regressions on both database lanes, and ordinary-role PostgreSQL
for the connected-client/socket/actual-DO path. Do not emulate `pg.Client` with
PGlite and call it driver proof. Local workerd establishes its declared actual
runtime composition; hosted Hyperdrive, managed eviction and deployment claims
remain separate gates. Both mandated reviews and scoped commit are required.

General dynamic app routing, durable fencing/bootstrap, pending-state replacement,
out-of-order saves, native hosting and complete-request performance remain open.
Replication stays deferred.

## Runtime selection and conformance boundary

The complete local Windows functional scenario uses the selected default
`workerd@1.20260929.1` dependency, with no executable override. The native socket
and existing Application query, mutation, action and authority scenarios retain
their separate actual-host, PGlite and ordinary-role PostgreSQL scopes.
The original June host exposed native access-violation termination, and driver
investigation exposed a separate socket-read failure during cleanup. A reduced
DO/driver proof or passing rerun does not establish the native failure's cause.
Failed requests never publish their cache, and cleanup failures remain outcomes.

The controlled comparison retains the same Miniflare version, compatibility
date, application source, driver and database. September 29 is the first
published release containing upstream [atomic cppgc sweeping restoration](https://github.com/cloudflare/workerd/commit/e5803288aef5315a69cfcb759cfec11311464586).
The defect is present in the original `v1.20260611.1` source: its heap requests
atomic sweeping but the pinned V8 implementation overwrites that setting. The
upstream fix covers isolate-finalization failures involving Response/R2 stream
objects. This is source-grounded selection evidence, not attribution of our
observed native failure. Retain the executing binary identities and both
outcomes. The generic half-close comparison did not establish an acceptable
host. With the selected PostgreSQL end contract restored, the complete
functional scenario passes on September 29 while the June runtime still
produces native failure.
The selected [local runtime adaptation](../divergences/cloudflare-local-runtime.md)
owns dependency integration and default-runtime proof. This does not
establish the precise cause of the earlier native access violation.

The separate [STARTTLS witness](../../../../apps/executor/test/pgCloudflareSocket.postgres.test.ts)
executes the actual patched driver in default workerd against TLS-enabled
ordinary PostgreSQL. Its fixture CA is confined to that runtime's loopback
network service. It observes the PostgreSQL `S` response, the actual socket
class, server-reported TLS and complete client shutdown. An empty-CA control
fails before SQL, between two successful trusted connections. Native workerd
exposes an opaque network failure here; this does not establish a public
certificate-error classification. Direct TLS negotiation retains controlled
primitive coverage, without a claimed native PostgreSQL proof.

The shared action-authority harness recognizes only the existing task callback
JSON columns admitted by the native workflow owner. Its direct-action body
policy still rejects all other body columns and proves that the real database
CHECK rejects each callback payload on an existing direct-action HTTP row.
No production schema or effect ownership changes for this harness correction.

For the selected local PostgreSQL URL, Miniflare defaults omitted `sslmode` to
`disable` and selects its external native TCP service. Its Node Hyperdrive TLS
proxy is not on this path; changing that proxy would not correct this witness.
The reduced driver-only scenario also reproduces the graceful cleanup failure,
so the application engine, R2 and WorkerLoader are not required for that failure.
This does not attribute the separate access violation.
