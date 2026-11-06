# Reduce per-operation CPU on the native hot path

Status **In progress; the target is not established as reachable.**

Flarex baseline `4620101d5`. Convex `db914cf06e2b06ee985646611b9e12ed7a770318`.
Follows [overlapped native reads](./native-read-batches.md), which brought driver
exchanges close to native and left main-thread CPU as the dominant gap.

## Measured attribution

One Product create runs about 4,200 named operations. Core stacks hold about two
thirds of busy CPU, with no owner above a few milliseconds. `MedusaWorkflow.node`
self time is not adapter time: Promise-owner callbacks run under the tracing
context captured when the owner was created, so Core spans do not nest beneath
the node. Commit admission re-reads are already cheap, about 0.5 ms in total, and
most of `CoreCommitter.submit` is durable save waiting.

## Independent challenge

- Current Core. The three candidates below together are worth an estimated 12 to
  20 ms of CPU per create, which misses a 70 to 90 ms wall target. Only about
  36 percent of `nativeSlot` calls are memo hits, and prefetched slots still need
  a fresh capture, so a synchronous path depends on cheaper captures first.
- Pinned Convex. System rows use the same synchronous apply as user rows; there is
  no bulk writer. `SchemaModel::enforce` returns early for system tables. Convex
  has no declarative unique indexes, and generated IDs are checked once at commit.
  Snapshots are immutable per-timestamp values.
- Accepted direction. Event rows remain Core documents settled atomically by the
  trusted owner. Each native capture still selects the latest published state, and
  authority and generation checks run before every fresh capture.

## Dispositions

| Candidate | Disposition |
| --- | --- |
| Untraced inner helpers | Done. Eighteen generator helpers use `Effect.fnUntraced`; outer spans remain. Measured reason below. |
| Protected references per staged row | Done. Derived once per table for each immutable registry, instead of walking every registry table for each row. |
| `readNativeBinding` check-only call | Rejected. The copy costs about 0.5 ms per paired create and update, which does not justify a new database method. |
| Snapshot reuse and cached metadata reads | Rejected after measurement. A transaction-local view keyed on timestamp and registry, plus metadata read sets cached per verified authority, moved CPU by about 1 ms over eight alternating rounds, which does not justify a divergence record. |
| Event inserts in one operation | Rejected after measurement. Running each event group inside a single operation, keeping the ordinary per-row insert, showed no change over four alternating rounds. |
| Synchronous insert and find core | Not attempted. Its value depended on the two rejected items, and removing per-row wrappers already showed no measurable effect. |

## Paused for an owner decision

Removing per-row unique slots from private event child rows would be the largest
event saving. The challenge disagreed: child IDs are injective in the family ID,
but no other enforcement of relational `id` uniqueness was found on the traced
path, so an orphan row could duplicate silently. This is a guarantee change and is
not part of this slice, as are fewer accounting charges and a higher
`MaxOpsBeforeYield`.

## Measured outcome

Five alternating rounds against `4620101d5` under background machine load. Best
round main-thread CPU: create 88 to 81 ms, update 71 to 65 ms. Round medians were
too noisy to give a finer figure.

The challenge's estimates did not hold: the rejected candidates were each predicted
to save 3 to 9 ms and measured about zero. Remaining CPU is not concentrated in
per-call wrappers, so further wrapper removal should be assumed worthless without
a measured witness. Changing how much work a root does, such as how many private
event rows it stores, is the remaining untested lever.
