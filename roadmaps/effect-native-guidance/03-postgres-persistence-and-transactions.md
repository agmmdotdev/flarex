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
resolver and the directly connected executor grant-admission operations are
now Effect-native. Target capability validation is a pure `Result`, and the
located target exposes an Effect operation directly. The private share-lock
read and checked update-lock increment are now named Effect operations.
Missing clocks, corrupt epochs, signed-bigint exhaustion, and
operation-specific SQL rejection stay distinct; owned epoch decoding enters
through pure `Result`, and the former throwing decoder is deleted. The located
target owns one audited Cause-preserving runtime bridge at Drizzle 0.45's
Promise transaction callback, forces rollback for every typed failure, defect,
or interruption, and waits for transaction settlement before exposing the
exact callback `Cause`. Query rejection is translated once to the target's
tagged port error, transaction infrastructure fails separately, and target
defects remain defects. The checked increment remains a private test primitive
rather than a production revocation command. The unused high-level Promise
resolver stays deleted; the Worker and tests own their explicit runtime
boundaries.

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
Effect catch logic. The resolver now also consumes the stable-binding owner's
Effect reader directly; its duplicate query-level `tryPromise` and the raw
Promise binding selector are deleted, so Drizzle rejection and stored-row
decoding each have one persistence owner. The package-root full-integrity
schema-version artifact readers are now Effect-native. Reader identity and
stored-row validation enter
through `Result`, query rejection maps once to the existing operation-specific
persistence error, and canonical manifest verification remains one narrow
foreign Promise edge. The pinned resolver consumes the internal
validated-identity read directly and translates persistence versus corruption
failures once. The two Promise readers plus their raw Promise selector and
decoder were deleted because no production compatibility consumer existed;
focused tests own their explicit runtime bridge. The remaining throwing
projection in this artifact/binding flow is the post-insert transaction
boundary.
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

The package-root stable table identity lookup readers are now Effect-native.
Caller input and stored-row materialization use pure `Result`, including the
correct separation between invalid caller values and corrupt stored values.
Both reads share one interruption-masked Drizzle Promise adapter with a tagged
operation-specific persistence failure; synchronous construction and accessor
failures remain defects. The old package-root Promise exports were deleted.
Stable-table allocation is now an internal Effect-native operation that owns
its short Drizzle transaction. Caller validation completes through `Result`
before the transaction opens; the deployment lock, name replay, high-water
read, allocation, insert, and returned-row verification retain their exact
order and typed failure distinctions. One audited runtime bridge exists only
at Drizzle 0.45's Promise transaction callback, preserves callback failures,
defects, and rollback evidence as a full `Cause`, and waits for transaction
settlement under interruption. Its reconciliation mechanics share one
package-local full-`Cause` policy with the exact-attempt transaction boundary,
while each domain retains its own transaction error and rollback sentinel. The
old Promise allocator and name-lookup transaction projection were deleted.
Creation-time index-definition writes now compose their deployment lock,
stable parent verification, replay lookup, high-water allocation, insert, and
prepared-row validation through one typed Effect operation. Its SQL awaits are
interruption-masked foreign Drizzle edges with operation-specific persistence
failures, while unexpected synchronous defects remain outside the typed error
channel. The low-level stable-ID Promise projection was deleted. Developer
index-definition and schema-binding writes now follow the same Effect-native
shape: the deployment lock, schema and logical-parent checks, existing binding
classification, definition replay or allocation, binding insert, and returned
row verification retain their original order and typed distinctions. Each
rejecting Drizzle statement maps once to an operation-specific persistence
failure; owned stored-row decoding uses `Result`, and synchronous construction
or accessor failures remain defects. The old developer async writer and its
Promise-only helpers were deleted. The Effect-native D2c transaction operation
now directly composes both physical-definition writers, immutable
schema-artifact ensure/replay, and the exact schema-version binding projection
read. Schema-version binding input and stored-row validation use `Result`, SQL
rejection is mapped once to a tagged read failure, and the former package-root
Promise binding readers were deleted because no production compatibility
consumer exists. The combined table/logical-index binding apply chain is now a
named Effect operation from authenticated prepared-token lookup through the
deployment lock, both catalog revalidation reads, both high-water checks,
ordered table/index insertion, and returned-row verification. Each rejecting
Drizzle statement maps once to an operation-specific tagged persistence
failure, owned validation composes through `Result`, and synchronous query
construction or row-access failures remain defects. The D2c transaction now
yields this operation directly, so its last generic Promise adapter and the
combined Promise apply projection are deleted.

The complete D2a no-write preparation path and D2d stale-plan retry coordinator
are now Effect-native. Strict input snapshots enter through `Result`; table and
logical-index observations, high-water planning, requirement compilation,
artifact canonicalization, exact quota checks, and typed stale-plan retries
remain in one Effect graph. D2a-only Promise high-water readers, throwing
allocators, combined planner APIs, and D2d's exception-based retry loop and
outer runtime bridge were deleted. Its outer Promise runner now belongs to
`FlarexRuntimePersistence.publishAppSchemaV1`, whose host-facing public
contract remains Promise-based. Protocol compilation and canonicalization
remain narrow foreign Promise edges, and D2a still performs no SQL writes. The
three quota policies now expose only their pure `Result` forms; their
unconsumed throwing projections and facade-only assertions are deleted.
At the C2-to-D2a composition seam, opaque table-plan state now enters through
its pure `Result` decoder. Because D2a consumes the token it just created,
impossible loss of repository authentication remains a defect instead of
widening the recoverable preparation failure channel; the synchronous throwing
projection is deleted.
D2b child-token derivation and D2c's pre-transaction preparation now compose
their owned authentication and requirement failures through ordered `Result`
operations. The broad `Result.try` plus `instanceof` reconstruction and all
three throwing preparation projections are deleted; unexpected runtime defects
remain outside the recoverable publication channel.

The retained table-only `ensureAppTableDefinitionsArtifactV1` compatibility
operation is now Effect-native behind its unchanged public Promise contract.
Input snapshotting enters through `Result`; optimistic table planning,
canonical artifact preparation, typed stale retry, in-transaction binding
application, and immutable artifact ensure compose directly. The former
table-only Promise planner/apply/high-water readers, throwing row-decoder
projection, artifact preparation/apply projections, and exception retry loop
were deleted because no production consumer remains. The runtime facade owns
the outer Promise runner, while one full-Cause-preserving runner remains at
Drizzle 0.45's transaction callback. Domain failures and stale retries retain
their typed identity; transaction infrastructure rejection is a distinct
tagged failure, and defects or interruption cannot be mistaken for business
rejection.

Developer physical-index preparation and the package-root physical-definition
readers are now Effect-native. Strict preparation and read input enters through
pure `Result`; Drizzle rejection is mapped once to an operation-specific typed
read failure; stored definition decoding keeps catalog corruption distinct; and
protocol canonicalization remains the one narrow Promise edge. Definition-list
canonicalization preserves the former parallel behavior explicitly. The old
Promise preparation and package-root read projections were deleted because the
repository has no production compatibility consumer; focused tests own their
explicit runtime bridge.

The package-root stable logical-index identity readers are now Effect-native.
Input and stored-row validation enter through pure `Result`, while each reader
owns one interruption-masked Drizzle Promise edge and maps only query rejection
to its tagged persistence failure. Stored catalog corruption remains distinct,
and unexpected access or runtime failures remain defects. The former Promise
exports were deleted because the repository has no production compatibility
consumer; persistence tests own the explicit runtime bridge. The stable-table
and stable-logical-index stored-ID `Result` decoders are now their sole
normalization authority; three unconsumed throwing projections and their
facade-only assertions are deleted.

Fenced index build-state reads are now Effect-native at the exported
persistence boundary. Unknown input and stored clock/build rows compose through
typed `Result` validation, the single Drizzle read is an interruption-masked
foreign Promise edge with a distinct persistence failure, and missing clock
authority remains separate from stored corruption. The former Promise export
was deleted because no production compatibility consumer exists; focused tests
own the explicit runtime bridge.
Owned read-input and build-row normalization now use hoisted Schema `Result`
decoders in exact field order. The former blanket build-row `Result.try` and
throwing Schema projections are deleted; the ordered-index byte decoder remains
one narrow foreign throwing edge, while unexpected row access or runtime throws
remain defects. Shared scope-clock row normalization now has one pure Schema
`Result` authority for exact driver types, signed-int64 bounds, storage
generation, blank identifiers, and owned timestamps. The fenced index reader
consumes that Result directly, so its broad clock `Result.try` is deleted. A
thin `Result.getOrThrow` projection remains only for `getScopeClock`, the
transaction lock, and other still-Promise transaction consumers; delete it when
those callers consume the Result or an Effect-native clock operation directly.

Stored commit-authority materialization now consumes that scope-clock Result
and hoisted Schema Result decoders for its scope UUID, epoch UUID, revocation
epoch, session identity fences, and lease snapshot. The three blanket
`Result.try` decoders are deleted: malformed stored authority retains the
existing projection, session, or lease corruption reason, ordered decoding
still short-circuits, and unexpected row-access or runtime failures remain
defects.
Detached session JSON and stored schema-artifact materialization now use
hoisted `Schema.fromJsonString` and row-field Result decoders. JSON syntax,
JSON-object membership, artifact identity, codec, canonical-byte, digest, and
final app-schema rejection retain the existing session or schema corruption
results. Ordered row decoding short-circuits before later fields, unexpected
accessor/runtime failures remain defects, and the only synchronous `Result.try`
left in this materializer narrowly adapts the protocol-owned throwing
app-schema decoder while catching only `SchemaError`. Canonicalization remains
the one narrow foreign Promise boundary after the repeatable-read capture has
closed.

The authoritative app-row snapshot and current-revision read kernel is now
Effect-native. Caller identity and snapshot values enter through typed
`Result` and Schema validation; scope authority, query rejection, and stored
row corruption remain distinct failures. Each Drizzle read is one
interruption-masked foreign Promise edge, while synchronous query construction
and unexpected runtime failures remain defects. The session journal yields the
snapshot read directly and translates its typed failure once, so the three old
Promise read exports and their broad journal adapter are deleted. App-row
revision writes remain a named temporary Promise bridge owned by the ordered
point-commit mutation transaction; that bridge is deleted when the mutation
graph can own an Effect transaction client without changing rollback or
statement-order semantics.
Stored revision materialization now composes its ordered column decoders and
owned shape checks through `Result`. The former blanket `Result.try` is
deleted: malformed driver values remain typed storage corruption, while
unexpected row-accessor and runtime throws remain defects rather than being
misclassified as recoverable database state.

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
