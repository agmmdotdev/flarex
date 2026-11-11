# Translated Core source retirement

Status: **Convex log/retention contract selected; bounded Core and actual
Application Worker source proof implemented. Actual baseline host cutover remains open.**

The owner confirms there is no deployed data to migrate and requires preserving
supported behavior while removing the previous core. The old sync source remains
a functional caller of scope clocks, commit headers and change facts. A source
proof alone does not remove that caller or complete live-query activation.

## Source guarantee disposition

The owner explicitly selected the pinned Convex log/retention contract instead
of preserving the old dense feed's additional physical-corruption checks. Retire
the requirement for independent evidence of every intermediate or tail commit;
do not add a new durable receipt chain, second clock or competing commit authority
to reproduce it. This disposition is specific to replacement sync source evidence.
It does not weaken mutation settlement, outcomes, fencing, atomic persistence,
index integrity, authorization or retained-interval validation.

The former feed's interior/tail header-gap and child-evidence cases describe its
implementation and remain meaningful while that feed serves actual callers.
They must not be weakened to pretend that the old source already migrated.
No-data disposition removes conversion obligations, not functional callers.

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

`CatchUpProbe -> CatchUpHost -> makeNamespaceCatchUp` still uses the dense
baseline and generation-4 state. It cannot consume this source capability by an
import swap. A connected fixed-target host/state replacement must preserve its
bounded catch-up/reopen behavior before the old correlated reader and schema can
retire. Do not fabricate dense commits, flatten index intervals into obsolete
equality keys, weaken old tests or remove the Core subscription refusal early.

The standalone synthetic source and independent oracle, service tracking,
session/query-set protocol, state replacement and production client integration
remain their existing `LQ-S1` through `LQ-C1` gates. This source correction does
not claim those gates complete. Task/Action and native caller migrations keep
their respective owners.
