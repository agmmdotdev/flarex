# Second slice: timestamped Application cache transfer

Status: **Bounded Application query transfer and guarded refresh implemented**.
The [goal](../GOAL.md) remains active. This extends the
[implemented operation-local reader](./01-snapshot-reads.md); it does not activate
shared page serving, native caches or a new commit pipeline.

Source baseline: Flarex `adbb6e002`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. Read current shared-worktree sources
and preserve other owners' work. The supported consumer boundary is Application
point/ordinary-index query data in the existing app-row store. Native writers
matter when they publish into that store; native physical relational caches and
Medusa/Payload transaction-profile migration are outside this slice.

## Independent challenge and disposition

The current-owner and pinned-Convex agents independently inspected sources, then
exchanged counterexamples. The coordinator selected the active timestamped-cache
handoff mechanism over either a forwarding-interface extraction or a new shared
page algorithm. Separate records explain the
[query handoff](../divergences/query-cache-transfer.md) and
[PostgreSQL refresh capture](../divergences/postgres-cache-refresh.md)
adaptations.

| Finding | Source and disposition |
| --- | --- |
| Convex has an active cache-transfer caller | [Transaction::into_token_and_index_cache](../../../../../../crates/database/src/transaction.rs), [scheduled_jobs::run_once](../../../../../../crates/application/src/scheduled_jobs/mod.rs), [LogReader::fast_forward_index_cache](../../../../../../crates/database/src/write_log.rs) and [Database::begin_with_index_cache](../../../../../../crates/database/src/database.rs) transfer a timestamped cache and apply every intervening write. Translate this mechanism; the shared page reader remains a shadow path at this pin. |
| A reusable cache is still tied to one timestamp | `fast_forward_index_cache` requires complete log history and returns no cache when it cannot prove the transition. Give a running operation exclusive ownership; never mutate an old operation's cache to a newer timestamp. |
| Same-key updates still change cached bodies | [IndexRegistry::index_keys_for_index and document_index_keys](../../../../../../crates/indexing/src/index_registry.rs) emit database updates when either old or new exists, including equal keys. The backend's `apply_write` removes the old key, replaces the body and inserts only inside complete coverage. Existing TypeScript `populate` assumes one immutable snapshot and cannot replace this operation. |
| Existing feed is necessary but insufficient as a refresh API | [commitFeed.ts](../../../../packages/persistence-postgres/src/commit/commitFeed.ts) validates contiguous headers and fact-to-revision identity, but exposes row identities, no upper target and no old/new bodies. Add one bounded protected capture; do not apply a future observed head to an operation already admitted at S. |
| Writer proof is bounded to supported trusted producers | Point, finite, CMS, logical commerce and cross-domain publication contribute app-row facts and advance the clock in the same outer transaction. The low-level row append has only a testing caller; `appendAppIndexEntryRevisionsInTransactionEffect` has no production caller. Runtime SQL permissions do not enforce the converse revision-to-fact rule. Preserve untrusted capability confinement and exclude arbitrary raw SQL/fixture writes from the supported coherence claim. |
| Full native/metadata logging is not an automatic prerequisite | This slice reuses only Application app-row data and retains fresh selection, authority, history and index gates. Missing native physical facts exclude those caches; they do not prohibit a proved app-row transfer. Metadata checks cannot be removed merely because data has timestamp S. |
| Cache state includes absence and receiving limits | `State.missing` is separate from the ordered component. Discard or correctly refresh negative evidence; never carry old absence across an insertion. A transferred cache must fit the receiving operation's admitted limits and definition identities. No new global cache defaults are implied. |

## Supported producer closure

Inspect the actual materialization and publication callers, not only feed foreign
keys. The current source closure is:

- Application point [durable command](../../../../packages/persistence-postgres/src/commit/point/durablePublication.ts): prepared `rowIntents`, materialization, publication prefix and clock advance share the caller's transaction.
- [Finite publication](../../../../packages/persistence-postgres/src/commit/point/finitePublication.ts): the durable command materializes, appends its prefix and advances within the same trusted outer transaction.
- [CMS publication](../../../../packages/persistence-postgres/src/frameworks/cmsTransaction/publication.ts): captured changes become row contributions before prefix and clock advancement.
- [Logical commerce publication](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/publication.ts): materialization streams row facts and checks their count before advancement.
- [Cross-domain publication](../../../../packages/persistence-postgres/src/frameworks/crossDomainCommand/publication.ts): closed changes contribute rows to the shared prefix before advancement.

Recheck exact executing symbols during implementation and retain existing
producer integrity witnesses. Arbitrary trusted SQL can still bypass this
protocol; no universal database-trigger coherence claim is made. Installation,
maintenance and reset paths must invalidate eligibility through their real
generation/epoch boundary before reuse. A missing producer or invalidation
counterexample blocks the affected activation until corrected at its owner.

Reverse-reference publication and intrinsic-index backfill also write index
memberships. Their keys derive from the canonical previous/final row values or
the existing row revision; they introduce no unlogged document mutation. Keep
current definition/build eligibility and exclude unsupported index families.

## Connected implementation boundary

1. Translate explicit cache write application at the ordered-cache owner:
   old-key removal, body/revision replacement, insertion into already complete
   intervals, deletion and bounded accounting. Keep coverage complete only when
   it remains provable. Capacity failure discards reuse rather than serving a
   partial result.
2. Add a narrow trusted PostgreSQL refresh capture for exactly `(oldS, S]` under
   one authority/history-protected transaction. Reuse feed continuity and
   historical row decoders. Hydrate old/new row evidence while retention is
   protected; never fetch the feed and then hydrate under unrelated lifetimes.
   Prefer the existing snapshot-open transaction rather than another admission.
3. Introduce the portable app-scoped handoff owner and inject it through actual
   query composition. Take exclusive ownership of an idle cache; concurrent
   operations can use independent cold caches. Keep operation budgets,
   dependencies, identity, failure and disclosure state private. Consume/seal
   the operation under its read gate after successful Worker RPC drain and,
   where applicable, receipt finalization and assembly. Consume only after the
   entire selected success path, then return data only when the existing trusted
   invocation-owned operation scope and cleanup also exit successfully. The
   public facade owns the scope through result validation and publishes staged
   candidates afterward, so caller-side error recovery cannot rewrite its
   outcome. Sealing closes reads; cleanup without a seal or with failure or
   interruption discards the candidate. Ordinary queries previously remained
   open until scope closure: a successful generic scope finalizer alone is not
   a consume protocol. Failed/cancelled work discards the checkout; older returns
   cannot replace a newer idle candidate, and checkout never refreshes backwards.
4. Rebind the actual Application query snapshot and remove its displaced
   unconditional fresh-cache construction for the selected composition. A cold
   cache remains a valid ordinary outcome when reuse lacks retained evidence.
   Actual corruption, SQL failures and interruption retain their typed behavior.

The handoff owner owns data reuse, not authorization or durable publication.
Keep PostgreSQL's current serialized publication and all required fresh gates.
Do not weaken the scope-clock SHARE lock to KEY SHARE: current index coverage
validation requires a coherent clock/build observation and can otherwise see a
newer coverage position as false stored corruption.

Owner-issued checked observations may remove identical same-transaction reads
only when provenance matches. In particular, the locked `ScopeClockRecord`
already carries the history floor. Removing its duplicate SELECT does not prove
that live eligibility can be cached for a whole DO lifetime.

## Required witnesses and wider gates

Prove unchanged reuse; nonindexed body updates with the same index key; key moves;
insertions into completed empty ranges and cached missing points; deletion and
reinsert; partial coverage; capacity/receiving-budget refusal; changed index or
generation identity; history gaps; and a publication newer than admitted S.
An old operation and a refreshed operation must remain independent. Cover
cancellation during refresh and lease return, and retain current warm
active-target/history/build and logical-accounting protections.

Run owner and actual query-consumer cases on PGlite and ordinary-role PostgreSQL.
Use genuine supported publication paths for write-to-refresh witnesses, not raw
fixture edits presented as production writers. Attribute feed and hydration SQL
costs explicitly; measure complete queries before claiming a performance win.
Both post-code reviewers and scoped cleanup/commit remain required.

## Executing owners and remaining scope

- `SnapshotIndexCache.applyWrite` and `removeIndex` maintain existing complete
  coverage, replace shared row bodies once and clear reuse on capacity refusal.
- `createApplicationQueryCacheHandoff` transfers one exclusive data-only candidate;
  `captureApplicationQueryCacheRefresh` captures exactly the admitted interval
  through the existing guarded open transaction and bounded commit-feed owner.
- `openApplicationQuerySnapshot` reconnects the candidate after fresh admission;
  `completeApplicationQuerySnapshot` seals it under the read gate. The resource
  release stages only successful sealed work, and `withApplicationQueryCompletion`
  publishes only after public `runQuery` result validation and all cleanup succeed.
- Standard query composition injects the handoff. Selected unconditional cache
  setup and duplicated cache-value helpers are removed; required PostgreSQL,
  live eligibility and logical-accounting paths remain their existing owners.

Pure cache/handoff, paired database lifecycle and genuine Application Worker
query-consumer witnesses exercise this bounded path. Structural history fixtures
prove refresh edge cases; genuine supported mutation paths prove consumer
write-to-refresh behavior. These are distinct evidence, not interchangeable
producer coverage. Validation and review receipts belong in Git.

Actual Cloudflare app-owner composition, DO restart/storage proofs, native profile
migration, ordered out-of-order-save publication and complete-request acceptance
remain goal gates. Current PostgreSQL publication is still serialized. No complete
request performance improvement is claimed. Replication stays deferred.
