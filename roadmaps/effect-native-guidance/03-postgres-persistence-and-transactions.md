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
validation is a pure `Result`, and the located target now exposes an Effect
operation directly. Missing or corrupt epoch rows cross its read-only
transaction as `Result` rather than thrown owned errors; the Drizzle 0.45
transaction remains the one narrow interruption-masked Promise edge inside the
concrete target. Unexpected transaction rejection is mapped once to the tagged
port error, while a target defect remains a defect. The temporary private
throwing epoch decoder now serves only the still-Promise epoch-advance path and
is deleted when that writer receives its own Effect/Result channel. The unused
high-level Promise resolver was deleted; the Worker and tests own their
explicit runtime boundaries.

Transaction-session activation and its executor operation are now
Effect-native. The executor consumes persistence `activateEffect` directly and
propagates its typed failure channel without reconstructing errors. Invalid
admitted capabilities enter through pure `Result` inspection, while
authority-port and activation-transaction failures are mapped once to
`PointMutationSessionActivationPersistenceV1Error`. Interruption still waits
for each Drizzle transaction to settle. The obsolete activation, exact-attempt
reload, and terminalization Promise facades have been deleted. Reload and
terminalization selector, snapshot, target, capability, and returned-contract
validation enter through `Result`. Persistence owns typed authority and
transaction failures; the executor composes `loadEffect`, `abortEffect`, and
`expireEffect` directly without recovering defects. Each Drizzle transaction
remains one narrow interruption-masked Promise edge, and the former
module-local runtime bridge is gone.

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

Point-operation transaction coordination now enters through an Effect-native
exact-attempt capability. Its one audited runtime runner exists at the Drizzle
transaction-callback boundary: it captures the work `Exit`, forces rollback on
any failed `Cause`, rehydrates that exact `Cause` after successful rollback,
and retains both callback and transaction causes when rollback or transaction
infrastructure fails differently. The outer point operation remains
uninterruptible until the transaction settles.

Journal counters, receipt cardinality, stored request/outcome decoding, and
receipt/root correlation now compose through `Result` and Effect directly.
The duplicate Promise latest-receipt verifier and five throwing projections
were deleted. Fresh point planning, logical point reads, document
canonicalization, and logical-write evidence preparation are now named Effect
operations. Their two former `Result.getOrThrow` projections and the broad
planning `tryPromise` veneer are deleted. Point-dependency corruption remains
typed, live-overlay evidence shares the seal path's typed verifier, an invalid
developer document remains a normal rejected point outcome, and unexpected
identity-generation or canonicalization failures remain defects that roll the
transaction back.

Drizzle query calls in that planning/read graph remain narrow Promise edges,
and the ordered mutation statements remain one temporary Promise adapter until
the installed driver can expose an Effect-owned transaction client.

Seal completion now uses the same Effect-native exact-attempt transaction
capability as point operations. Its transaction body is a named Effect
operation, exact-attempt and stale/sealed checks enter through typed Effect or
`Result` channels, and only the conditional Drizzle update remains a Promise
edge. The obsolete Promise exact-attempt callback type, symbol, target method,
and broad seal `tryPromise` wrapper are deleted. A failed transaction retains
the preparation handle for retry; successful completion deletes it only after
the transaction settles. If transaction cleanup also fails after callback work
dies or is interrupted, the callback `Cause` remains observable and the
transaction failure is attached as diagnostic defect evidence.

The already-connected Postgres transaction demarcation is now Effect-native.
BEGIN and COMMIT rejection have distinct typed infrastructure failures; a
callback's typed failure, defect, or interruption remains its exact `Cause` and
rollback settlement completes before that cause becomes observable. Rollback
failure remains secondary diagnostic evidence; the native operation requires
the connection owner to observe it, and a throwing observer cannot replace the
primary cause. Interruption requested during COMMIT waits for settlement. If
COMMIT succeeds, no rollback follows and the fiber may then report interruption,
so higher-level retries must use the existing idempotency or authoritative
outcome-recovery contract rather than infer that cancellation means rollback.
The Promise facade remains only for the current
`FlarexRuntimePersistenceDriver.transaction` consumers, preserves their raw
rejection identity, and retains their historical optional observer; it is
deleted when that runtime and public persistence transaction contract become
Effect-native. Pool acquisition/release remains a host-owned Promise lifecycle
outside this bounded slice. Before native host activation, that owner still
needs a bounded driver timeout plus abort-and-poison policy for a connection
whose BEGIN, COMMIT, or ROLLBACK never settles. The transaction adapter does not
fake that policy with an Effect timer because returning while the driver remains
in flight would manufacture an unknown database outcome.

Pinned point-table resolution is now Effect-native across the session store,
located target capability, and resolver. The obsolete Promise capability and
the session store's outer `tryPromise` reconstruction are deleted. Immutable
manifest membership remains authoritative and the stable deployment binding
remains corroboration. Missing declarations stay a typed not-found outcome;
malformed stored artifacts or binding rows are typed catalog corruption with
their source cause retained; database rejections are mapped once at the two
narrow interruption-masked Drizzle read edges and translated once by the
session store. Raw row acquisition is split from manifest integrity work and
stable-binding decoding, so cancellation masking does not extend through
canonicalization, hashing, or owned stored-row validation. The resolver still
never reads the mutable active-schema pointer. Stable-binding row validation
now has one authoritative pure `Result` decoder, and the resolver consumes that
failure channel directly instead of reconstructing owned throws through broad
Effect catch logic. Throwing projections remain only for the current
Promise-based schema-planning read and the post-insert transaction boundary.
Returned-row deployment identity, decoding, and exact correlation now compose
through one pure `Result`; the writer projects its typed failure once because
Drizzle requires callback rejection to roll the transaction back. These
projections are deleted when the planning consumers and transaction owner
receive Result or Effect failure channels with explicit rollback semantics.
Logical-index ID decoding and post-insert table/index/descriptor correlation
now follow the same Result-first contract, including exact returned-row
cardinality. Its one throwing projection likewise remains only at the current
Drizzle transaction callback so a typed verification failure rolls both
catalog inserts back.
Logical-index planning reads now also separate raw Drizzle row acquisition from
one pure `Result` decoder. The decoder preserves deployment and table-ID
validation before requested-descriptor filtering, ignores unrelated descriptors
on a requested table, and short-circuits duplicate or corrupt requested rows.
One throwing projection remains at the Promise-based planner/revalidation seam
until that complete chain owns an Effect failure channel and rollback policy.

Fenced index build-state reads are now Effect-native at the exported
persistence boundary. Unknown input and stored clock/build rows compose through
typed `Result` validation, the single Drizzle read is an interruption-masked
foreign Promise edge with a distinct persistence failure, and missing clock
authority remains separate from stored corruption. The former Promise export
was deleted because no production compatibility consumer exists; focused tests
own the explicit runtime bridge.

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
