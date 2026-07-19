# P28 Real Postgres And Hyperdrive Preflight

Status: approved in principle by the owner on 2026-07-19; implementation and
all external mutations remain after this recorded preflight.

This is a later isolated `apps/runtime-topology-probe` experiment. It does not
activate `apps/executor`, change an active Flarex roadmap, or claim that the
production executor/OCC path is complete.

## Question Under Test

P20-P27 measured a synthetic finalization service and proved that warm
SessionDO/facet reuse can remove most startup latency, but the result contained
no Postgres transaction or Hyperdrive connection. P28-P31 ask how much latency
and failure behavior remain when the trusted facet shell calls a narrow private
executor that performs a real authoritative transaction through cache-disabled
Hyperdrive against the owner's Singapore Neon database.

The target topology is:

```text
external probe collector
  -> protected gateway Worker
  -> ProbeSessionDO
  -> trusted platform shell in a Dynamic Worker facet
       -> narrow Postgres finalization service binding
       -> private probe Postgres Worker
       -> one request-scoped pg.Client
       -> cache-disabled Hyperdrive
       -> isolated Neon schema transaction
       -> post-commit ProbeSyncDO wake
```

The Postgres Worker, not the Dynamic Worker or user handler, owns the
Hyperdrive binding and connection string. The trusted facet shell owns intent
construction and correlation but receives only the narrow finalization RPC.
User code receives neither SQL, `pg.Client`, Hyperdrive, credentials, nor a
generic service binding.

## Credential And Database Isolation

The supplied Neon URL is a pooled owner connection. It must not be copied into
Wrangler configuration, a Worker secret, a source file, a generated artifact,
or Git.

Cloudflare's Neon guide instructs Hyperdrive users to disable Neon connection
pooling, because Hyperdrive is already the connection pool. The bootstrap must
therefore use the equivalent direct Singapore endpoint. The owner credential
is used only from the local bootstrap/teardown process to:

1. create a cryptographically random login role dedicated to this probe;
2. create one isolated schema owned by that role; and
3. later drop the schema and role after Hyperdrive and Workers are removed.

Only the generated least-privilege role is stored in the Cloudflare Hyperdrive
configuration. Hyperdrive query caching must be explicitly disabled, TLS mode
must be `require`, and the soft origin connection limit must be the minimum
five. No owner credential is retained in Cloudflare or local files.

The dedicated schema contains only:

- one scope-cursor table keyed by the synthetic scope;
- one terminal attempt-outcome table keyed by `attemptId`; and
- no Flarex tenant, deployment, user, artifact, or application data.

Every table name is fixed platform code. All values are parameters. The probe
role receives no privilege outside its own schema.

## Real Transaction Contract

The Postgres finalization operation opens one request-scoped `pg.Client` from
the Hyperdrive-generated connection string. In one database transaction it:

1. checks for an existing exact attempt outcome and returns it idempotently;
2. locks the one scope cursor;
3. validates the expected pre-commit cursor and ordered commit sequence;
4. records the terminal attempt outcome and advances the cursor atomically;
5. commits before waking SyncDO; and
6. returns a strictly decoded receipt with database-only and post-commit wake
   durations kept separate.

Duplicate, gap, stale, attempt-conflict, transient database, and terminal
database failures remain distinct. Postgres is the only authority for a
committed outcome. If the facet-to-executor response becomes uncertain, the
SessionDO may ask the same private Worker for the exact Postgres outcome; it
must not infer success from facet SQLite or SyncDO.

`pg.Client` is created inside each service invocation and cleaned up at that
request boundary. It is never cached in module, SessionDO, or facet state.

## Challenged Alternatives

### Bind Hyperdrive directly into the Dynamic Worker

Rejected. A Hyperdrive binding exposes a connection string usable by any code
that can reach the dynamic environment. Keeping it behind a private,
platform-owned Worker gives the facet one narrow operation without teaching
untrusted code a database capability.

### Store the supplied owner URL as a Worker secret

Rejected. Hyperdrive already stores origin credentials and gives the Worker a
generated connection string. Persisting the owner URL again creates a second
credential surface with broader authority than the probe requires.

### Use the supplied Neon pooler endpoint behind Hyperdrive

Rejected. This creates two pooling layers and contradicts Cloudflare's Neon
instructions. The direct endpoint is the correctness-preserving target.

### Activate the main `apps/executor` Worker

Rejected for this slice. That Worker targets the real Flarex persistence and
hosted-runtime H05 gates. Pointing it at an arbitrary database or public schema
would mix a probe with active architecture, migrations, and production
authority. P28 uses a self-contained schema and protocol instead.

## Frozen Production Shape

The implementation will freeze a paired mock/real-Postgres warm-reuse matrix:

- eight matched series per arm;
- six sequential requests per series: request one cold, requests two through
  six warm;
- 96 total external requests, concurrency one;
- stable code and one reused SessionDO/facet per series;
- unique attempt fences and ordered commit sequences;
- 64 payload bytes and two journal entries;
- exact callback, Postgres cursor, terminal outcome, SyncDO cursor, replay,
  conflict, and cleanup evidence; and
- a 90-second propagation gate after the final deployment/secret change before
  campaign registration, addressing the unresolved P26 rollout-lifetime
  hypothesis.

The mock arm proves that the prior warm path remains healthy in the same
deployment. The candidate arm measures the additional Postgres/Hyperdrive
transaction cost without attributing client/gateway overhead to the database.
The descriptive comparison reports external request,
`gateway_session_rtt`, `session_facet_rtt`, database transaction, and
post-commit SyncDO wake separately.

Mechanical success requires every planned request to become terminal, exact
Postgres and SyncDO cursors to agree, terminal outcomes to replay without a
second write, conflicts to fail closed, artifacts to be publishable, and every
database/Cloudflare resource to be removed. No latency threshold can override
a correctness failure.

## Cost And Cleanup Boundary

The owner previously authorized at most USD 2 incremental Cloudflare spend for
this isolated probe program. P28-P31 freeze a narrower maximum of USD 0.05.
Hyperdrive pooling and query caching are included in the Workers Paid plan;
ordinary Worker, Durable Object, Dynamic Worker, and existing Neon-plan usage
are still reported conservatively.

The expected Hyperdrive volume is below 1,000 statements including bootstrap,
measurement, verification, and teardown. Production must stop before sample
execution if the account, resource-name absence, direct database target,
cache-disabled configuration, role/schema isolation, deployment bindings, or
cost ceiling cannot be proved.

Teardown order is:

1. seal and persist secret-free evidence;
2. purge campaign, facets, sessions, SyncDOs, RunDOs, and probe Postgres rows;
3. remove gateway and SyncDO classes through deleted-class deployments;
4. delete gateway, mock, Postgres, and sync Workers and their secrets;
5. delete the Hyperdrive configuration;
6. use the owner connection locally to drop the isolated schema and role;
7. verify all Worker names, Durable Object namespaces, Hyperdrive identity,
   database schema, role, and local credential variables are absent; and
8. commit only the isolated app plus the unavoidable root lockfile entry for
   the app's direct `pg` dependency.

## Sources

- [Cloudflare Hyperdrive with Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
- [Hyperdrive query caching guidance](https://developers.cloudflare.com/hyperdrive/reference/faq/)
- [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
