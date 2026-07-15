# Drizzle And Effect Postgres

Status: researched candidate direction, not an adopted dependency migration.

Evidence snapshot: 2026-07-15. Re-check registry metadata, installed exports,
and official documentation before implementation because the compatible
Drizzle integration is currently on the v1 release-candidate line.

## Decision

Flarex should reduce repeated `Effect.tryPromise` wrappers around Drizzle, but
it should not ban `Effect.tryPromise` or force an incompatible adapter into the
workspace.

The preferred long-term shape is an Effect-native database service in which a
query is already an Effect and the driver owns acquisition, release,
interruption, and SQL failure. The current safe shape is one narrow
Promise-to-Effect adapter at the driver-owning boundary. Pure planners,
validation, and state construction must not be placed inside that adapter.

Do not:

- wrap every Drizzle query independently at domain call sites;
- place a whole async transaction body inside one broad `tryPromise` when it
  also contains owned validation and domain failures;
- create a handwritten Effect facade for the entire Drizzle API;
- install the current `@effect/sql-drizzle` package into this Effect v4
  workspace; or
- upgrade Drizzle only to obtain more Effect-looking syntax without proving
  transaction, migration, PGlite, and Worker behavior.

## Verified Compatibility Matrix

| Candidate | Version facts on 2026-07-15 | Decision |
| --- | --- | --- |
| Current Flarex stack | Effect `4.0.0-beta.90`, Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10` | Keep until a dedicated migration gate is approved. Installed Drizzle has no `effect-postgres` or `effect-schema` export. |
| `@effect/sql-drizzle@0.51.0` | Peers on Effect `^3.22.0`, `@effect/sql ^0.52.0`, and Drizzle `>=0.43.1 <0.50` | Reject for Flarex. Its name is relevant, but its Effect major is not. |
| Drizzle ORM `1.0.0-rc.2` plus `@effect/sql-pg@4.0.0-beta.90` | Drizzle RC exports `drizzle-orm/effect-postgres` and accepts Effect v4 and Effect SQL Pg v4 | Candidate for an isolated proof, not yet the repository standard. |
| `drizzle-orm/effect-schema` on the v1 line | Generates Effect Schema values from Drizzle table schemas | Evaluate separately from query execution. It does not automatically own Flarex wire or domain schemas. |

Drizzle's official Effect Postgres guide currently tells users to install the
RC line and uses `PgDrizzle.makeWithDefaults()` with an `@effect/sql-pg`
`PgClient` Layer. Drizzle's v0-to-v1 guide also records breaking changes and a
Drizzle Kit rewrite alongside the new Effect integration. Therefore this is a
driver and major-version migration, not a small wrapper cleanup.

## Correct Current Boundary

While Flarex remains on Drizzle 0.45, adapt a rejecting Promise once where the
operation and driver failure are known:

```ts
import { Data, Effect } from "effect"

class PersistenceSqlError extends Data.TaggedError("PersistenceSqlError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

const fromDrizzlePromise = <A>(
  operation: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, PersistenceSqlError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new PersistenceSqlError({ operation, cause }),
  })

const loadSession = Effect.fn("SessionJournalStore.loadSession")(
  (sessionId: string) =>
    fromDrizzlePromise("load session", () =>
      db.select().from(sessionJournal).where(eq(sessionJournal.id, sessionId)),
    ),
)
```

This helper belongs inside the persistence adapter. It is not a general domain
utility. Higher layers should receive the typed Effect result and must not
catch and rewrap the same SQL cause again.

Owned failures remain outside the foreign exception wrapper:

```ts
const loadPinnedSession = Effect.fn("SessionJournalStore.loadPinnedSession")(
  function* (input: unknown) {
    const sessionId = yield* decodeSessionId(input)
    const rows = yield* loadSession(sessionId)
    return yield* decodeTrustedSessionRow(rows)
  },
)
```

Here input failure, SQL failure, absence, and stored corruption can remain
distinct. A broad `tryPromise` around the generator would erase that
ownership.

## Native Candidate Shape

The current Drizzle RC documentation demonstrates this shape:

```ts
import { PgClient } from "@effect/sql-pg"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Effect, Redacted } from "effect"

const PgClientLive = PgClient.layer({
  url: Redacted.make(databaseUrl),
})

const loadRows = Effect.gen(function* () {
  const db = yield* PgDrizzle.makeWithDefaults()
  return yield* db.select().from(sessionJournal)
})
```

This is direction evidence, not copy-paste authorization. Before using it,
verify the exact installed RC types, type parsers, error channel, logger and
cache defaults, pool lifecycle, and transaction API. A host should construct
and provide the database Layer once for its real lifecycle; an operation
should not rebuild it per query.

## Transaction Rule

Ordinary Drizzle transactions use an async callback and exceptions for
rollback. The Effect Postgres candidate must be judged by whether it can give
one Effect owner to the complete transaction outcome. Do not make
`Effect.runPromise` inside every Drizzle transaction callback the target
architecture.

Any accepted integration must prove:

- begin, isolation configuration, commit, rollback, and connection release;
- preservation of the original failure when rollback also fails;
- interruption behavior before and during commit, including unknown outcomes;
- nested transaction or savepoint behavior wherever Flarex relies on it;
- lock, retry, idempotency, and transaction-scoped client semantics; and
- that no transaction is held open while untrusted user code runs.

The first proof should use the smallest existing transaction helper whose
behavior is already covered in PGlite and real Postgres tests.

## PGlite And Cloudflare Cutline

The official native guide is specifically for Effect Postgres through
`@effect/sql-pg`. Drizzle still supports PGlite separately, but the researched
official material does not establish a matching Effect-native PGlite driver.
Do not infer parity from the shared Drizzle query API.

A migration preflight must choose and prove one of these outcomes:

1. both real Postgres and PGlite receive compatible Effect-native adapters;
2. the public persistence service is Effect-native while PGlite retains one
   narrow internal Promise adapter; or
3. PGlite can no longer prove the relevant boundary and is replaced for that
   lane by a bounded real-Postgres fixture.

For production, also prove that `@effect/sql-pg` bundles and runs in the
private Cloudflare Worker with the required compatibility flags and
cache-disabled Hyperdrive configuration. Verify TLS/config handling, pool
lifetime, connection cleanup, and Worker shutdown behavior. Package peer
compatibility alone is not a deployment proof.

## Effect Schema Cutline

`drizzle-orm/effect-schema` can derive select, insert, and update schemas from
Drizzle tables. That may reduce duplicate internal row-shape validation, but
it must not silently replace:

- Convex-compatible `ValidatorJson` behavior;
- public request, response, or persisted protocol schemas;
- branded domain constructors and authorization checks;
- explicit decoding of trusted stored corruption; or
- driver-aware codec proofs for values such as timestamps, numeric values,
  JSON, and byte arrays.

Treat generated database schemas as one candidate implementation of an
internal row boundary. Compare their encoded and decoded types with Flarex's
existing contracts before adoption.

## Required Proof Gates

A future implementation preflight should keep the work in this order:

1. lock an exact Drizzle RC, Drizzle Kit RC, Effect, and `@effect/sql-pg`
   compatibility set in an isolated branch or spike;
2. compile representative schema, select, insert, update, raw SQL, and
   migration paths without changing runtime ownership;
3. prove one transaction end to end in focused PGlite and real-Postgres lanes;
4. decide and prove the PGlite adapter strategy;
5. prove private Worker and Hyperdrive bundle/runtime behavior; and
6. only then approve a vertical persistence capability migration.

Stop if the RC requires an unrelated schema or migration-history rewrite. The
Effect benefit does not authorize coupling unrelated FlarexDB work into the
same checkpoint.

## Primary References

- [Drizzle Effect Postgres](https://orm.drizzle.team/docs/connect-effect-postgres)
- [Drizzle v0 to v1 changes](https://orm.drizzle.team/docs/v0-v1-changes)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle Effect Schema](https://orm.drizzle.team/docs/effect-schema)
- [Effect SQL Drizzle API](https://effect-ts.github.io/effect/docs/sql-drizzle)
- [Effect SQL Pg API](https://effect-ts.github.io/effect/docs/sql-pg)
