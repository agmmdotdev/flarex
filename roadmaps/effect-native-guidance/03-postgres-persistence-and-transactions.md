# Postgres Persistence And Transactions

## Current Gap

`@flarex/persistence-postgres` is primarily a Promise/throw package. Most
interfaces return `Promise<A>`, expected domain failures are thrown, SQL and
decode failures travel through the same JavaScript exception channel, and
outer Effect callers adapt these methods with `Effect.tryPromise`.

That adapter is locally valid because the Promise really may reject. It is not
the desired package boundary. When a service such as the point-mutation
journal catches the Promise, recognizes a long list of tagged errors with
`instanceof`, and wraps the rest as one persistence error, the real error
model still lives outside Effect.

## Current Migration Status

The first bounded vertical slices port session-journal attempt opening, table
resolution, point-operation orchestration, and two-phase sealing. The
persistence contract exposes Effect-native operations with explicit domain and
persistence failures, and the executor consumes them directly instead of
placing broad `tryPromise` adapters around persistence calls. Point-operation
input capture and pure sealing validation use `Result`; request hashing,
authority resolution, cryptographic hashing, and Drizzle transactions remain
narrow foreign Promise edges.

Sealing preserves its existing transaction shape: preparation captures a short
repeatable-read snapshot, releases locks before materializing and canonicalizing
the potentially large journal, and completion performs the exact-attempt write
transaction. The former nested runtime used to verify successful-result
evidence has been removed. Once a point operation or sealing phase enters a
transaction Promise edge, interruption waits for that Promise to settle so a
direct persistence caller cannot observe cancellation while the transaction
continues toward an unknown commit outcome.

Persistence tests enter these operations through the shared explicit test
runtime, so the Promise point-operation and sealing facades, former Promise
table resolver, and synchronous attempt opener have been removed. The sealing
materializer now uses Effect-native dependent orchestration and pure `Result`
validation. Receipt, live-overlay, and logical-write protocol evidence each
enter through their own narrow Promise adapter; known codec or Schema failures
become their existing stored-corruption errors, while unexpected crypto or
runtime failures remain defects.

Trusted scope-authority resolution and the private app-data snapshot resolver
are now Effect-native. Missing or inconsistent authority remains a tagged
`TrustedScopeAuthorityResolutionError`; metadata, provisioning-receipt, and
located-clock Promise rejection is mapped once to the tagged
`TrustedScopeAuthorityPortError`. The target-registry resolver retains its
existing typed placement-resolution failure because that cause is part of the
authority contract. The session journal consumes the Effect operation directly
and translates it once to its existing persistence error. Point-commit
finishing, rollback proof, and publication now share one Effect-native
authority-resolution operation and preserve their existing stale, corruption,
SQL, and defect classification. The located current-authorization-epoch
resolver and the directly connected
executor grant-admission operations are now Effect-native. Target capability
validation is a pure `Result`, the epoch transaction remains the one narrow
Promise edge and masks interruption until that transaction settles. Authority
and clock corruption failures remain typed, and an
unexpected epoch-reader rejection is retained in the tagged port error
channel. The unused high-level Promise resolver was deleted; the Worker and
tests own their explicit runtime boundaries.

Transaction-session activation now exposes an Effect-native `activateEffect`
operation. Authority-port and activation-transaction failures are mapped once
to `PointMutationSessionActivationPersistenceV1Error`, owned validation remains
typed, and interruption waits for the Drizzle transaction to settle. Its
existing executor port still consumes a temporary `activate` Promise facade
that unwraps only the typed persistence cause, preserving prior rejection
identity. Reload and terminalization remain Promise-native. Their module owns
one explicitly named temporary runtime bridge for these three compatibility
surfaces; delete each use as its executor caller moves to the corresponding
Effect operation.

Stored-attempt evidence loading now owns Effect-native `loadEffect` and
`loadFinishingEffect` operations with typed persistence failures and an
interruption-masked repeatable-read Promise edge. Its executor port consumes
those operations directly, so the obsolete generic
`resolveLocatedTrustedScopeAuthority` Promise facade and audited runtime
boundary have been deleted.

Stored commit-authority loading now owns an Effect-native `loadEffect`
operation, typed persistence failures, Effect-native detached
materialization, and an interruption-masked repeatable-read Promise edge. Its
executor port consumes that operation directly and translates the source
persistence error once to preserve the existing executor error contract. The
temporary `load` Promise/runtime compatibility bridge and its audited runtime
boundary have been deleted.

The existing Drizzle point-operation transaction still owns a temporary
throwing compatibility surface: its Promise-native latest-receipt verifier and
seven `Result.getOrThrow` projections for stored requests/outcomes, logical
writes, point dependencies, journal counters, receipt cardinality, and
receipt/root correlation. Their concrete consumers are
`runPointOperationInTransaction` and the directly called Promise-native point
read/write helpers. Delete these wrappers when that transaction body receives
its own Effect-native transaction slice rather than introducing a nested
runtime in this checkpoint. Precise transaction begin/commit/rollback failure
ownership also remains a later slice.

## Target Boundary

The target public persistence capability should expose exact Effect methods:

```ts
interface SessionJournalStore {
  readonly resolvePointTable: (
    attempt: SessionJournalAttempt,
    tableName: unknown,
  ) => Effect.Effect<
    PinnedPointTable,
    InvalidCapability | InvalidInput | TargetUnavailable | JournalSqlError
  >
}
```

Expected validation and capability failures are emitted directly. Driver
exceptions are mapped once, close to the operation that knows whether it was a
read, write, transaction begin, commit, rollback, or connection failure.
Stored corruption remains distinguishable from transient database
unavailability.

The underlying `pg`, PGlite, and Drizzle APIs may remain Promise-native. Keep
that foreign detail behind narrow adapter functions or an adapter service
rather than exposing it through every domain-facing method.

Drizzle now has an Effect-native Postgres integration, but not in Flarex's
installed Drizzle 0.45 line. The current Effect v4-compatible path requires
Drizzle v1 RC plus `@effect/sql-pg`; the published `@effect/sql-drizzle`
adapter targets Effect v3. Follow
[`09-drizzle-effect-postgres.md`](./09-drizzle-effect-postgres.md) before
proposing dependency or transaction changes. Until its proof gates pass, one
narrow `tryPromise` adapter is correct and repeated query-level wrappers are
not.

## Preserve Transaction Ownership

An Effect conversion must not weaken the existing database rules:

- the transaction helper owns begin, commit, rollback, and connection release;
- rollback failure is observed without hiding the original operation failure;
- no Postgres transaction remains open while waiting on untrusted user code;
- isolation, lock, retry, and idempotency behavior remain explicit;
- interruption cannot leave an unknown transaction outcome silently treated as
  a normal typed rejection; and
- real Postgres remains the correctness lane for transaction semantics even
  when PGlite provides fast tests.

If a Drizzle transaction callback must return a Promise, the adapter may run an
Effect there. That is a deliberate foreign callback boundary, not permission
for nested runners throughout persistence. The runtime, Scope, interruption
policy, and complete transaction outcome must still have one owner.

## Separate Planning From I/O

Persistence files often mix pure planning, trusted-state validation, SQL, and
projection checks. Do not make pure planners Effectful merely because the
calling transaction is Effectful:

- pure total planning stays TypeScript;
- pure recoverable projection or validation may return `Result`;
- SQL execution returns Effect with database errors;
- trusted stored-data verification returns typed corruption errors; and
- transaction orchestration uses `Effect.gen` or a clear pipeline to compose
  those pieces.

This separation reduces the temptation to put one `tryPromise` around a large
async transaction body that can also throw owned domain errors and defects.

## Migration Shape For Future Slices

Use a vertical, behavior-preserving slice rather than converting all 59 source
files at once:

1. choose one persistence capability and its direct executor/service caller;
2. define the target success and tagged error channels;
3. move foreign Promise mapping to the driver-owning edge;
4. convert owned validation from throw/catch to `Result` or Effect failure;
5. remove the now-redundant outer `instanceof` reconstruction;
6. preserve or deliberately replace any required Promise compatibility API;
7. prove focused PGlite behavior and the relevant real-Postgres lane; and
8. inspect transaction interruption, rollback, resource release, and retry
   behavior before declaring the slice complete.

Classify touched paths explicitly:

| Classification | Meaning in this migration |
| --- | --- |
| `keep` | Pure helper or correct narrow foreign adapter already has the right owner |
| `port` | Preserve behavior and contract while changing the internal Effect representation |
| `rewrite` | Exception-based ownership prevents exact typed composition |
| `delete` | Outer wrapper or duplicate decoder becomes redundant after the port |
| `temporary bridge` | A named consumer still requires Promise/throw; record its deletion condition |

Layers should follow the real capability and lifecycle boundary. Adding a
Layer around an unchanged Promise/throw object without moving failure or
resource ownership is cosmetic and does not complete a persistence port.
