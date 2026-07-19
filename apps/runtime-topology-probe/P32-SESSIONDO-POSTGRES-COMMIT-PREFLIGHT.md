# P32 SessionDO-Owned Postgres Commit Preflight

Status: approved by the owner on 2026-07-20. This record authorizes an
isolated app-local implementation and local proof. Production execution remains
conditional on the credential, resource-absence, cost, and teardown gates below.

This is a future-topology experiment under `apps/runtime-topology-probe`. It is
not a current Flarex roadmap, does not activate the production executor, and
does not select the conditional SessionDO/facet architecture.

## Question Under Test

P28-P31 proved a real cache-disabled Hyperdrive/Neon transaction behind a
separate commit entrypoint. The owner rejected putting the database client in
the Dynamic Worker isolate because trusted database code and untrusted user
code would share one isolate. P32-P35 instead test whether the supervising
SessionDO can own finalization without a separately deployed commit Worker or
a commit RPC in the candidate path.

The candidate topology is:

```text
protected routing Worker
  -> one SessionDO for the logical session
  -> network-isolated Dynamic Worker facet
       -> execute user-shaped code
       -> persist and return a sealed journal plus commit intent
  -> SessionDO verifies the exact returned intent
  -> one request-scoped pg.Client through cache-disabled Hyperdrive
  -> one Postgres transaction containing OCC, outcome insertion, and writes
  -> SessionDO receives the authoritative committed or recovered outcome
  -> SessionDO wakes the scope SyncDO after commit
```

One deployed Worker script may export the routing handler, SessionDO, SyncDO,
and the matched control entrypoint. They remain distinct Cloudflare execution
contexts; co-deployment does not make their memory or event loops shared.

## Trust And Transaction Boundary

The Dynamic Worker receives no binding, connection string, SQL client, commit
method, SyncDO namespace, or unrestricted outbound network. Its Worker Loader
configuration keeps `globalOutbound: null`. The facet owns only attempt-local
SQLite journal state and produces a sealed, strictly correlated intent.

The SessionDO owns:

- the session and attempt fence;
- the authoritative snapshot supplied to the facet;
- verification that the returned journal, result, and intent match the request;
- commit compilation for this synthetic probe;
- the Hyperdrive-backed Postgres client lifecycle;
- OCC and mutation application inside one Postgres transaction;
- exact terminal-outcome recovery by `attemptId`; and
- the post-commit SyncDO wake.

The SessionDO must not begin finalization through a callback from a running
facet. The facet returns first; only then does the SessionDO open the commit
boundary. This avoids facet-to-parent reentrancy while the parent is waiting on
the facet.

Postgres remains the final authority. SessionDO SQLite may record `running`,
`finishing`, and `completed` orchestration phases, but it cannot prove that a
transaction committed. After an uncertain response, the next exact delivery
queries the Postgres terminal outcome and either recovers it or safely retries
the same fenced transaction.

## Matched Comparison

The production comparison, if its gates pass, uses one deployed probe script
and two paths with identical snapshot, facet, journal, Postgres transaction,
and SyncDO work:

1. `entrypoint-control`: SessionDO calls a narrow same-script
   `WorkerEntrypoint`, which owns the request-scoped Postgres client.
2. `session-direct`: SessionDO invokes the same Postgres finalization operation
   locally and owns the request-scoped client itself.

The control exists only to measure the commit RPC boundary. It is not a second
Worker deployment and it is not the proposed architecture. The same complete
finalization operation owns the Postgres transaction and subsequent SyncDO wake
in both arms: it executes inside the control entrypoint in the control arm and
inside SessionDO in the candidate arm. The measured difference is therefore
the execution-context boundary, not different transaction or sync logic.

Primary measurements are external request time, SessionDO-to-facet time,
commit-boundary time, Postgres transaction or outcome-resolution time, and
post-commit SyncDO wake time. Correctness dominates latency: a path with an
ambiguous, duplicated, stale, or mismatched outcome is rejected regardless of
speed.

The smallest bounded campaign is eight counterbalanced pairs. Each arm in each
pair makes two sequential requests against one reused session and stable facet:
the first request activates that series and the second is its warm observation.
That is 16 runs and 32 external samples at concurrency one, with unique attempt
IDs and ordered scope revisions. The run stops on the first unexplained
correctness error.

## Local Proof Gate

Before any deployment, focused tests must prove:

- the facet WorkerCode contains no environment capability and blocks global
  outbound access;
- SessionDO waits for a strictly validated sealed intent before finalization;
- direct mode makes zero commit-entrypoint calls and control mode makes exactly
  one;
- OCC validation, outcome insertion, cursor advance, and commit remain in one
  Postgres transaction;
- exact replay recovers the terminal outcome without applying a second write;
- conflicting reuse of an attempt ID fails closed;
- rollback and `pg.Client.end()` run at their owning failure and lifecycle
  boundaries; and
- a committed outcome is established before SyncDO is invoked.

## Production And Credential Gates

The existing Wrangler OAuth session must resolve only to the owner's
`agmmdotdev` account. The supplied Neon owner URL must not be copied into source,
Wrangler config, generated evidence, shell history, logs, or Git. Production
provisioning requires the owner to place it in the process environment as
`RUNTIME_TOPOLOGY_PROBE_OWNER_DATABASE_URL`; its absence pauses production but
does not block local proof.

Provisioning follows the P28 least-privilege model: create a new random probe
role and isolated schema locally, store only that role in one cache-disabled
Hyperdrive configuration, and use fixed parameterized SQL. No existing P28
role, schema, Hyperdrive configuration, Worker, or Durable Object namespace may
be assumed to survive P31 teardown.

The owner's prior USD 2 authorization remains the program ceiling. This
extension freezes a narrower USD 0.05 maximum and fewer than 500 database
statements. Stop before deployment if the account, target database, absence of
name collisions, least-privilege role, cache-disabled Hyperdrive setting, or
cleanup path cannot be proved.

## Teardown

After evidence is persisted and reread:

1. purge every known facet, SessionDO, and SyncDO probe record;
2. deploy deleted-class migrations where required;
3. delete the isolated Worker script and Durable Object namespaces;
4. delete the Hyperdrive configuration;
5. drop the isolated Neon schema and generated role through the owner process;
6. remove local generated credentials and state; and
7. prove Worker, namespace, Hyperdrive, schema, role, and local-secret absence.

## Decision Rule

Prefer SessionDO-owned finalization only if it preserves every correctness and
capability boundary and either removes measurable commit-boundary latency or
materially simplifies deployment without a meaningful regression. A latency
win does not permit giving the Dynamic Worker database or network authority.

## Sources

- <https://developers.cloudflare.com/dynamic-workers/usage/egress-control/>
- <https://developers.cloudflare.com/dynamic-workers/usage/bindings/>
- <https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/>
- <https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/>
- <https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/>
