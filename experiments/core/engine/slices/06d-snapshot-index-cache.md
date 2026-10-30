# Published snapshots and shared index pages

Status: **Bounded fresh Application path implemented and validated; full goal gates remain open**. This slice is
part of the active [goal](../GOAL.md), not completion of the wider rewrite.
Flarex baseline: `6c7e415973de786df7b82e624a2e7f0051c15374`.
Convex baseline: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Independent challenge and convergence

The current-owner, pinned-source and accepted-direction subagents inspected
independently, then exchanged challenges. All three converge on replacing the
snapshot/read path through the canonical fresh Application owner. A generic
document cache or a flag suppressing retention SQL would retain the wrong
mechanism. No runtime work proceeds on an unresolved cache-policy assumption.

| Current responsibility | Pinned mechanism | Disposition |
| --- | --- | --- |
| Eager physical snapshot acquisition and historical registry reload in `core/database.ts` | `SnapshotManager::snapshot`: retained earliest/latest checks and predecessor metadata | Replace; old reopen-history fixtures do not establish a compatibility obligation. Keep historical physical-reader coverage below this admission owner. |
| Raw point reads and per-operation observations in `core/transaction.ts` | ById singleton ascending range, maximum two, duplicate/non-End rejection | Adapt through the same snapshot/index reader as ranges, retaining first-original writes, pending overlay, immutable output and exact dependencies. |
| Repeated physical metadata observations | Selected resident indexes in `DatabaseIndexSnapshot` | Retain ordinary versioned metadata revisions with the published snapshot; no special already-validated flags. |
| Per-stream buffers without transaction-wide range coverage | Operation index trees and complete intervals, at most three cached components before fallback | Translate separately from shared pages; prefetch must not enlarge user dependencies/accounting. |
| No shared exact-page cache | `index_cache/mod.rs` ready entries keyed by deployment/index/interval/order/max_size | Translate timestamp eligibility, original cursor, weighted capacity, two-phase identity and registration. No shared subrange merging. |
| Published write log and registry update | Append log, invalidate cache, expose new snapshot, acknowledge | Adapt at committer publication, never at save completion. |
| Physical floor reads on every operation/miss | Leader local retention bounds and post-SQL definitive validation | Bootstrap both durable floors under the owned lease. Current retain-all mode has no live GC writer; keep local bounds immutable until close/fence/reconstruct. Preserve standalone physical race witnesses. |
| Unbounded top-level requests and callback queues | FunctionRouter query/mutation admission | Standard invocation owns root permits; nested calls borrow. DO injects explicit workload settings. See the [memory adaptation](../divergences/do-cache-and-admission-budgets.md). |

Source owners: `crates/database/src/{transaction,transaction_index,committer,
snapshot_manager,write_log,retention}.rs`, `crates/indexing/src/
{database_index_snapshot,atomic_cache}.rs`, `crates/indexing/src/index_cache/mod.rs`,
and `crates/postgres/src/{lib,sql}.rs` at the pin above. The inspected cache
shuttle file contains harness/helpers; no upstream executable scenario or Rust
test result is claimed.

## Required contracts

The shared page key is exact and owner/source isolated. A ready page beginning
at S can answer T only when T >= S and its invalidation registration still
exists. Retain ordered entries and the original End/After cursor. An exact-limit
page remains After until EOF is proved.

After fetching at S, population inserts an unready uniquely identified entry,
registers its interval and checks published row and `_index.by_id` metadata
writes strictly after S. History gaps, overlaps, metadata changes, eviction or
replacement refuse population. They do not invalidate the original S read.
Only that same still-registered population may become ready. Publication
invalidates old and new keys, including same-key body rewrites, and untracks
whole indexes on metadata changes. Eviction callbacks cannot unregister a newer
population.

Source verification defaults to 100 percent, rereads persistence at the requested
timestamp and compares the whole page including timestamps/cursor. A mismatch is
a consistency defect; SQL failures propagate. Zero is an existing source option,
not permission for silent fallback. SQL-avoidance evidence must name its mode.

Unverified shared hits and operation/resident hits do not add per-hit retention
SQL in the pin. Operation deadlines remain separate. Safe bootstrap timestamp
must satisfy both document and index floors. No floor advances from wall time
or publication; future GC must join the retention owner before activation.

## Scope, ownership and migration

Portable persistence/core owners own selected snapshots, retention eligibility,
resident metadata, operation coverage, exact shared pages and publication.
Standard invocation owns function admission. The existing canonical DO owns
construction, private configuration and resource lifetime. PostgreSQL remains
durable authority; no cache issues commit authority or raw capabilities.

Coordinated workers owned disjoint snapshot, operation, shared-page and admission responsibilities with explicit contract handoffs before edits. The coordinator owns connected witnesses, documentation,
integration and exact scoped checkpoint projection over unrelated shared WIP.
The cache representation/eviction policy was resolved from the pinned Moka dependency and recorded in its [runtime adaptation](../divergences/typescript-weighted-page-cache.md) before implementation.

Remove eager normal-operation snapshot/floor SQL, arbitrary historical-registry
fallback and normal Application raw document GET once their replacement is
connected. Preserve bootstrap/lower physical reader ports for named consumers.
The legacy `applicationQueryDataCache` / `snapshotIndexCache` remains only for
selection-bound Task, logical/relation/native consumers until those migrations;
do not wire its exclusive handoff protocol into the new shared cache.

No durable table/data deletion, new GC worker, native profile migration or
production deployment is included in this slice. Full retention/GC, remaining
schema lifecycle/native cutover and whole-goal performance gates remain open.

## Required witnesses and evidence limits

Both PGlite and ordinary-role PostgreSQL must cover empty/negative pages,
insert/delete/reinsert, moves, same-key rewrites, S fill versus T publication,
metadata staging/replacement, missing history, eviction/repopulation identities,
old requested timestamps, saved-unpublished rows, cursor direction/exact limit,
byte truncation, mutable outputs, source isolation and cold reopen. Preserve
retention-floor races in the lower physical reader. Verification corruption must
fail as a defect without fallback. Admission must release on failure, abort,
cancellation and close, reject overload and avoid nested permit reacquisition.

Actual workerd composition must prove the retained owner and configured cache/
admission lifecycle. SQL counts are structural evidence, not latency, throughput
or memory-capacity proof. Complete-request latency/CPU/queueing/memory and managed
Cloudflare eviction/Hyperdrive remain separate gates. No source default or test
configuration establishes a production DO budget.

Admission cancellation belongs to Standard invocation: reserve the exact waiter
and install its release under one outer uninterruptible mask, restoring the
queue wait and body. A bracket that masks the entire acquisition also masks the
wait and retains a cancelled reservation until timeout. The owning regression
uses a long TestClock deadline without advancing it, then checks immediate slot
reuse. Promotion/interruption must still retain the active permit until actual
work drains. This is a shared-owner correction; the host supplies no workaround.
The implemented bounded profile is verified through both database lanes and the
actual local workerd host, including ordinary-role PostgreSQL, SQL-return fill
races, old snapshots, warm/negative pages, metadata, cancellation, queue/HTTP
saturation, fencing, socket drain, cold reconstruction and uncertain-outcome
replay. Required independent post-change reviews are clear. Validation receipts
belong to Git; this establishes neither production capacity nor full native,
schema-lifecycle, GC or managed-host completion. Source verification mode zero
shows cache SQL avoidance; mode 100 still performs its required physical check.