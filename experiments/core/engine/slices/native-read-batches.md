# Overlap independent native reads in Medusa workflow roots

Status **Bounded latency correction implemented for the measured Product roots;
native-relative performance acceptance remains unmet.**

Flarex baseline `cb5eac43e`. Convex `db914cf06e2b06ee985646611b9e12ed7a770318`.
Executing Medusa fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Measured attribution

The [paired Product workflow benchmark](../../../../packages/medusa-adapter/benchmarks/core-performance/product-workflows/README.md)
runs the genuine `createProductsWorkflow` and `updateProductsWorkflow` roots with
identical inputs through pinned native Medusa and through Core on ordinary-role
PostgreSQL. Native create and update each take about 20 ms with about 40 driver
exchanges. Core took about 236 and 162 ms with 145 and 87 exchanges, and about
130 and 100 ms of main-thread CPU.

Attribution by the Effect span chain at the persistence scan, not by the cache
API entered, showed that commit admission was not the cost: its
`scanForAdmission` pages were already same-timestamp cache hits. An earlier
admission-read batching candidate was measured, found ineffective and withdrawn.
Per create, the serial reads were about 41 private event family unique-slot
absence probes, 27 per-row `writeRows` identity finds, 7 insert constraint
probes, 16 initialization-receipt lookups, which the Source default of
100 percent shared-cache verification rereads, and native relation finds.
Update showed the same families, including 10 `deleteRows` identity finds.
Each read was awaited individually; a simulated 2 ms per-exchange latency
raised create to about 630 ms.

## Independent challenge

- Current Core. Direct native command captures reselect the newest published
  snapshot each time, create a new operation cache and add metadata and index
  observations. Slot membership, reservations, charges, remembered rows and
  conflict checks are ordered per row; pending duplicates are visible through
  pending indexes, not the physical slot. Event family IDs are all known and
  validated before the first insert, and each event table's only unique
  constraint is its primary key.
- Pinned Convex. `range_batch` fetches independent misses concurrently with one
  isolated slot per request and fills its cache afterwards. Callers record
  dependencies and accounting only for consumed results, in order. Inserts read
  nothing; generated IDs are checked in one batch at commit. Native unique
  probes are therefore a Flarex divergence.
- Design. Batching at one shared timestamp would let a later row consume a page
  older than its own capture and raise spurious revision conflicts, while
  invalidating on every newer capture would discard every prefetch. Keep the
  consumer's own capture and accept a prefetched page only when that capture's
  committed write log proves the interval unchanged. Do not widen the adapter
  surface; prefetch only what the batch caller already supplies.

## Selected replacement

See [overlapped native slot reads](../divergences/native-read-batches.md).

| Owner | Change |
| --- | --- |
| `CoreIndexSnapshot` | `rangeBatch` translates `range_batch`; `scan` is its single-request fetch and fill. |
| `CoreDatabase` | One owner-wide `nativeReadConcurrency` bound (default 4) for overlapped native fetches. |
| `createCoreTransaction` | Batch callers prefetch distinct uncaptured slots without side effects; `nativeMembership` consumes a page only under the write-log proof and otherwise reads in place. |
| Event family staging | Prefetches the complete family, envelope and delivery rows through a module-private seam before ordinary ordered inserts. |
| Native initialization | A verified committed receipt is terminal and is checked once per prepared owner; every readiness check still validates the current binding identity. |
| Byte utility | Table-driven lowercase hex with the same detachment contract; other typed arrays are rejected with `TypeError`. |

Unchanged: per-row observations, accounting, typed failure position and class,
pending overlays, commit admission revalidation, outcome recovery and
settlement. The `checkCoreNativeAuthority` index revalidation on every native
open (about 3 percent of CPU) is not cached: reusing an authority verdict needs
proof that the authority object is issuer-owned and deeply immutable.

## Measured outcome

Paired benchmark, ordinary-role PostgreSQL 17 on one local host, 30 samples
after 5 warmups per lane, lanes interleaved (native, Core before, Core after),
no failures. Median and nearest-rank P95 in milliseconds; exchanges are medians.
Shared index-cache verification stays at the Source default of 100 percent.

| Root | Simulated RTT | Native wall | Before wall | After wall | Before CPU | After CPU | Exchanges native/before/after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Create | 0 | 13.5 / 15.1 | 205.8 / 214.6 | 150.5 / 158.9 | 116.6 | 94.2 | 40 / 145 / 129 |
| Update | 0 | 12.8 / 14.2 | 143.0 / 149.0 | 112.3 / 118.0 | 88.1 | 75.1 | 42 / 87 / 79 |
| Create | 2 ms | 152.3 / 159.8 | 691.8 / 740.3 | 408.5 / 425.3 | 275.2 | 162.9 | 40 / 145 / 129 |
| Update | 2 ms | 145.0 / 153.5 | 431.0 / 456.3 | 293.9 / 301.0 | 168.3 | 120.1 | 42 / 87 / 79 |

At 2 ms per exchange, the serial-latency gap to native shrinks from about 540 to
256 ms on create and from 286 to 149 ms on update. Exchange count falls less than
wall time, because overlapped reads still count as exchanges. The CPU column
includes timer scheduling at 2 ms. A diagnostic at 0 percent verification is not
a baseline. It measured create at 151.4 and 431.1 ms and update at 112.7 and
304.2 ms, with 136 and 80 exchanges, so lowering verification does not account
for the improvement.

## Remaining gaps

Main-thread CPU, dominated by diffuse Effect runtime overhead across many
owners, private value capture and per-operation authority checks, remains far
above native. Remaining serial reads are single relation finds and constraint
probes whose keys are only known after native normalization. These and the
complete-root native-relative target stay open.
