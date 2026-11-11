# Translated Core source retirement

Status: **Convex log/retention contract selected; bounded Core and actual
Application Worker source and private checkpoint consumer implemented. Full query/session cutover remains open.**

The owner confirms there is no deployed data to migrate and requires preserving
supported behavior while removing the previous core. The former correlated
source and its actual private checkpoint caller have migrated together. Separate
functional legacy executor live-query and delivery paths retain their own
callers; this cutover does not complete live-query activation or retire their
shared tables.

## Source guarantee disposition

The owner explicitly selected the pinned Convex log/retention contract instead
of preserving the old dense feed's additional physical-corruption checks. Retire
the requirement for independent evidence of every intermediate or tail commit;
do not add a new durable receipt chain, second clock or competing commit authority
to reproduce it. This disposition is specific to replacement sync source evidence.
It does not weaken mutation settlement, outcomes, fencing, atomic persistence,
index integrity, authorization or retained-interval validation.

The correlated reader's dedicated interior/tail header-gap and child-evidence
tests retire with that reader under this explicit guarantee disposition. The
separate legacy commit feed retains its actual consumers and owner tests; its
independent mutation/settlement guarantees do not change. No-data disposition
removes conversion obligations, not functional callers.

Independent current-Core, accepted-direction and pinned-source challenges agree
on `db914cf06e2b06ee985646611b9e12ed7a770318`'s `write_log.rs` token-refresh
mechanism: capture a fixed log snapshot, require complete retained coverage of
the requested interval, and advance a token only when its exact dependencies
have no overlapping write. Timestamp arithmetic does not count commits.

## First connected source correction

This is the real-source track of `LQ-S1`, not permission to resume the superseded
moving-latest service. The [accepted live-query design](../../../design-notes/runtime-agnostic-query-sync-engine.md)
requires fixed targets, complete dependency validity and current authority.
Source-certified token refresh is a correlated interval proof; raw enumeration
of every commit is not required when the source can prove that result validity.

| Responsibility | Contract |
| --- | --- |
| Target acquisition | A scoped trusted Core callback captures one published timestamp `T`, registry, resident view and immutable write-log snapshot together. Physical latest time is not a publication frontier. |
| Lifetime | A target lives for at most 10 seconds and ends when its callback releases, its deadline expires or the owner closes. The default concurrent target limit is 64, configurable by the trusted Core owner. Capacity refusal is distinct from history loss. No permanent target or subscriber registry is added. |
| Evaluation | Every query uses the captured state and reads exactly at `T`. Later publication or pruning of the ordinary snapshot tree cannot silently substitute a newer snapshot. No SQL transaction spans Worker execution. |
| Refresh | A completed read token at `S <= T` is valid through `T` only if the captured log completely covers `(S,T]` and has no dependency overlap. A conflict is an ordinary changed result; missing retained history is an explicit failure requiring reevaluation/reset. |
| Authority | Derive metadata dependencies against the evaluation registry, retain their own frontiers, and validate current and pending metadata before disclosure. Later ordinary data writes beyond `T` do not invalidate a correct result at `T`. |
| Evidence | Preserve exact byte intervals, including Core's virtual metadata index identities. Core tokens remain trusted source/bridge evidence, never commit capabilities or developer-supplied subscription metadata. |
| Cold owner | A reopened Core starts its RAM log at the recovered durable head. Older interval proof is unavailable even when physical document history remains; reacquire a target and reevaluate. |

The responsible owners are Core snapshot/write-log/transaction completion and
the existing Application query runner. The authoritative Core evaluation codec
must represent the actual index identity grammar instead of dropping metadata
reads. The core must not import query-sync or own subscriber state.

Required real-source witnesses include multiple queries at one target while
writes continue, relevant/unrelated and absent/range dependencies, sparse
timestamps, metadata revocation, pending publication, deadline/cancellation,
owner closure, cold history loss and immutable evidence. Use paired PGlite and
ordinary-role PostgreSQL lanes and the actual Worker query owner where relevant.

## Remaining cutover

### Selected actual checkpoint consumer

Independent current-owner, accepted-direction and pinned-Convex challenges
converged on the next connected runtime slice. `DeploymentSyncDO` exposes only
`runCatchUpProbe`; its actual constructor does not register, evaluate or publish
query rows. Those generation-4 methods have separate test-only consumers. The
additional actual caller is `apps/query-sync-hosted-probe`, including its source
fixture, receipt protocol and reconstruction harness. Migrate that whole caller
graph with the backend host, rather than preserving a dense source for it.

The successor is a fixed-target checkpoint consumer for an empty query set.
Preserve private authorization, canonical scope routing, explicit fresh
initialization, bounded continuation, concurrent calls, scope isolation, lost
responses, persisted reopen, retained-history loss and source replacement.
Timestamp gaps are positions, not counts of committed batches. Its bounded
budget counts actual source reads and atomic state transitions.

The current Core target requires two connected additions: a retained-interval
check for an arbitrary saved checkpoint, and authenticated Application
registration read against that same target. A fabricated empty read token or a
separate latest registration read cannot provide these proofs. The existing
canonical Application owner must execute them inside one bounded callback and
return detached source-bound evidence; no target capability crosses transport.

The portable sync owner supplies the narrow checkpoint coordinator and an
independent synthetic-source oracle. The Cloudflare adapter owns one fail-closed
SQLite checkpoint record and atomic compare/advance. A stale overlapping reply
must not regress progress or replace source identity. Sync-object reconstruction
may resume while the same Core retains the interval; Core reconstruction may
honestly require history reset. A malformed stored record must not initialize
as fresh state, and no generation-4 runtime fallback remains.

The [checkpoint reconstruction divergence](../../../../experiments/core/engine/divergences/query-checkpoint-reconstruction.md)
records durable derived progress versus pinned Convex's RAM processing frontier.
This state is never commit authority or ongoing delivery authorization.

Ownership: Core owns interval/metadata proof and paired database regressions;
the source bridge owns strict protocol, canonical Application routing and
authentication; the sync host owns SQLite/probe/hosted-harness adoption; the
portable coordinator owns fixed-target progress and synthetic interleavings.
Validate actual Workerd authorization, bounds, response loss, overlap,
isolation and reopen, alongside paired real-source tests. Remove the displaced
source adapter, executor route/handler, transport codec and persistence reader
when their last actual caller moves. Shared commit-feed writers/tables retain
any independently named consumers. Full sessions, query invalidation, subscriber
tracking and browser integration remain their separate gates.

The checkpoint transport requires interruption to drain Fetch acquisition and
body cancellation before its source operation settles. The shared backend
`readBackendBoundedBody` previously allowed interruption to finish while the
underlying stream cancellation remained pending. Its held-cancellation witness
must remain at that reader's owner; correct its single read/cancel lifetime and
retain owner and checkpoint-client regressions. Do not hide the missing drain
with a second adapter reader, detached cleanup, swallowed cleanup failures or
an extra timeout. Byte-limit classification and the complete interruption/Cause
remain required.

Core's generic query-target callback has the same full-Cause obligation. The
former callback timeout race could discard its child's fallible cleanup on
deadline or external interruption, even though target-owned cleanup remained
outside the race. The corrected Core callback owner races only an Exit waiter
against its timer, joins the callback explicitly and retains all cleanup causes.
Only that timer's own cancellation is ordinary deadline expiry. Keep both
callback witnesses at Core and the corresponding source/probe witnesses at their
actual consumers.

`CatchUpProbe -> CatchUpHost -> runCheckpointTurn` now uses the Core source and
current checkpoint state. The former backend source client, executor route,
HTTP codec and persistence reader retire with their exports and dedicated tests.
The displaced generation-4 SQLite adapter and generations 1–4 migration/row/
evaluation/publication closure had no other functional caller and retire with
their test-only DOs. The legacy Application producer keeps its direct identity,
authority, snapshot, dependency, result and completion assertions; only the old
adapter projection assertion disappears. Historical records remain frozen.

An overlapping fresh request must not jump over a concurrently established
checkpoint below its certificate's retained edge. Reject that compare/advance
without mutation; a subsequent turn requests the actual saved position and can
receive explicit history loss. Timeout and external interruption must join the
source child and preserve its full cleanup Cause. Only the timeout owner's own
interrupt reasons constitute ordinary expiry.

Do not fabricate dense commits, flatten exact index intervals, remove the Core
subscription refusal or claim that this empty-query checkpoint replaces the
separate functional legacy executor query/delivery system.

The standalone synthetic source and independent oracle, service tracking,
session/query-set protocol, state replacement and production client integration
remain their existing `LQ-S1` through `LQ-C1` gates. This source correction does
not claim those gates complete. Task/Action and native caller migrations keep
their respective owners.
