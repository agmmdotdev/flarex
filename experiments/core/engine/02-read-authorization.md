# Concept 02: authorization for cached reads

Status: **Accepted design direction; no implementation**. Follow Convex's
identity-aware query caching and tracked permission reads for application access
rules. Keep authentication and engine-grant revocation separate. Concrete grant
enforcement, native conformance and result-cache eligibility remain open.
Replication is **open and explicitly deferred**.

This refines [timestamped snapshots](./02-timestamped-snapshots.md), without
changing the [atomic operation boundary](./02-operation-lifetime.md). A cached
row is data, not permission to disclose it. The operation must still execute its
access rules or reuse a result whose complete authorization dependencies remain
valid for its identity and requested snapshot.

## Accepted responsibility split

| Concern | Owner and accepted rule |
| --- | --- |
| Authentication | The trusted authentication boundary validates credentials and supplies the identity. Result-cache identity keys do not replace token validity or required revalidation. |
| Application permissions stored as data | The application or native framework owns its access policy. Read the records used by that policy at the operation's snapshot and track their dependencies alongside business-data reads. |
| Shared row/index caches | The portable engine proves app isolation, snapshot eligibility and completeness. A cache hit must preserve the same access evaluation and read dependencies as a persistence miss; caching a row does not make it public. |
| Query-result reuse | The result owner must account for app, function/arguments, relevant identity and all tracked reads. Follow Convex's observed-identity distinction where equivalent behavior is proved. Arbitrary Medusa/Payload hooks or access callbacks are not thereby approved for memoization. |
| Engine authorization grants | Preserve the existing contract: an authoritative scope-revocation epoch advance invalidates the attempt's grant. A valid older business-data snapshot or signed grant bytes cannot override that revocation. |

Permission dependencies include relevant records, absence and index/range reads;
do not reduce a membership lookup to an untracked cached boolean. Every writer
that changes those dependencies must participate in publication/invalidation.
An older allowed result cannot be reused at a snapshot containing a conflicting
permission change. Missing dependency history prevents reuse.

Permission records may use the same validated RAM/SQLite cache and timestamped
PostgreSQL fallback as other data. This direction does not require a separate
PostgreSQL permission query for every row. It also does not claim zero database
access or authorize removing current gates before their replacements are proved.

## Cart example and the in-flight boundary

1. Alice's cart query at snapshot `100` reads her membership, which allows cart
   access, then reads the cart. Both reads are dependencies of the result.
2. An administrator changes that membership and the change is published at `101`.
3. A query admitted at `101` or later cannot reuse the allowed result unchanged.
   The permission change invalidates its dependency proof; evaluating the access
   rule against that newer snapshot denies access.
4. A query already pinned to `100` keeps its coherent older view. The ordinary
   permission-row update does not by itself establish a universal rule cancelling
   every older response before delivery. Its authentication, operation lifetime
   and any separate engine-grant requirements still apply.

The last distinction follows the fixed-snapshot model, not an assertion that
every Convex transport has identical delivery timing. Do not describe Convex's
cache dependency mechanism as a universal response-time revocation barrier.
Changing an external identity-provider record is also not automatically a tracked
database write; its effect depends on the authentication/revalidation contract.

The engine's own grant revocation is a separate obligation. The
[accepted grant contract](../../../design-notes/flarex-db-accepted-design.md)
pins policy semantics through expiry unless the scope revocation epoch advances,
which invalidates the attempt. The exact race with reads, disclosure and commit
acceptance, and the mechanism for observing that epoch without repeated database
round trips, still require a concrete protocol and proof.

Stronger checks before disclosure need a named supported contract and a failure
witness. Merely integrating Medusa or Payload does not establish that every staff
permission change must cancel an older query. Preserve actual native access and
hook semantics; unresolved requirements remain enforced until explicitly resolved.
No existing runtime authorization gate is removed by this documentation decision.

## Pinned sources and necessary differences

Convex reference: `84fbb0e70b4e857913673871cb847ad11a55f3d5`; the
[source map](../REFERENCES.md#source-and-divergence-rules) records inspection and
hashes. Official documentation explains the model; the pin anchors implementation.

| Reference | Mechanism and limit |
| --- | --- |
| [Application::authenticate](../../../../../crates/application/src/lib.rs), [sync identity validation](../../../../../crates/sync/src/state.rs) | Authentication constructs a validated identity; sync checks validity/expiry. A cached identity key alone is not authentication. |
| [Identity::cache_key](../../../../../crates/keybroker/src/broker.rs) | User attributes and relevant administrative operation scope contribute to identity keys. The key is not merely an arbitrary user ID. |
| [RequestedCacheKey::cache_keys_after_execution](../../../../../crates/application/src/cache/mod.rs) | An identity-dependent query keeps identity in its stored key; queries that did not observe identity can share results. Other key inputs still apply. |
| [CacheManager::validate_cache_result](../../../../../crates/application/src/cache/mod.rs), [write-log token refresh](../../../../../crates/database/src/write_log.rs) | Reuse checks dependencies through the requested timestamp; conflicting writes or missing history prevent reuse. Permission reads use this same mechanism. |
| [run_query_at_ts_inner](../../../../../crates/application/src/application_function_runner/mod.rs), [transaction construction](../../../../../crates/database/src/database.rs) | Queries execute or reuse results for a selected timestamp. This is not a fresh permission scan after every await. |
| [Auth in Functions](https://docs.convex.dev/auth/functions-auth), [query consistency](https://docs.convex.dev/functions/query-functions#caching--reactivity--consistency) | Application code uses identity for its access decisions; all database reads within a query use one logical timestamp. |
| [Flarex grant contract](../../../design-notes/flarex-db-accepted-design.md), [participant admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts) | Engine grants and current admission carry separate authority obligations. Existing per-read plumbing is replaceable; its named security guarantees are not silently removed. |

Necessary differences: engine-grant revocation preserves Flarex's explicit
authority contract; native access/hook behavior stays with its framework owner.
Neither follows automatically from Convex query-result caching. Implementing the
replacement must identify all invalidating writers and establish the required
enforcement boundary without copying old repeated admission merely for compatibility.
No source translation, new grant protocol or native result cache is implemented.

## Remaining decisions and proof

The next question is [read-after-write freshness](./OPEN-QUESTIONS.md#next-question-read-after-write-freshness).
Grant epoch observation/fencing, disclosure and acceptance races, native access
compatibility, complete result-cache keys and eligibility remain open. Numerical
budgets and cache representations remain in the canonical queue.

Required later witnesses include two identities requesting the same cart,
permission updates/removal and missing membership records, a range-based policy,
cache hits and misses at the same snapshot, an old in-flight query versus a new
query after revocation, expired credentials, engine-grant revocation racing
disclosure/acceptance, missing change history and native hooks that must execute.
Measure complete operations and preserve the database/host gates in
[VALIDATION.md](../VALIDATION.md); no latency or scale result follows from this policy.
