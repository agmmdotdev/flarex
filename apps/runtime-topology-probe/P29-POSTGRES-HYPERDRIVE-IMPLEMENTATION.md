# P29 Postgres And Hyperdrive Implementation

Status: implementation and focused local proof complete on 2026-07-19.

P29 remains isolated to `apps/runtime-topology-probe`. It does not activate the
main executor or alter a Flarex architecture roadmap.

## Delivered Boundary

The probe now has a private `postgresCommitWorker.ts` with two RPC entrypoints:

- `PostgresReadEntrypoint` obtains the authoritative synthetic cursor through
  one request-scoped `pg.Client` and cache-disabled Hyperdrive.
- `PostgresFinishEntrypoint` checks the exact attempt, snapshot revision,
  commit sequence, journal seal, result digest, and commit-intent digest; then
  stores the terminal outcome and advances the cursor in one transaction. It
  commits before calling SyncDO.
- `PostgresFinishEntrypoint.resolve` reads the exact authoritative terminal
  outcome after an uncertain response and repeats only the idempotent SyncDO
  wake. The facet and SessionDO can then persist a recovered terminal receipt.

The transaction locks the scope cursor before deciding whether an attempt is a
duplicate. Concurrent identical delivery therefore observes the exact outcome
after the first transaction commits instead of reporting a false OCC conflict.
If no outcome exists, `resolve` runs that same idempotent fenced transaction,
so a transient pre-commit failure can commit on retry. Receipts distinguish a
new commit from an exact recovery and expose resolution time separately; a
lookup is never labeled as commit-transaction latency.
The final sample trace carries exactly one database span:
`commit_transaction_io` for a new commit or `outcome_resolution_io` for an
exact recovery. This prevents not-applicable zero placeholders from entering
either latency cohort. A durable `running` facet attempt is safe to rerun after
a pre-finalization interruption; the exact `running` to `finishing` transition
still fences the one finish call.

The Dynamic Worker receives only the narrow read/finish RPC bindings. It never
receives Hyperdrive, a connection string, a SQL client, or database
credentials. Finish receipts now distinguish `mock` from `postgres` authority
and report transaction and post-commit SyncDO durations separately.

The private Worker uses Effect `acquireUseRelease` to acquire, use, and close a
fresh `pg.Client` for each operation. A failed operation retains its typed
operation context, client-close failure remains in the Effect cause, and the
Worker RPC boundary still fails closed.

## Provisioning And Isolation

The local bootstrap uses the supplied owner URL only from a process environment
variable. It creates a random login role, an owner-controlled fixed probe
schema, and two fixed tables. The probe role receives only schema usage and
table DML; unlike P28's initial wording, it does **not** own the schema and
cannot create or alter tables. This is a smaller authority boundary.

Wrangler creates Hyperdrive against the direct Singapore Neon hostname, not
the supplied pooled hostname. The configuration has:

- query caching disabled;
- TLS `sslmode=require`;
- an origin connection limit of five; and
- only the generated probe role, never the database owner.

Generated passwords and the live Wrangler configuration are stored only under
ignored local probe state. Neither is printed in evidence or committed.
The final bootstrap journals `planned`, `database-ready`,
`hyperdrive-create-attempted`, and `ready` before and after external mutations.
Each state replacement is flushed to a restrictive same-directory temporary
file and atomically renamed, so a failed publication leaves the prior valid
recovery state intact.
Cleanup first reads the generated runtime config, then uses bounded repeated
name lookups to prove absence after an uncertain create. It tolerates
already-absent state, uses idempotent database drops, and retains the recovery
journal until cleanup succeeds.

The Postgres arm now owns the distinct
`facet_finalizer_postgres_warm_invoke` scenario. Its receipt must report
Postgres authority and its trace must include exactly one commit or recovery
database span. The older
mock finalizer scenarios retain their original trace and sample shape. All
current generated Dynamic Worker sources use v2 code identities because the
shared source validators changed. The sealed sample decoder alone retains
exact v1 identity compatibility for historical non-Postgres evidence; the new
Postgres scenario never admits a v1 source identity.
Its Worker Loader identity also uses the distinct
`invoke-finalizer-postgres-warm` profile, preventing the new finish/resolve
capability contract from reusing the legacy warm-finalizer code identity.

## Validation Receipt

- TypeScript strict check: passed.
- Focused protocol, invocation, gateway/Miniflare, trace, and teardown tests:
  86 passed before production; post-review transaction and recovery tests are
  included in the final 28-file, 264-test full-suite receipt.
- Gateway, Postgres-bound gateway, and Postgres Worker Wrangler dry-runs:
  passed. The private Postgres bundle exposed only Hyperdrive and the external
  SyncDO namespace.
- Direct least-privilege-role inspection after production execution: nine
  synthetic scopes, 38 terminal outcomes, and maximum cursor six. The ninth
  scope and one outcome came from the intentionally preserved diagnostic run.

The base `wrangler.postgres.jsonc` contains a non-live placeholder ID for
repeatable dry-runs. Production deployment uses an ignored generated copy with
the live Hyperdrive ID.

## Discovered Corrections

Wrangler represents Hyperdrive IDs as 32 hexadecimal characters rather than a
UUID. The first bootstrap therefore rejected its own receipt after Cloudflare
creation. The Neon transaction rolled back, the orphan Hyperdrive config was
immediately deleted, the validator was corrected, and a clean bootstrap then
succeeded.

Reusing mock-arm scope IDs in the first Postgres diagnostic also caused the
retained SyncDO purge tombstone to reject reopening those identities. The real
Postgres transaction had committed correctly. The production arm was corrected
to use distinct campaign, run, scope, session, attempt, and facet identities;
the tombstone rule was not weakened.
